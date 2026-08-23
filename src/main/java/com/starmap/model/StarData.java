package com.starmap.model;

/**
 * A single naked-eye star (HYG catalogue, magnitude <= 6.5) — static
 * fields only. Az/El are deliberately NOT computed here: doing that
 * server-side and re-transmitting ~9,000 stars over SSE every second
 * was costed out at roughly $80/month in Railway egress per continuously
 * connected client (0.05/GB * ~1.6TB/month/client). The frontend already
 * receives frameContext.lstDeg and observer.latDeg every tick for other
 * purposes, so it computes Az/El itself — the same pattern the existing
 * celestial RA/Dec grid already uses (buildGrid() does its own spherical
 * math client-side from gmstDeg rather than having the server pre-project
 * grid points). This record is served once via GET /api/stars, not SSE.
 *
 * Star data: HYG Database (currently v4.1), © astronexus, licensed CC BY-SA 4.0
 * (https://github.com/astronexus/HYG-Database). Attribution is a real
 * ShareAlike requirement, not optional — surfaced in the UI, not just here.
 */
public record StarData(
    int    hip,      // Hipparcos catalogue number, 0 if the star isn't in Hipparcos
    String proper,    // common name e.g. "Sirius" — empty string if none
    double raRad,      // right ascension, J2000, radians
    double decRad,     // declination, J2000, radians
    float  mag,        // apparent visual magnitude (lower = brighter)
    float  ci          // B-V color index — NaN if unknown for this star
) {}
