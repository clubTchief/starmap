package com.starmap.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * Propagated state for any tracked satellite (ISS, Hubble, Tiangong, etc.).
 * One instance per NORAD ID in the tracked list; included in TelemetrySnapshot.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class SatelliteState {

    // ── Identity ──────────────────────────────────────────────────────────────
    public int    noradId;
    public String name;
    public String color;

    // ── Current position ─────────────────────────────────────────────────────
    public double latitudeDeg;
    public double longitudeDeg;
    public double altitudeKm;
    public double velocityKms;
    public double inclinationDeg;
    public double periodMin;

    /** ISO-8601 UTC epoch of this state vector */
    public String epoch;

    /** Human-readable OMM data age e.g. "1.3 h ago" */
    public String ommAge;

    /** True once OMM data is more than 2× CelesTrak's minimum refresh interval old
     *  (i.e. live fetches have been failing for a while) — lets the frontend show
     *  a "tracking degraded" indicator instead of silently presenting stale data
     *  as current. */
    public boolean ommStale;

    /** Raw OMM JSON from CelesTrak (for display in the panel) */
    public String ommJson;

    // ── Ground track ─────────────────────────────────────────────────────────
    public List<double[]> groundTrack;

    // ── Pass predictions ─────────────────────────────────────────────────────
    public List<PassEvent> nextPasses;

    public static class PassEvent {
        public String riseTime;
        public String setTime;
        public double maxElevationDeg;
        public double riseAzDeg;
        public double setAzDeg;
        public String durationStr;
    }
}
