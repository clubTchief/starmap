package com.starmap.service;

import com.starmap.model.FrameInspector;
import com.starmap.model.GpsPosition;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/**
 * Converts a WGS-84 geodetic fix to ECEF and ECI (J2000) coordinates.
 * Matches the JS mirror in index.html (geodeticToEcef) and the frame
 * inspector display (updateFrameTab).
 */
@Service
public class CoordService {

    // WGS-84 ellipsoid constants
    private static final double A  = 6_378_137.0;          // semi-major axis (m)
    private static final double F  = 1.0 / 298.257_223_563;
    private static final double E2 = 2 * F - F * F;        // first eccentricity squared

    // J2000 epoch in Unix milliseconds
    private static final long J2000_MS = 946_728_000_000L;

    public FrameInspector compute(GpsPosition pos) {
        FrameInspector fi = new FrameInspector();
        fi.latDeg = pos.latitude;
        fi.lonDeg = pos.longitude;
        fi.altM   = pos.altitude;

        double[] ecef = toEcef(pos.latitude, pos.longitude, pos.altitude);
        fi.ecefX = ecef[0];
        fi.ecefY = ecef[1];
        fi.ecefZ = ecef[2];
        fi.rangeFromEarthCenterKm = Math.sqrt(ecef[0]*ecef[0] + ecef[1]*ecef[1] + ecef[2]*ecef[2]) / 1000.0;

        long epochMs = pos.epochMillis > 0 ? pos.epochMillis : System.currentTimeMillis();
        double[] eci = ecefToEci(ecef, epochMs);
        fi.eciX = eci[0];
        fi.eciY = eci[1];
        fi.eciZ = eci[2];
        fi.epoch = Instant.ofEpochMilli(epochMs)
                .atZone(ZoneOffset.UTC)
                .format(DateTimeFormatter.ISO_INSTANT);
        return fi;
    }

    /** Geodetic (deg, deg, m) → ECEF (m) */
    public double[] toEcef(double latDeg, double lonDeg, double altM) {
        double lat = Math.toRadians(latDeg);
        double lon = Math.toRadians(lonDeg);
        double N   = A / Math.sqrt(1 - E2 * Math.sin(lat) * Math.sin(lat));
        double x   = (N + altM) * Math.cos(lat) * Math.cos(lon);
        double y   = (N + altM) * Math.cos(lat) * Math.sin(lon);
        double z   = (N * (1 - E2) + altM) * Math.sin(lat);
        return new double[]{x, y, z};
    }

    /** ECEF (m) → ECI J2000 (m) using GMST rotation */
    public double[] ecefToEci(double[] ecef, long epochMs) {
        double dtSec = (epochMs - J2000_MS) / 1000.0;
        // GMST in radians (simplified linear model)
        double gmst  = (4.89496121 + 7.292115e-5 * dtSec) % (2 * Math.PI);
        double c = Math.cos(gmst), s = Math.sin(gmst);
        // Inverse of the ECI→ECEF rotation: ECEF = R·ECI ⟹ ECI = Rᵀ·ECEF
        double x =  c * ecef[0] - s * ecef[1];
        double y =  s * ecef[0] + c * ecef[1];
        double z =  ecef[2];
        return new double[]{x, y, z};
    }
}
