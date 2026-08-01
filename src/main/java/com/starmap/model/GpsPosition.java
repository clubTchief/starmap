package com.starmap.model;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * WGS-84 position fix from the Hiwonder GPS module.
 * Field names match what index.html reads from snap.position.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class GpsPosition {

    /** 0 = no fix, 1 = GPS, 2 = DGPS */
    public int    fixQuality;
    public boolean simulated;     // true when running via gps.simulate=true
    public double latitude;       // degrees N positive
    public double longitude;      // degrees E positive
    public double altitude;       // metres above MSL
    public double hdop;           // horizontal dilution of precision
    public int    satellitesUsed;
    public String utcTime;        // ISO-8601 string e.g. "2024-06-24T10:30:00Z"
    public long   epochMillis;    // wall-clock epoch for track duration calc

    // ECEF / ECI (populated by FrameService if a fix is present)
    public Double ecefX, ecefY, ecefZ;
    public Double eciX,  eciY,  eciZ;
}
