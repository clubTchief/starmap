package com.starmap.model;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Position of a solar system body expressed in all four reference frames.
 * The frontend selects which frame to use for rendering based on the active mode.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class CosmicBody {

    // ── Identity ──────────────────────────────────────────────────────────────
    public String  id;           // unique key e.g. "earth", "mars", "voyager1"
    public String  name;         // display name
    public String  category;     // "planet", "dwarf", "moon", "asteroid", "spacecraft"
    public String  color;        // hex e.g. "#4a8fd0"
    public double  radiusKm;     // physical radius for rendering
    public double  magnitude;    // approximate visual magnitude

    // ── Geocentric Equatorial (ECI / EME2000) ─────────────────────────────────
    // Origin: Earth centre.  Axes: aligned to mean equator/equinox of J2000.0
    public double[] eciM;        // [X, Y, Z] in metres
    public double   raDeg;       // right ascension (degrees)
    public double   decDeg;      // declination (degrees)
    public double   distAuGeo;   // distance from Earth in AU

    // ── Geocentric Ecliptic ───────────────────────────────────────────────────
    // Origin: Earth centre.  Reference plane: ecliptic of J2000.0
    public double[] geoEclM;     // [X, Y, Z] in metres
    public double   eclLonGeo;   // ecliptic longitude (degrees)
    public double   eclLatGeo;   // ecliptic latitude (degrees)

    // ── Heliocentric Equatorial ───────────────────────────────────────────────
    // Origin: Sun centre.  Axes: aligned to Earth equatorial plane through Sun
    public double[] helioEqM;    // [X, Y, Z] in metres from Sun
    public double   helioRaRad;  // right ascension from Sun
    public double   helioDecRad; // declination from Sun

    // ── Heliocentric Ecliptic ─────────────────────────────────────────────────
    // Origin: Sun centre.  Reference plane: ecliptic of J2000.0
    public double[] helioEclM;   // [X, Y, Z] in metres from Sun
    public double   helioLon;    // ecliptic longitude (degrees)
    public double   helioLat;    // ecliptic latitude (degrees)
    public double   distAuHelio; // distance from Sun in AU

    // ── Derived quantities ────────────────────────────────────────────────────
    public double   elongationDeg;   // angle Sun-Earth-body
    public double   phaseAngleDeg;   // illumination phase angle
    public double   lightTimeMin;    // one-way light travel time from body to Earth (minutes)
}
