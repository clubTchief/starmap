package com.starmap.model;

import java.util.List;

/**
 * Single unified SSE payload for STARMAP.
 *
 * Carries both ground-layer data (GNSS position, satellites, track)
 * and cosmic-layer data (planetary positions in four frames, HUD context)
 * in one 1-Hz broadcast so the frontend can render any scale seamlessly.
 */
public class StarmapSnapshot {

    // ── GNSS ground layer ─────────────────────────────────────────────────
    public GpsPosition          position;         // live GPS fix
    public List<Satellite>      satellites;       // all constellations in view
    public List<GpsPosition>    recentTrack;      // rolling 500-point track
    public FrameInspector       frameInspector;   // WGS84/ECEF/ECI coordinates
    public String               gpsUtc;           // ISO-8601 UTC from GPS

    // ── Satellite tracking layer ─────────────────────────────────────────
    public List<SatelliteState> trackedSats;      // ISS + any catalog entries

    // ── Cosmic layer ──────────────────────────────────────────────────────
    public List<CosmicBody>     bodies;           // all solar system bodies, all 4 frames
    public FrameContext         frameContext;     // HUD quantities for active frame mode

    // ── Observer ─────────────────────────────────────────────────────────
    public ObserverState        observer;         // current observer position

    // ── Health/degradation signals ───────────────────────────────────────
    /** Constellation codes (G/R/E/C/J) whose elements haven't refreshed
     *  successfully in over 2x the normal interval — lets the frontend show
     *  a "tracking degraded" indicator instead of silently serving stale
     *  positions as current. Empty list when everything's healthy. */
    public List<String>         staleConstellations;
}
