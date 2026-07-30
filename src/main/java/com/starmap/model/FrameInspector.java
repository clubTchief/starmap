package com.starmap.model;

/**
 * Coordinate-frame snapshot for the FRAMES inspector tab.
 * Matches the fields read by updateFrameTab() in index.html.
 */
public class FrameInspector {
    public double latDeg;
    public double lonDeg;
    public double altM;

    // ECEF (metres)
    public double ecefX;
    public double ecefY;
    public double ecefZ;
    public double rangeFromEarthCenterKm;

    // ECI J2000 (metres)
    public double eciX;
    public double eciY;
    public double eciZ;

    /** ISO-8601 UTC epoch used for the GMST rotation */
    public String epoch;
}
