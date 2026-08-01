package com.starmap.service;

import com.starmap.model.CosmicBody;
import com.starmap.model.FrameContext;
import com.starmap.model.ObserverState;
import jakarta.annotation.PostConstruct;
import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.orekit.bodies.CelestialBody;
import org.orekit.bodies.CelestialBodyFactory;
import org.orekit.bodies.OneAxisEllipsoid;
import org.orekit.frames.Frame;
import org.orekit.frames.FramesFactory;
import org.orekit.frames.Transform;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.orekit.utils.Constants;
import org.orekit.utils.IERSConventions;
import org.orekit.utils.PVCoordinates;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.DependsOn;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Core ephemeris engine.
 *
 * Computes positions of all catalogued bodies in all four reference frames
 * using Orekit's DE430 planetary ephemeris at the current UTC epoch.
 *
 * Frames:
 *   EME2000  — Geocentric equatorial (ECI, Mean Equator/Equinox J2000)
 *   ECLIPTIC — Geocentric ecliptic (IERS 2010 conventions)
 *   ICRF     — Inertial frame (effectively heliocentric when Sun is origin)
 *   ITRF     — Earth-fixed (for GMST/GAST/observer computations)
 */
@Service
@DependsOn("orekitConfig")
public class EphemerisService {

    private static final Logger log = LoggerFactory.getLogger(EphemerisService.class);
    private static final double AU = 1.495978707e11;         // metres per AU
    private static final double C  = 299_792_458.0;          // m/s

    // ── Body catalogue ────────────────────────────────────────────────────────
    private record BodyDef(
        String id, String name, String category,
        String color, double radiusKm, double magnitude
    ) {}

    private static final List<BodyDef> BODY_DEFS = List.of(
        // Planets
        new BodyDef("sun",     "Sun",     "star",    "#fff5b0", 695700,  -26.7),
        new BodyDef("mercury", "Mercury", "planet",  "#b0a080",   2439,   -0.5),
        new BodyDef("venus",   "Venus",   "planet",  "#ffe090",   6051,   -4.5),
        new BodyDef("earth",   "Earth",   "planet",  "#4a8fd0",   6371,   -3.9),
        new BodyDef("moon",    "Moon",    "moon",    "#d8d0c0",   1737,  -12.6),
        new BodyDef("mars",    "Mars",    "planet",  "#c06040",   3390,   -2.9),
        new BodyDef("jupiter", "Jupiter", "planet",  "#c8a870",  69911,   -2.9),
        new BodyDef("saturn",  "Saturn",  "planet",  "#e0c870",  58232,   +0.7),
        new BodyDef("uranus",  "Uranus",  "planet",  "#a0e0f0",  25362,   +5.7),
        new BodyDef("neptune", "Neptune", "planet",  "#6080f0",  24622,   +8.0),
        // Dwarf planets
        new BodyDef("pluto",   "Pluto",   "dwarf",   "#c0b090",   1188,  +14.0),
        // Major moons (subset available in DE430)
        new BodyDef("io",       "Io",      "moon",   "#f0e060",   1822,   +5.0),
        new BodyDef("europa",   "Europa",  "moon",   "#d0e8f0",   1561,   +5.3),
        new BodyDef("ganymede", "Ganymede","moon",   "#b0a080",   2634,   +4.6),
        new BodyDef("callisto", "Callisto","moon",   "#808880",   2410,   +5.7),
        new BodyDef("titan",    "Titan",   "moon",   "#e0b060",   2574,   +8.3)
    );

    // Orekit body references
    private final Map<String, CelestialBody> bodies = new LinkedHashMap<>();

    // Frames
    private Frame eme2000;
    private Frame ecliptic;
    private Frame icrf;
    private Frame itrf;
    private CelestialBody sun;
    private CelestialBody earth;
    private boolean ready = false;

    @PostConstruct
    public void init() {
        try {
            eme2000  = FramesFactory.getEME2000();
            ecliptic = FramesFactory.getEcliptic(IERSConventions.IERS_2010);
            icrf     = FramesFactory.getICRF();
            itrf     = FramesFactory.getITRF(IERSConventions.IERS_2010, true);
            sun      = CelestialBodyFactory.getSun();
            earth    = CelestialBodyFactory.getEarth();

            // Load all bodies
            loadBody("sun",      () -> CelestialBodyFactory.getSun());
            loadBody("mercury",  () -> CelestialBodyFactory.getMercury());
            loadBody("venus",    () -> CelestialBodyFactory.getVenus());
            loadBody("earth",    () -> CelestialBodyFactory.getEarth());
            loadBody("moon",     () -> CelestialBodyFactory.getMoon());
            loadBody("mars",     () -> CelestialBodyFactory.getMars());
            loadBody("jupiter",  () -> CelestialBodyFactory.getJupiter());
            loadBody("saturn",   () -> CelestialBodyFactory.getSaturn());
            loadBody("uranus",   () -> CelestialBodyFactory.getUranus());
            loadBody("neptune",  () -> CelestialBodyFactory.getNeptune());
            loadBody("pluto",    () -> CelestialBodyFactory.getPluto());
            // Galilean moons & Titan via DE430 body names
            loadBodyByName("io",       "Io");
            loadBodyByName("europa",   "Europa");
            loadBodyByName("ganymede", "Ganymede");
            loadBodyByName("callisto", "Callisto");
            loadBodyByName("titan",    "Titan");

            ready = true;
            log.info("EphemerisService ready — {} bodies loaded from DE430", bodies.size());
        } catch (Exception e) {
            log.error("EphemerisService init failed: {}", e.getMessage(), e);
        }
    }

    @FunctionalInterface
    private interface BodySupplier { CelestialBody get() throws Exception; }

    private void loadBody(String id, BodySupplier supplier) {
        try { bodies.put(id, supplier.get()); }
        catch (Exception e) { log.warn("Could not load {}: {}", id, e.getMessage()); }
    }

    private void loadBodyByName(String id, String orekitName) {
        try { bodies.put(id, CelestialBodyFactory.getBody(orekitName)); }
        catch (Exception e) { log.debug("Body {} not in DE430: {}", orekitName, e.getMessage()); }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    public boolean isReady() { return ready; }

    /**
     * Compute all body positions at the given UTC epoch.
     * Returns one CosmicBody per catalogue entry with positions in all four frames.
     */
    public List<CosmicBody> computeAll(AbsoluteDate epoch) {
        if (!ready) return Collections.emptyList();

        // Sun position in ICRF for heliocentric origin
        Vector3D sunPosICRF;
        try {
            sunPosICRF = sun.getPVCoordinates(epoch, icrf).getPosition();
        } catch (Exception e) {
            log.warn("Sun position failed: {}", e.getMessage());
            return Collections.emptyList();
        }

        // Earth position in ICRF
        Vector3D earthPosICRF;
        try {
            earthPosICRF = earth.getPVCoordinates(epoch, icrf).getPosition();
        } catch (Exception e) {
            log.warn("Earth position failed: {}", e.getMessage());
            return Collections.emptyList();
        }

        // Precompute frame transforms (expensive — do once per tick)
        Transform icrfToEme2000, icrfToEcliptic;
        try {
            icrfToEme2000  = icrf.getTransformTo(eme2000,  epoch);
            icrfToEcliptic = icrf.getTransformTo(ecliptic, epoch);
        } catch (Exception e) {
            log.warn("Frame transform failed: {}", e.getMessage());
            return Collections.emptyList();
        }

        // Earth-Sun unit vector (for elongation)
        Vector3D earthToSun = sunPosICRF.subtract(earthPosICRF).normalize();

        List<CosmicBody> result = new ArrayList<>();

        for (BodyDef def : BODY_DEFS) {
            CelestialBody body = bodies.get(def.id());
            if (body == null) continue;
            try {
                CosmicBody cb = computeBody(def, body, epoch,
                    earthPosICRF, sunPosICRF,
                    icrfToEme2000, icrfToEcliptic,
                    earthToSun);
                result.add(cb);
            } catch (Exception e) {
                log.debug("Skip {}: {}", def.id(), e.getMessage());
            }
        }
        return result;
    }

    private CosmicBody computeBody(
            BodyDef def, CelestialBody body, AbsoluteDate epoch,
            Vector3D earthPosICRF, Vector3D sunPosICRF,
            Transform icrfToEme2000, Transform icrfToEcliptic,
            Vector3D earthToSun) throws Exception {

        // Body position in ICRF
        PVCoordinates pv       = body.getPVCoordinates(epoch, icrf);
        Vector3D bodyPosICRF   = pv.getPosition();

        boolean isEarth = "earth".equals(def.id());

        // ── Geocentric vectors ────────────────────────────────────────────────
        // For Earth itself, the geocentric vector is undefined (zero-length) —
        // RA/Dec/elongation from Earth's own centre have no meaning. We still
        // populate distAuGeo=0 and skip the normalize() that would otherwise
        // throw on a zero vector and silently drop Earth from the whole list.
        Vector3D geoICRF = isEarth ? Vector3D.ZERO : bodyPosICRF.subtract(earthPosICRF);
        double   distM   = geoICRF.getNorm();

        double ra = 0, dec = 0, eclLon = 0, eclLat = 0, elongation = 0;
        Vector3D geoEME2000 = Vector3D.ZERO;
        Vector3D geoEcl     = Vector3D.ZERO;

        if (!isEarth) {
            // Geocentric Equatorial (EME2000)
            geoEME2000 = icrfToEme2000.transformVector(geoICRF);
            ra         = Math.atan2(geoEME2000.getY(), geoEME2000.getX());
            dec        = Math.asin(geoEME2000.getZ() / geoEME2000.getNorm());

            // Geocentric Ecliptic
            geoEcl  = icrfToEcliptic.transformVector(geoICRF);
            eclLon  = Math.toDegrees(Math.atan2(geoEcl.getY(), geoEcl.getX()));
            if (eclLon < 0) eclLon += 360.0;
            eclLat  = Math.toDegrees(Math.asin(geoEcl.getZ() / geoEcl.getNorm()));

            // Elongation (angle Sun-Earth-body) — undefined for Earth itself
            Vector3D geoUnit = geoICRF.normalize();
            elongation = Math.toDegrees(Vector3D.angle(geoUnit, earthToSun));
        }

        // ── Heliocentric vectors ──────────────────────────────────────────────
        // Always computed (never zero, since no body sits exactly at the Sun's centre)
        Vector3D helioICRF    = bodyPosICRF.subtract(sunPosICRF);
        double   helioDistM   = helioICRF.getNorm();

        Vector3D helioEME2000 = icrfToEme2000.transformVector(helioICRF);
        Vector3D helioEcl     = icrfToEcliptic.transformVector(helioICRF);
        double   helioLon     = Math.toDegrees(Math.atan2(helioEcl.getY(), helioEcl.getX()));
        if (helioLon < 0) helioLon += 360.0;
        double   helioLat     = Math.toDegrees(Math.asin(helioEcl.getZ() / Math.max(helioDistM, 1)));

        // ── Phase angle ───────────────────────────────────────────────────────
        Vector3D bodyToSun     = sunPosICRF.subtract(bodyPosICRF);
        Vector3D bodyToEarth   = earthPosICRF.subtract(bodyPosICRF);
        double   phaseAngle    = 0;
        if (bodyToSun.getNorm() > 0 && bodyToEarth.getNorm() > 0) {
            phaseAngle = Math.toDegrees(Vector3D.angle(
                bodyToSun.normalize(), bodyToEarth.normalize()));
        }

        // ── Assemble CosmicBody ───────────────────────────────────────────────
        CosmicBody cb = new CosmicBody();
        cb.id       = def.id();
        cb.name     = def.name();
        cb.category = def.category();
        cb.color    = def.color();
        cb.radiusKm = def.radiusKm();
        cb.magnitude = def.magnitude();

        // Geocentric Equatorial
        cb.eciM      = vec3(geoEME2000);
        cb.raDeg     = Math.toDegrees(ra < 0 ? ra + 2 * Math.PI : ra);
        cb.decDeg    = Math.toDegrees(dec);
        cb.distAuGeo = distM / AU;

        // Geocentric Ecliptic
        cb.geoEclM   = vec3(geoEcl);
        cb.eclLonGeo = eclLon;
        cb.eclLatGeo = eclLat;

        // Heliocentric Equatorial
        cb.helioEqM      = vec3(helioEME2000);
        cb.helioRaRad    = Math.atan2(helioEME2000.getY(), helioEME2000.getX());
        cb.helioDecRad   = Math.asin(helioEME2000.getZ() / Math.max(helioDistM, 1));

        // Heliocentric Ecliptic
        cb.helioEclM   = vec3(helioEcl);
        cb.helioLon    = helioLon;
        cb.helioLat    = helioLat;
        cb.distAuHelio = helioDistM / AU;

        cb.elongationDeg  = elongation;
        cb.phaseAngleDeg  = phaseAngle;
        cb.lightTimeMin   = distM / C / 60.0;

        return cb;
    }

    /**
     * Compute all HUD quantities for the four modes.
     */
    public FrameContext computeFrameContext(AbsoluteDate epoch, ObserverState obs) {
        FrameContext fc = new FrameContext();
        try {
            // UTC and TT epochs
            fc.epochUtc = toIsoUtc(epoch);
            // Julian Date = seconds from Julian Epoch (JD 0.0) / 86400
            fc.jd  = epoch.offsetFrom(AbsoluteDate.JULIAN_EPOCH, TimeScalesFactory.getTT()) / 86400.0;
            fc.mjd = fc.jd - 2400000.5;

            // GMST
            double d = epoch.offsetFrom(AbsoluteDate.J2000_EPOCH, TimeScalesFactory.getUTC()) / 86400.0;
            double gmstDeg = (280.46061837 + 360.98564736629 * d) % 360.0;
            if (gmstDeg < 0) gmstDeg += 360.0;
            fc.gmstDeg = gmstDeg;

            // GAST (simplified: GMST + equation of equinoxes, ~0.01° correction)
            fc.gastDeg = (gmstDeg + 0.0) % 360.0;  // full GAST requires nutation series

            // LST
            fc.lstDeg  = (gmstDeg + (obs != null ? obs.lonDeg : 0)) % 360.0;

            // ERA (Earth Rotation Angle — simpler than GMST, exact relationship)
            double Tu  = d;
            fc.eraRad  = 2 * Math.PI * (0.7790572732640 + 1.00273781191135448 * Tu) % (2 * Math.PI);

            // Sun ecliptic longitude (for season and Mode 2 HUD)
            Vector3D earthPos = earth.getPVCoordinates(epoch, icrf).getPosition();
            Vector3D sunPos   = sun.getPVCoordinates(epoch, icrf).getPosition();
            Vector3D geoSun   = sunPos.subtract(earthPos);
            Transform t       = icrf.getTransformTo(ecliptic, epoch);
            Vector3D sunEcl   = t.transformVector(geoSun);
            double sunLon     = Math.toDegrees(Math.atan2(sunEcl.getY(), sunEcl.getX()));
            if (sunLon < 0) sunLon += 360.0;
            fc.sunEclLonDeg   = sunLon;
            fc.sunEclLatDeg   = Math.toDegrees(Math.asin(sunEcl.getZ() / sunEcl.getNorm()));

            // Obliquity (mean, J2000 + secular drift, arcseconds)
            double T    = d / 36525.0;
            double eps0 = 84381.406 - 46.836769*T - 0.0001831*T*T + 0.00200340*T*T*T;
            fc.obliquityDeg = eps0 / 3600.0;

            // Season (Northern hemisphere)
            fc.season = season(sunLon);

            // Earth heliocentric
            Vector3D earthHelio = earthPos.subtract(sunPos);
            Transform tHelio    = icrf.getTransformTo(ecliptic, epoch);
            Vector3D earthEcl   = tHelio.transformVector(earthHelio);
            fc.earthHelioLonDeg = Math.toDegrees(Math.atan2(earthEcl.getY(), earthEcl.getX()));
            if (fc.earthHelioLonDeg < 0) fc.earthHelioLonDeg += 360.0;
            fc.earthHelioLatDeg = Math.toDegrees(Math.asin(
                earthEcl.getZ() / Math.max(earthHelio.getNorm(), 1)));
            fc.earthDistAu      = earthHelio.getNorm() / AU;
            fc.earthVelKms      = earth.getPVCoordinates(epoch, icrf)
                                       .getVelocity().getNorm() / 1000.0;

            // Observer
            if (obs != null) {
                fc.obsLatDeg = obs.latDeg;
                fc.obsLonDeg = obs.lonDeg;
                fc.obsAltM   = obs.altM;
                fc.obsCity   = obs.city;
            }

        } catch (Exception e) {
            log.warn("FrameContext computation error: {}", e.getMessage());
        }
        return fc;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private double[] vec3(Vector3D v) {
        return new double[]{v.getX(), v.getY(), v.getZ()};
    }

    private String toIsoUtc(AbsoluteDate epoch) {
        try {
            return DateTimeFormatter.ISO_INSTANT.format(
                epoch.toDate(TimeScalesFactory.getUTC()).toInstant().atZone(ZoneOffset.UTC));
        } catch (Exception e) { return "unknown"; }
    }

    private String season(double sunLon) {
        // Northern hemisphere seasons by Sun ecliptic longitude
        if (sunLon >= 0   && sunLon < 90)  return "Spring";
        if (sunLon >= 90  && sunLon < 180) return "Summer";
        if (sunLon >= 180 && sunLon < 270) return "Autumn";
        return "Winter";
    }
}
