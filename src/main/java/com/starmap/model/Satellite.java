package com.starmap.model;

/**
 * One satellite in view, parsed from GSV + GSA sentences.
 * Field names match what index.html reads in updateSkyTab / updateSatList.
 */
public class Satellite {
    public String prn;           // e.g. "G05", "R12", "E07", "C03"
    public String constellation; // "GPS" | "GLONASS" | "GALILEO" | "BEIDOU"
    public int    elevation;     // degrees above horizon (0–90)
    public int    azimuth;       // degrees clockwise from N (0–360)
    public int    snr;           // signal/noise ratio dB-Hz (0 = not tracked)
    public boolean used;         // true if used in the current position fix
}
