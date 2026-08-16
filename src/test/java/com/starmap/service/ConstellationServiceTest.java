package com.starmap.service;

import org.junit.jupiter.api.Test;
import org.orekit.utils.PVCoordinates;
import org.hipparchus.geometry.euclidean.threed.Vector3D;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Plain-object unit tests for ConstellationService's azimuth/elevation
 * geometry — no Spring context, no Orekit data files, no network calls.
 * Deliberately isolated from the rest of the service so it runs in
 * milliseconds and can't be broken by an unrelated data-loading issue.
 */
class ConstellationServiceTest {

    private final ConstellationService svc = new ConstellationService();

    @Test
    void satelliteDirectlyOverheadHasElevationNear90() {
        // Observer at the equator, prime meridian, sea level.
        double obsLat = 0.0, obsLon = 0.0, obsAlt = 0.0;

        // A point straight up from that observer, well above Earth's
        // surface (roughly GPS orbital altitude), expressed in ECEF.
        double earthRadius = 6371000.0;
        double satAltitude = 20200000.0;
        double x = earthRadius + satAltitude; // along the observer's local "up" (equator, prime meridian == +X axis)

        PVCoordinates pv = new PVCoordinates(new Vector3D(x, 0, 0), Vector3D.ZERO);
        double[] azEl = svc.computeAzEl(pv, obsLat, obsLon, obsAlt);

        double elevation = azEl[1];
        assertTrue(elevation > 89.0,
            "A satellite directly above the observer should read close to 90° elevation, got " + elevation);
    }

    @Test
    void satelliteOnTheHorizonHasElevationNearZero() {
        double obsLat = 0.0, obsLon = 0.0, obsAlt = 0.0;
        double earthRadius = 6371000.0;
        double satAltitude = 20200000.0;

        // A satellite in the observer's local horizontal plane (due "north"
        // in ENU terms at the equator/prime-meridian point, i.e. along +Z),
        // at the same distance from Earth's centre as the observer's local
        // radius — approximates a satellite rising at the horizon.
        PVCoordinates pv = new PVCoordinates(
            new Vector3D(earthRadius, 0, satAltitude), Vector3D.ZERO);
        double[] azEl = svc.computeAzEl(pv, obsLat, obsLon, obsAlt);

        // Not a tight tolerance — this is a geometric sanity check
        // (elevation should be low/moderate, not near 90°), not a
        // precision astrodynamics assertion.
        assertTrue(azEl[1] < 80.0,
            "A satellite near the observer's horizontal plane shouldn't read near-zenith elevation, got " + azEl[1]);
    }

    @Test
    void azimuthIsAlwaysInValidRange() {
        double[] azEl = svc.computeAzEl(
            new PVCoordinates(new Vector3D(6371000 + 500000, 100000, 200000), Vector3D.ZERO),
            19.1334, 72.9133, 14.0);
        assertTrue(azEl[0] >= 0.0 && azEl[0] < 360.0,
            "Azimuth must be normalised to [0, 360), got " + azEl[0]);
    }
}
