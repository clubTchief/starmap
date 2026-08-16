package com.starmap.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Plain-object unit tests for SatelliteTrackingService's minimal hand-rolled
 * JSON field extractors — no Spring context, no network, no Orekit data.
 * These are the exact helpers that turn CelesTrak's OMM response into the
 * numbers fed to Orekit's TLE constructor, so getting them wrong would
 * silently corrupt every tracked satellite's orbit.
 */
class SatelliteTrackingServiceTest {

    private final SatelliteTrackingService svc = new SatelliteTrackingService();

    private static final String SAMPLE_OMM = """
        {
          "OBJECT_NAME": "ISS (ZARYA)",
          "OBJECT_ID": "1998-067A",
          "EPOCH": "2026-07-31T21:27:03.182000",
          "MEAN_MOTION": 15.49123456,
          "ECCENTRICITY": 0.0006703,
          "INCLINATION": 51.6423,
          "RA_OF_ASC_NODE": 247.4627,
          "ARG_OF_PERICENTER": 130.5360,
          "MEAN_ANOMALY": 325.0906,
          "BSTAR": 0.00021051,
          "NORAD_CAT_ID": 25544,
          "ELEMENT_SET_NO": 999,
          "REV_AT_EPOCH": 12345,
          "CLASSIFICATION_TYPE": "U"
        }""";

    @Test
    void extractsStringFieldCorrectly() {
        assertEquals("ISS (ZARYA)", svc.extractStr(SAMPLE_OMM, "OBJECT_NAME"));
    }

    @Test
    void extractsEpochStringWithoutTruncating() {
        assertEquals("2026-07-31T21:27:03.182000", svc.extractStr(SAMPLE_OMM, "EPOCH"));
    }

    @Test
    void returnsNullForMissingStringField() {
        assertNull(svc.extractStr(SAMPLE_OMM, "NOT_A_REAL_FIELD"));
    }

    @Test
    void extractsPositiveDoubleFieldCorrectly() {
        assertEquals(15.49123456, svc.extractDbl(SAMPLE_OMM, "MEAN_MOTION"), 1e-9);
    }

    @Test
    void extractsSmallEccentricityCorrectly() {
        // Eccentricity is a small decimal (no leading digit before the
        // point in some CelesTrak responses) — worth its own case since
        // it's the field most likely to be mis-parsed by a naive scanner.
        assertEquals(0.0006703, svc.extractDbl(SAMPLE_OMM, "ECCENTRICITY"), 1e-9);
    }

    @Test
    void extractsIntegerLikeFieldAsDouble() {
        assertEquals(25544.0, svc.extractDbl(SAMPLE_OMM, "NORAD_CAT_ID"), 1e-9);
    }

    @Test
    void returnsZeroForMissingNumericField() {
        assertEquals(0.0, svc.extractDbl(SAMPLE_OMM, "NOT_A_REAL_FIELD"), 1e-9);
    }
}
