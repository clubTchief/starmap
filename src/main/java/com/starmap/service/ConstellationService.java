package com.starmap.service;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.starmap.model.Satellite;
import jakarta.annotation.PostConstruct;
import org.orekit.propagation.analytical.tle.TLE;
import org.orekit.propagation.analytical.tle.TLEPropagator;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.orekit.frames.FramesFactory;
import org.orekit.frames.Frame;
import org.orekit.utils.PVCoordinates;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Fetches real orbital elements for all GNSS constellations from CelesTrak
 * and propagates each satellite's position at 1 Hz using SGP4.
 *
 * Constellations supported:
 *   G - GPS (32 satellites, ~20,200 km, 55° inclination)
 *   R - GLONASS (24 satellites, ~19,100 km, 64.8° inclination)
 *   E - Galileo (24 satellites, ~23,200 km, 56° inclination)
 *   C - BeiDou (45+ satellites, MEO/GEO/IGSO mixed)
 *   J - QZSS (4 satellites, quasi-zenith over Japan)
 */
@Service
public class ConstellationService {

    private static final Logger log = LoggerFactory.getLogger(ConstellationService.class);
    private static final long REFRESH_MS = 2 * 60 * 60 * 1000L; // 2 hours

    // CelesTrak group endpoints — real operational satellites only
    private static final Map<String, String> GROUPS = Map.of(
        "G", "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=json",
        "R", "https://celestrak.org/NORAD/elements/gp.php?GROUP=glo-ops&FORMAT=json",
        "E", "https://celestrak.org/NORAD/elements/gp.php?GROUP=galileo&FORMAT=json",
        "C", "https://celestrak.org/NORAD/elements/gp.php?GROUP=beidou&FORMAT=json",
        "J", "https://celestrak.org/NORAD/elements/gp.php?GROUP=sbas&FORMAT=json"
    );

    // constellation char → list of propagators
    private final Map<String, List<SatPropagator>> propagators = new ConcurrentHashMap<>();
    private final Map<String, Long> lastSuccessMs = new ConcurrentHashMap<>();
    private final JsonMapper mapper = JsonMapper.builder().build();
    private final HttpClient http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(15))
        .build();

    private long lastRefresh = 0;

    record SatPropagator(String prn, String name, String constellation, TLEPropagator prop) {}

    @PostConstruct
    public void init() {
        refreshAll();
    }

    @Scheduled(fixedDelay = 600_000) // check every 10 min, refresh if >2hr old (or sooner after a total failure)
    public void maybeRefresh() {
        if (System.currentTimeMillis() - lastRefresh > REFRESH_MS) refreshAll();
    }

    private void refreshAll() {
        log.info("Fetching GNSS constellation elements from CelesTrak...");
        int total = 0;
        int successCount = 0;
        for (var entry : GROUPS.entrySet()) {
            String constellation = entry.getKey();
            String url = entry.getValue();
            try {
                List<SatPropagator> sats = fetchConstellationWithRetry(constellation, url);
                propagators.put(constellation, sats);
                lastSuccessMs.put(constellation, System.currentTimeMillis());
                total += sats.size();
                successCount++;
                log.info("  {} ({}): {} satellites", constellation, url.contains("GROUP=") ?
                    url.substring(url.indexOf("GROUP=") + 6) : "?", sats.size());
            } catch (Exception e) {
                log.warn("Failed to fetch constellation {} after retries: {} — keeping last known set",
                          constellation, e.getMessage());
            }
        }

        // Only treat this refresh cycle as "done for the next 2 hours" if at
        // least one constellation genuinely succeeded. A total failure (e.g.
        // a transient network blip right at container startup, which is
        // exactly what happened once in production) previously still
        // advanced lastRefresh, silently locking the app out of retrying
        // for up to 2 hours even though nothing had actually refreshed.
        // Leaving lastRefresh unadvanced means the next scheduled check (up
        // to 10 minutes later) will retry the whole batch again instead.
        if (successCount > 0) {
            lastRefresh = System.currentTimeMillis();
            log.info("Constellation refresh complete — {} total satellites ({}/{} constellations succeeded)",
                      total, successCount, GROUPS.size());
        } else {
            log.warn("Constellation refresh: all {} constellations failed — will retry within 10 minutes " +
                      "rather than waiting the full refresh interval", GROUPS.size());
        }
    }

    /** Retries a constellation fetch up to 3 times with exponential backoff
     *  (2s / 4s / 8s) before giving up. On failure, the caller keeps whatever
     *  was fetched last time rather than clearing the constellation to empty. */
    private List<SatPropagator> fetchConstellationWithRetry(String constellation, String url) throws Exception {
        final int  maxAttempts = 3;
        final long baseDelayMs = 2000L;
        Exception  lastFailure = null;

        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return fetchConstellation(constellation, url);
            } catch (Exception e) {
                lastFailure = e;
                if (attempt < maxAttempts) {
                    long delay = baseDelayMs * (1L << (attempt - 1));
                    log.warn("Constellation {} attempt {}/{} failed ({}), retrying in {} ms",
                             constellation, attempt, maxAttempts, e.getMessage(), delay);
                    try { Thread.sleep(delay); }
                    catch (InterruptedException ie) { Thread.currentThread().interrupt(); throw e; }
                }
            }
        }
        throw lastFailure;
    }

    private List<SatPropagator> fetchConstellation(String constellation, String url) throws Exception {
        var req = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .header("User-Agent", "STARMAP/2.0")
            .timeout(Duration.ofSeconds(30))
            .build();
        var resp = http.send(req, HttpResponse.BodyHandlers.ofString());
        JsonNode root = mapper.readTree(resp.body());

        List<SatPropagator> result = new ArrayList<>();
        int prn = 1;
        for (JsonNode node : root) {
            try {
                TLE tle = ommNodeToTle(node);
                TLEPropagator prop = TLEPropagator.selectExtrapolator(tle);
                String name = node.path("OBJECT_NAME").asText("SAT");
                String prnStr = constellation + String.format("%02d", prn++);
                result.add(new SatPropagator(prnStr, name, constellation, prop));
            } catch (Exception e) {
                log.trace("Skip satellite in {}: {}", constellation, e.getMessage());
            }
        }
        return result;
    }

    private TLE ommNodeToTle(JsonNode n) {
        // Parse CCSDS OMM JSON fields into an Orekit TLE
        int    noradId    = n.path("NORAD_CAT_ID").asInt();
        char   classification = 'U';
        String intlDesig  = n.path("OBJECT_ID").asText("00000A");
        double epochMjd   = n.path("EPOCH").asDouble();
        double meanMotion = n.path("MEAN_MOTION").asDouble()
                            * (2 * Math.PI / 86400.0);      // rev/day → rad/s
        double ecc        = n.path("ECCENTRICITY").asDouble();
        double inc        = Math.toRadians(n.path("INCLINATION").asDouble());
        double raan       = Math.toRadians(n.path("RA_OF_ASC_NODE").asDouble());
        double argPerigee = Math.toRadians(n.path("ARG_OF_PERICENTER").asDouble());
        double meanAnomaly= Math.toRadians(n.path("MEAN_ANOMALY").asDouble());
        double bstar      = n.path("BSTAR").asDouble();
        int    revAtEpoch = n.path("REV_AT_EPOCH").asInt();

        // Parse ISO-8601 epoch
        String epochStr = n.path("EPOCH").asText();
        AbsoluteDate epoch;
        try {
            epoch = new AbsoluteDate(epochStr, TimeScalesFactory.getUTC());
        } catch (Exception e) {
            epoch = AbsoluteDate.J2000_EPOCH;
        }

        return new TLE(noradId, classification, 2000, 0, intlDesig,
                       TLE.DEFAULT, 1, epoch,
                       meanMotion, 0, 0, ecc, inc, argPerigee,
                       raan, meanAnomaly, revAtEpoch, bstar);
    }

    /**
     * Returns all constellation satellites as Satellite model objects
     * with current elevation/azimuth from the observer position.
     */
    public List<Satellite> getCurrentSatellites(
            AbsoluteDate epoch, double obsLat, double obsLon, double obsAlt) {

        Frame ecef = FramesFactory.getITRF(
            org.orekit.utils.IERSConventions.IERS_2010, false);
        List<Satellite> result = new ArrayList<>();

        for (var entry : propagators.entrySet()) {
            String constId = entry.getKey();
            for (SatPropagator sp : entry.getValue()) {
                try {
                    PVCoordinates pv = sp.prop().getPVCoordinates(epoch, ecef);
                    double[] azel = computeAzEl(pv, obsLat, obsLon, obsAlt);

                    Satellite sat = new Satellite();
                    sat.prn           = sp.prn();
                    sat.constellation = sp.constellation();
                    sat.azimuth       = (int) Math.round(azel[0]);
                    sat.elevation     = (int) Math.round(azel[1]);
                    sat.snr           = sat.elevation > 5
                                        ? (int)(20 + sat.elevation * 0.8) : 0;
                    sat.used          = sat.elevation > 15 && sat.snr > 25;
                    result.add(sat);
                } catch (Exception ignored) {}
            }
        }
        return result;
    }

    double[] computeAzEl(PVCoordinates pvEcef,
                                  double latDeg, double lonDeg, double altM) {
        double lat = Math.toRadians(latDeg);
        double lon = Math.toRadians(lonDeg);
        double R   = 6371000 + altM;

        // Observer ECEF
        double ox = R * Math.cos(lat) * Math.cos(lon);
        double oy = R * Math.cos(lat) * Math.sin(lon);
        double oz = R * Math.sin(lat);

        // Range vector
        double[] pos = pvEcef.getPosition().toArray();
        double dx = pos[0] - ox, dy = pos[1] - oy, dz = pos[2] - oz;
        double range = Math.sqrt(dx*dx + dy*dy + dz*dz);

        // ENU components
        double e = -Math.sin(lon)*dx + Math.cos(lon)*dy;
        double n = -Math.sin(lat)*Math.cos(lon)*dx
                   -Math.sin(lat)*Math.sin(lon)*dy
                   +Math.cos(lat)*dz;
        double u = Math.cos(lat)*Math.cos(lon)*dx
                  +Math.cos(lat)*Math.sin(lon)*dy
                  +Math.sin(lat)*dz;

        double el = Math.toDegrees(Math.asin(u / range));
        double az = Math.toDegrees(Math.atan2(e, n));
        if (az < 0) az += 360;

        return new double[]{az, el};
    }

    public int getTotalCount() {
        return propagators.values().stream().mapToInt(List::size).sum();
    }

    public Map<String, Integer> getCountByConstellation() {
        Map<String, Integer> counts = new LinkedHashMap<>();
        propagators.forEach((k, v) -> counts.put(k, v.size()));
        return counts;
    }

    /** Constellations whose data hasn't been successfully refreshed in over
     *  2x the normal refresh interval — i.e. live fetches have been failing
     *  for a while and the app is serving stale elements. Surfaced via
     *  /api/status for monitoring rather than only appearing in server logs. */
    public List<String> getStaleConstellations() {
        long now = System.currentTimeMillis();
        List<String> stale = new ArrayList<>();
        for (String key : GROUPS.keySet()) {
            Long last = lastSuccessMs.get(key);
            if (last == null || now - last > 2 * REFRESH_MS) stale.add(key);
        }
        return stale;
    }
}
