package com.starmap.model;

/**
 * Per-mode HUD quantities computed by Orekit and sent with every SSE tick.
 * The frontend displays the fields relevant to the currently active mode.
 */
public class FrameContext {

    // ── Universal ─────────────────────────────────────────────────────────────
    public String epochUtc;          // ISO-8601 UTC e.g. "2026-06-28T15:29:14Z"
    public String epochTt;           // Terrestrial Time
    public double jd;                // Julian Date (TT)
    public double mjd;               // Modified Julian Date

    // ── Mode 1: Geocentric + Equatorial (ECI) ────────────────────────────────
    public double gmstDeg;           // Greenwich Mean Sidereal Time (degrees)
    public double gastDeg;           // Greenwich Apparent Sidereal Time (degrees)
    public double lstDeg;            // Local Sidereal Time at observer (degrees)
    public double eraRad;            // Earth Rotation Angle (radians)
    public String equinoxType;       // "vernal" | "autumnal"

    // ── Mode 2: Geocentric + Ecliptic ────────────────────────────────────────
    public double obliquityDeg;      // true obliquity of the ecliptic (degrees, ~23.44°)
    public double sunEclLonDeg;      // Sun's geocentric ecliptic longitude (degrees)
    public double sunEclLatDeg;      // Sun's ecliptic latitude (near 0)
    public String season;            // "Spring" | "Summer" | "Autumn" | "Winter" (N hemisphere)
    public double daysToNextSolstice;// days until next solstice/equinox

    // ── Mode 3 & 4: Heliocentric ─────────────────────────────────────────────
    public double earthHelioLonDeg;  // Earth's heliocentric ecliptic longitude
    public double earthHelioLatDeg;  // Earth's heliocentric ecliptic latitude
    public double earthDistAu;       // Earth-Sun distance in AU
    public double earthVelKms;       // Earth's orbital velocity in km/s

    // ── Observer ──────────────────────────────────────────────────────────────
    public double obsLatDeg;
    public double obsLonDeg;
    public double obsAltM;
    public String obsCity;           // reverse-geocoded city name (from IP geolocation)
}
