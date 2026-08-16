package com.starmap.service;

import com.starmap.model.SatelliteState;
import jakarta.annotation.PostConstruct;
import org.orekit.bodies.BodyShape;
import org.orekit.bodies.GeodeticPoint;
import org.orekit.bodies.OneAxisEllipsoid;
import org.orekit.frames.Frame;
import org.orekit.frames.FramesFactory;
import org.orekit.frames.TopocentricFrame;
import org.orekit.orbits.KeplerianOrbit;
import org.orekit.propagation.SpacecraftState;
import org.orekit.propagation.analytical.tle.TLE;
import org.orekit.propagation.analytical.tle.TLEPropagator;
import org.orekit.propagation.events.ElevationDetector;
import org.orekit.propagation.events.EventsLogger;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.orekit.utils.Constants;
import org.orekit.utils.IERSConventions;
import org.orekit.utils.PVCoordinates;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.context.annotation.DependsOn;
import org.springframework.stereotype.Service;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.file.*;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Tracks one or more satellites by NORAD ID using Orekit SGP4/SDP4 propagation.
 *
 * Data source: CelesTrak JSON OMM format (future-proof, survives TLE format EOL).
 * Caches OMM data to disk so restarts don't hit CelesTrak unnecessarily.
 * Enforces CelesTrak's 2-hour minimum refresh policy.
 *
 * Default satellite: ISS (NORAD 25544). Additional satellites can be added
 * via the sat.track.norad-ids property or POST /api/sat/add?noradId=N.
 */
@Service
@DependsOn("orekitConfig")
public class SatelliteTrackingService {

    private static final Logger log = LoggerFactory.getLogger(SatelliteTrackingService.class);

    // CelesTrak GP endpoint — JSON OMM format (future-proof, no TLE format dependency)
    // Ref: https://celestrak.org/NORAD/documentation/gp-data-formats.php
    private static final String CELESTRAK_OMM_JSON =
        "https://celestrak.org/NORAD/elements/gp.php?FORMAT=JSON&CATNR=";

    // Minimum interval between CelesTrak fetches (2 hours per their policy)
    private static final long MIN_FETCH_INTERVAL_MS = 2 * 60 * 60 * 1000L;

    // Default colour palette for satellites (cycled when adding new ones)
    private static final String[] COLOURS = {
        "#ff6b35",  // ISS — orange-red
        "#00e5ff",  // sat 2 — cyan
        "#cc44ff",  // sat 3 — purple
        "#39ff14",  // sat 4 — lime
        "#ffb300",  // sat 5 — amber
        "#ff4d6d",  // sat 6 — red
        "#7c83fd",  // sat 7 — lavender
    };

    @Value("${sat.track.norad-ids:25544}")
    private String noradIdsConfig;    // comma-separated list, default ISS

    @Value("${sat.track.groundtrack-minutes:90}")
    private int groundTrackMinutes;

    @Value("${sat.track.pass-window-hours:24}")
    private int passWindowHours;

    @Value("${sat.track.min-elevation-deg:10}")
    private double minElevationDeg;

    @Value("${sat.track.cache-dir:./sat-cache}")
    private String cacheDir;

    // Per-satellite state — keyed by NORAD ID
    private final Map<Integer, TrackedSat> satellites = new ConcurrentHashMap<>();
    private int colourIndex = 0;

    // Observer position from GPS fix
    private volatile double obsLatDeg  = 19.1334;
    private volatile double obsLonDeg  = 72.9133;
    private volatile double obsAltM    = 14.0;
    private volatile boolean hasObsPos = false;

    // ── Inner record ─────────────────────────────────────────────────────────

    private static class TrackedSat {
        final int    noradId;
        String       name;
        final String colour;
        TLE          tle;
        Instant      ommFetchedAt;
        String       ommJson;        // raw JSON from CelesTrak for display in panel
        SatelliteState lastState;

        TrackedSat(int noradId, String colour) {
            this.noradId = noradId;
            this.colour  = colour;
            this.name    = "NORAD " + noradId;
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @PostConstruct
    public void init() {
        // Ensure cache directory exists
        try { Files.createDirectories(Paths.get(cacheDir)); }
        catch (IOException e) { log.warn("Cannot create sat cache dir: {}", e.getMessage()); }

        // Add all configured NORAD IDs (ISS by default)
        for (String part : noradIdsConfig.split(",")) {
            part = part.trim();
            if (!part.isEmpty()) {
                try { addSatellite(Integer.parseInt(part)); }
                catch (NumberFormatException e) { log.warn("Invalid NORAD ID: {}", part); }
            }
        }
    }

    /** Add a new satellite to track. No-op if already tracked. */
    public synchronized SatelliteState addSatellite(int noradId) {
        if (satellites.containsKey(noradId)) return satellites.get(noradId).lastState;
        String colour = COLOURS[colourIndex % COLOURS.length];
        colourIndex++;
        TrackedSat ts = new TrackedSat(noradId, colour);
        satellites.put(noradId, ts);
        fetchOmm(ts);           // load TLE immediately
        log.info("Now tracking NORAD {} ({})", noradId, ts.name);
        return buildState(ts);
    }

    /** Remove a satellite from tracking. */
    public void removeSatellite(int noradId) {
        satellites.remove(noradId);
        try { Files.deleteIfExists(Paths.get(cacheDir, noradId + ".json")); }
        catch (IOException ignored) {}
        log.info("Stopped tracking NORAD {}", noradId);
    }

    public Collection<Integer> trackedNoradIds() {
        return Collections.unmodifiableSet(satellites.keySet());
    }

    /** GPS observer position — used for pass predictions. */
    public void updateObserverPosition(double latDeg, double lonDeg, double altM) {
        this.obsLatDeg = latDeg; this.obsLonDeg = lonDeg; this.obsAltM = altM;
        this.hasObsPos = true;
    }

    // ── Scheduled refresh (every 2 hours — respects CelesTrak policy) ────────

    @Scheduled(fixedRateString = "${sat.track.refresh-ms:7200000}")
    public void refreshAll() {
        satellites.values().forEach(ts -> {
            long age = ts.ommFetchedAt == null ? Long.MAX_VALUE
                     : Instant.now().toEpochMilli() - ts.ommFetchedAt.toEpochMilli();
            if (age >= MIN_FETCH_INTERVAL_MS) fetchOmm(ts);
            else log.debug("NORAD {}: OMM still fresh ({} min old), skipping fetch",
                    ts.noradId, age / 60000);
        });
    }

    // ── OMM fetch + cache ─────────────────────────────────────────────────────

    public void fetchOmm(TrackedSat ts) {
        Path cacheFile = Paths.get(cacheDir, ts.noradId + ".json");

        // Retry the live fetch with exponential backoff (2s / 4s / 8s) before
        // giving up and falling back to cache — smooths over the transient
        // network timeouts CelesTrak occasionally hits, without needing a
        // person to notice and trigger a manual redeploy.
        final int    maxAttempts  = 3;
        final long   baseDelayMs  = 2000L;
        Exception    lastFailure  = null;

        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                log.info("Fetching OMM (JSON) for NORAD {} from CelesTrak... (attempt {}/{})",
                         ts.noradId, attempt, maxAttempts);
                String json = httpGet(CELESTRAK_OMM_JSON + ts.noradId);
                parseOmmJson(ts, json);
                ts.ommJson = json;
                Files.writeString(cacheFile, json);
                ts.ommFetchedAt = Instant.now();
                log.info("NORAD {}: {} — OMM loaded (epoch {})", ts.noradId, ts.name,
                         ts.tle != null ? ts.tle.getDate() : "?");
                return;
            } catch (Exception e) {
                lastFailure = e;
                if (attempt < maxAttempts) {
                    long delay = baseDelayMs * (1L << (attempt - 1)); // 2s, 4s, 8s
                    log.warn("NORAD {}: fetch attempt {}/{} failed ({}), retrying in {} ms",
                             ts.noradId, attempt, maxAttempts, e.getMessage(), delay);
                    try { Thread.sleep(delay); }
                    catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
                }
            }
        }

        log.warn("NORAD {}: live fetch failed after {} attempts ({}), trying cache",
                  ts.noradId, maxAttempts, lastFailure != null ? lastFailure.getMessage() : "?");
        try {
            if (Files.exists(cacheFile)) {
                String cached = Files.readString(cacheFile);
                parseOmmJson(ts, cached);
                ts.ommJson = cached;
                ts.ommFetchedAt = Instant.ofEpochMilli(
                    Files.getLastModifiedTime(cacheFile).toMillis());
                log.info("NORAD {}: loaded from cache ({})", ts.noradId, ts.ommFetchedAt);
            } else {
                log.error("NORAD {}: no cache — satellite will not be tracked", ts.noradId);
            }
        } catch (Exception ce) {
            log.error("NORAD {}: cache load failed: {}", ts.noradId, ce.getMessage());
        }
    }

    /** Public wrapper so the controller can trigger a manual refresh. */
    public void fetchOmm(int noradId) {
        TrackedSat ts = satellites.get(noradId);
        if (ts != null) fetchOmm(ts);
    }

    /**
     * Parse a CelesTrak JSON OMM response and build an Orekit TLE from the fields.
     *
     * CelesTrak returns a JSON array of OMM objects. Each object has the CCSDS OMM
     * keywords (MEAN_MOTION, ECCENTRICITY, INCLINATION, etc.) but NOT pre-built
     * TLE_LINE1/TLE_LINE2 strings — those are only in FORMAT=TLE responses.
     *
     * We build the TLE directly from the OMM fields using Orekit's full constructor,
     * which is more correct than parsing text lines and avoids all TLE format limitations.
     *
     * Key OMM → TLE field mapping:
     *   EPOCH               → TLE epoch (ISO-8601 → AbsoluteDate)
     *   MEAN_MOTION         → rev/day → rad/s
     *   MEAN_MOTION_DOT     → rev/day² → rad/s²
     *   MEAN_MOTION_DDOT    → rev/day³ → rad/s³
     *   ECCENTRICITY        → dimensionless
     *   INCLINATION         → degrees → radians
     *   RA_OF_ASC_NODE      → degrees → radians
     *   ARG_OF_PERICENTER   → degrees → radians
     *   MEAN_ANOMALY        → degrees → radians
     *   BSTAR               → 1/earth-radii (SGP4 drag term)
     *   NORAD_CAT_ID        → satellite number
     *   CLASSIFICATION_TYPE → 'U' unclassified / 'C' classified
     *   ELEMENT_SET_NO      → TLE element set number
     *   REV_AT_EPOCH        → revolution number at epoch
     */
    private void parseOmmJson(TrackedSat ts, String json) throws Exception {
        // Manual JSON parsing — no Jackson dependency needed for this flat structure
        // CelesTrak returns: [{ "OBJECT_NAME": "...", "MEAN_MOTION": 15.49, ... }]
        // Strip outer array brackets and find the first object
        String trimmed = json.strip();
        if (trimmed.startsWith("[")) trimmed = trimmed.substring(1);
        if (trimmed.endsWith("]"))  trimmed = trimmed.substring(0, trimmed.lastIndexOf(']'));
        trimmed = trimmed.strip();
        // Remove trailing comma if multiple objects returned
        if (trimmed.endsWith(",")) trimmed = trimmed.substring(0, trimmed.length()-1);

        // Extract name
        String rawName = extractStr(trimmed, "OBJECT_NAME");
        ts.name = (rawName != null && !rawName.isBlank()) ? rawName.trim() : "NORAD " + ts.noradId;

        // Extract orbital elements
        String epochStr     = extractStr(trimmed, "EPOCH");
        double meanMotion   = extractDbl(trimmed, "MEAN_MOTION");    // rev/day
        double eccentricity = extractDbl(trimmed, "ECCENTRICITY");
        double inclination  = extractDbl(trimmed, "INCLINATION");    // degrees
        double raan         = extractDbl(trimmed, "RA_OF_ASC_NODE"); // degrees
        double argPerigee   = extractDbl(trimmed, "ARG_OF_PERICENTER"); // degrees
        double meanAnomaly  = extractDbl(trimmed, "MEAN_ANOMALY");   // degrees
        double bstar        = extractDbl(trimmed, "BSTAR");          // 1/earth-radii
        double mmDot        = extractDbl(trimmed, "MEAN_MOTION_DOT");  // rev/day²
        double mmDdot       = extractDbl(trimmed, "MEAN_MOTION_DDOT"); // rev/day³
        int    satNum       = (int) extractDbl(trimmed, "NORAD_CAT_ID");
        int    elementSet   = (int) extractDbl(trimmed, "ELEMENT_SET_NO");
        int    revAtEpoch   = (int) extractDbl(trimmed, "REV_AT_EPOCH");
        String classType    = extractStr(trimmed, "CLASSIFICATION_TYPE");

        if (epochStr == null || meanMotion == 0.0)
            throw new RuntimeException("Missing required OMM fields for NORAD " + ts.noradId);

        // Parse ISO-8601 epoch — CelesTrak OMM format: "2026-06-26T03:43:15.671136"
        // (no trailing Z, microsecond precision). Use java.time for robust parsing,
        // then convert to Orekit AbsoluteDate via java.util.Date.
        java.time.LocalDateTime ldt = java.time.LocalDateTime.parse(
            epochStr.replace("Z", ""),
            java.time.format.DateTimeFormatter.ofPattern(
                epochStr.contains(".") ? "yyyy-MM-dd'T'HH:mm:ss.SSSSSS"
                                       : "yyyy-MM-dd'T'HH:mm:ss"));
        AbsoluteDate epoch = new AbsoluteDate(
            java.util.Date.from(ldt.toInstant(java.time.ZoneOffset.UTC)),
            TimeScalesFactory.getUTC());

        // Convert units:  rev/day → rad/s  (1 rev = 2π rad, 1 day = 86400 s)
        final double REV_PER_DAY_TO_RAD_S  = 2.0 * Math.PI / 86400.0;
        final double REV_PER_DAY2_TO_RAD_S2 = REV_PER_DAY_TO_RAD_S / 86400.0;
        final double REV_PER_DAY3_TO_RAD_S3 = REV_PER_DAY2_TO_RAD_S2 / 86400.0;

        final double D2R = Math.PI / 180.0;

        char classification = (classType != null && !classType.isBlank())
            ? classType.trim().charAt(0) : 'U';

        // Build Orekit TLE from OMM fields
        ts.tle = new TLE(
            satNum,
            classification,
            0, 0, "",           // launch year, number, piece (not in standard OMM)
            TLE.DEFAULT,        // ephemeris type
            elementSet,
            epoch,
            meanMotion   * REV_PER_DAY_TO_RAD_S,
            mmDot        * REV_PER_DAY2_TO_RAD_S2,
            mmDdot       * REV_PER_DAY3_TO_RAD_S3,
            eccentricity,
            inclination  * D2R,
            argPerigee   * D2R,
            raan         * D2R,
            meanAnomaly  * D2R,
            revAtEpoch,
            bstar,
            TimeScalesFactory.getUTC()
        );
    }

    // ── Minimal JSON field extractors (no external parser needed) ─────────────

    private String extractStr(String json, String key) {
        String search = "\"" + key + "\"";
        int idx = json.indexOf(search);
        if (idx < 0) return null;
        int colon = json.indexOf(':', idx + search.length());
        if (colon < 0) return null;
        int start = json.indexOf('"', colon + 1);
        if (start < 0) return null;
        int end = json.indexOf('"', start + 1);
        if (end < 0) return null;
        return json.substring(start + 1, end);
    }

    private double extractDbl(String json, String key) {
        String search = "\"" + key + "\"";
        int idx = json.indexOf(search);
        if (idx < 0) return 0.0;
        int colon = json.indexOf(':', idx + search.length());
        if (colon < 0) return 0.0;
        // Skip whitespace after colon
        int start = colon + 1;
        while (start < json.length() && Character.isWhitespace(json.charAt(start))) start++;
        int end = start;
        while (end < json.length() && (Character.isDigit(json.charAt(end))
               || json.charAt(end) == '.' || json.charAt(end) == '-'
               || json.charAt(end) == '+' || json.charAt(end) == 'e'
               || json.charAt(end) == 'E')) end++;
        if (start == end) return 0.0;
        try { return Double.parseDouble(json.substring(start, end)); }
        catch (NumberFormatException e) { return 0.0; }
    }

    // ── State propagation (called every SSE tick) ────────────────────────────

    /** Build propagated states for all tracked satellites. */
    public List<SatelliteState> buildAllStates() {
        List<SatelliteState> states = new ArrayList<>();
        satellites.values().forEach(ts -> {
            SatelliteState s = buildState(ts);
            if (s != null) states.add(s);
        });
        return states;
    }

    private SatelliteState buildState(TrackedSat ts) {
        if (ts.tle == null) return ts.lastState;
        try {
            AbsoluteDate now = new AbsoluteDate(new Date(), TimeScalesFactory.getUTC());
            TLEPropagator prop = TLEPropagator.selectExtrapolator(ts.tle);
            SpacecraftState state = prop.propagate(now);

            Frame earthFrame = FramesFactory.getITRF(IERSConventions.IERS_2010, true);
            BodyShape earth  = new OneAxisEllipsoid(
                Constants.WGS84_EARTH_EQUATORIAL_RADIUS,
                Constants.WGS84_EARTH_FLATTENING, earthFrame);

            GeodeticPoint geo = earth.transform(
                state.getPosition(earthFrame), earthFrame, now);

            SatelliteState s = new SatelliteState();
            s.noradId      = ts.noradId;
            s.name         = ts.name;
            s.color        = ts.colour;
            s.latitudeDeg  = Math.toDegrees(geo.getLatitude());
            s.longitudeDeg = Math.toDegrees(geo.getLongitude());
            s.altitudeKm   = geo.getAltitude() / 1000.0;

            PVCoordinates pv = state.getPVCoordinates(FramesFactory.getEME2000());
            s.velocityKms = pv.getVelocity().getNorm() / 1000.0;

            KeplerianOrbit kep = new KeplerianOrbit(
                state.getOrbit().getPVCoordinates(FramesFactory.getEME2000()),
                FramesFactory.getEME2000(), now, TLEPropagator.getMU());
            s.inclinationDeg = Math.toDegrees(kep.getI());
            s.periodMin      = kep.getKeplerianPeriod() / 60.0;

            s.epoch   = toIso(now);
            s.ommAge  = ts.ommFetchedAt != null ? formatAge(ts.ommFetchedAt) : "unknown";
            s.ommStale = ts.ommFetchedAt == null
                || Instant.now().toEpochMilli() - ts.ommFetchedAt.toEpochMilli() > 2 * MIN_FETCH_INTERVAL_MS;
            s.ommJson = ts.ommJson;

            s.groundTrack = buildGroundTrack(prop, now, earth, earthFrame);

            if (hasObsPos) s.nextPasses = buildPasses(now, earth, earthFrame);

            ts.lastState = s;
            return s;
        } catch (Exception e) {
            log.warn("NORAD {}: propagation error: {}", ts.noradId, e.getMessage());
            return ts.lastState;
        }
    }

    // ── Ground track ──────────────────────────────────────────────────────────

    private List<double[]> buildGroundTrack(TLEPropagator prop, AbsoluteDate start,
            BodyShape earth, Frame earthFrame) throws Exception {
        List<double[]> track = new ArrayList<>();
        int steps = groundTrackMinutes * 2;
        double prevLon = Double.NaN;
        for (int i = 0; i <= steps; i++) {
            AbsoluteDate t = start.shiftedBy(i * 30.0);
            SpacecraftState st = prop.propagate(t);
            GeodeticPoint gp = earth.transform(st.getPosition(earthFrame), earthFrame, t);
            double lat = Math.toDegrees(gp.getLatitude());
            double lon = Math.toDegrees(gp.getLongitude());
            if (!Double.isNaN(prevLon) && Math.abs(lon - prevLon) > 180)
                track.add(new double[]{Double.NaN, Double.NaN});
            track.add(new double[]{lon, lat});
            prevLon = lon;
        }
        return track;
    }

    // ── Pass predictions ──────────────────────────────────────────────────────

    private List<SatelliteState.PassEvent> buildPasses(AbsoluteDate start,
            BodyShape earth, Frame earthFrame) {
        List<SatelliteState.PassEvent> passes = new ArrayList<>();
        // Use only the first tracked satellite for pass predictions
        // (pass predictions are observer-specific, so track the primary sat)
        TrackedSat primary = satellites.values().stream().findFirst().orElse(null);
        if (primary == null || primary.tle == null) return passes;
        try {
            GeodeticPoint obs = new GeodeticPoint(
                Math.toRadians(obsLatDeg), Math.toRadians(obsLonDeg), obsAltM);
            TopocentricFrame topo = new TopocentricFrame(earth, obs, "observer");
            TLEPropagator prop = TLEPropagator.selectExtrapolator(primary.tle);

            ElevationDetector det = new ElevationDetector(topo)
                .withConstantElevation(Math.toRadians(minElevationDeg))
                .withHandler(new org.orekit.propagation.events.handlers.ContinueOnEvent());
            EventsLogger logger = new EventsLogger();
            prop.addEventDetector(logger.monitorDetector(det));
            prop.propagate(start, start.shiftedBy(passWindowHours * 3600.0));

            AbsoluteDate riseTime = null;
            for (EventsLogger.LoggedEvent ev : logger.getLoggedEvents()) {
                AbsoluteDate t = ev.getState().getDate();
                if (ev.isIncreasing()) { riseTime = t; }
                else if (riseTime != null) {
                    SatelliteState.PassEvent p = buildPassEvent(riseTime, t, topo, earthFrame, primary);
                    if (p != null) passes.add(p);
                    riseTime = null;
                    if (passes.size() >= 5) break;
                }
            }
        } catch (Exception e) {
            log.warn("Pass prediction error: {}", e.getMessage());
        }
        return passes;
    }

    private SatelliteState.PassEvent buildPassEvent(AbsoluteDate rise, AbsoluteDate set,
            TopocentricFrame topo, Frame earthFrame, TrackedSat ts) {
        try {
            TLEPropagator prop = TLEPropagator.selectExtrapolator(ts.tle);
            double dur = set.durationFrom(rise);
            int samples = Math.max(2, (int)(dur / 10));
            double maxEl = 0;
            for (int i = 0; i <= samples; i++) {
                AbsoluteDate t = rise.shiftedBy(i * dur / samples);
                SpacecraftState st = prop.propagate(t);
                double el = Math.toDegrees(topo.getElevation(
                    st.getPosition(earthFrame), earthFrame, t));
                if (el > maxEl) maxEl = el;
            }
            SpacecraftState stRise = prop.propagate(rise);
            SpacecraftState stSet  = prop.propagate(set);
            SatelliteState.PassEvent p = new SatelliteState.PassEvent();
            p.riseTime        = toIso(rise);
            p.setTime         = toIso(set);
            p.maxElevationDeg = maxEl;
            p.riseAzDeg       = Math.toDegrees(topo.getAzimuth(
                stRise.getPosition(earthFrame), earthFrame, rise));
            p.setAzDeg        = Math.toDegrees(topo.getAzimuth(
                stSet.getPosition(earthFrame),  earthFrame, set));
            p.durationStr     = String.format("%d min %d s", (long)dur/60, (long)dur%60);
            return p;
        } catch (Exception e) { return null; }
    }

    // ── HTTP ──────────────────────────────────────────────────────────────────

    private String httpGet(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection)
            URI.create(url).toURL().openConnection();
        conn.setRequestProperty("User-Agent", "gnss-tracker/1.0");
        conn.setConnectTimeout(15_000);
        conn.setReadTimeout(15_000);
        conn.setInstanceFollowRedirects(true);
        int code = conn.getResponseCode();
        if (code != 200) throw new RuntimeException("HTTP " + code + " from " + url);
        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(conn.getInputStream()))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append('\n');
            return sb.toString();
        } finally { conn.disconnect(); }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String toIso(AbsoluteDate d) {
        try {
            return DateTimeFormatter.ISO_INSTANT.format(
                d.toDate(TimeScalesFactory.getUTC()).toInstant().atZone(ZoneOffset.UTC));
        } catch (Exception e) { return "unknown"; }
    }

    private String formatAge(Instant t) {
        long s = Instant.now().getEpochSecond() - t.getEpochSecond();
        if (s < 60)   return s + " s ago";
        if (s < 3600) return (s/60) + " min ago";
        return String.format("%.1f h ago", s/3600.0);
    }
}
