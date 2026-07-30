package com.starmap.service;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * Generates synthetic NMEA sentences for testing without physical hardware.
 * Simulates a slow walk around the IIT Bombay / Powai area (Mumbai).
 *
 * Enabled when gps.simulate=true in application.properties.
 */
@Component
public class GpsSimulator {

    // Walk waypoints around Powai Lake, Mumbai
    private static final double[][] WAYPOINTS = {
        {19.1334, 72.9133},
        {19.1345, 72.9155},
        {19.1362, 72.9172},
        {19.1378, 72.9190},
        {19.1390, 72.9210},
        {19.1375, 72.9228},
        {19.1355, 72.9215},
        {19.1340, 72.9198},
        {19.1322, 72.9180},
        {19.1310, 72.9160},
        {19.1320, 72.9140},
        {19.1334, 72.9133},
    };

    // Simulated satellites matching the real Hiwonder module output seen in GnssToolKit3
    // Format: { rawPrn, elevation, azimuth, snr }
    // GPS (GP talker, prefix G)
    private static final int[][] GPS_SATS_SIM = {
        { 2, 18, 295, 31}, { 7, 42, 200, 36}, { 8, 22, 345, 28},
        { 9, 55, 185, 36}, {10, 38, 95,  31}, {18, 25, 135, 32},
        {19, 48, 120, 39}, {23, 35, 115, 30}, {24, 62, 70,  25},
        {25, 28, 128, 20}, {26, 52, 100, 35}, {27, 20, 255, 34},
        {28, 45, 110, 37}, {31, 30, 215, 33}, {32, 40, 330, 28},
    };
    // BeiDou (BD talker, prefix B)
    private static final int[][] BDS_SATS_SIM = {
        { 1, 72,  20, 36}, { 6, 45, 115, 31}, { 7, 38, 200, 32},
        { 9, 60,  55, 31}, {10, 30, 165, 28}, {14, 55,  45, 30},
        {19, 48, 128, 25}, {21, 35,  52, 36}, {24, 25, 155, 34},
        {31, 20, 215, 33}, {32, 50, 330, 37}, {33, 28, 300, 28},
        {34, 18, 238, 24}, {42, 65,  30, 39},
    };
    // GLONASS (GL talker, prefix R)
    private static final int[][] GLN_SATS_SIM = {
        { 2, 15, 285, 20}, { 8, 32, 345, 25}, {24, 48, 310, 28},
    };
    // Galileo (GA talker, prefix E)
    private static final int[][] GAL_SATS_SIM = {
        {10, 42, 100, 35}, {23, 55, 115, 34}, {25, 28, 128, 37},
    };
    // QZSS (QZ talker, prefix Q)
    private static final int[][] QZS_SATS_SIM = {
        {19, 52, 130, 32},
    };

    private static final DateTimeFormatter NMEA_TIME_FMT =
            DateTimeFormatter.ofPattern("HHmmss").withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter NMEA_DATE_FMT =
            DateTimeFormatter.ofPattern("ddMMyy").withZone(ZoneOffset.UTC);

    private int    waypointIdx  = 0;
    private double interpFrac   = 0.0;
    private final Random rng    = new Random();

    /**
     * Returns a list of NMEA sentences representing one "tick" (~1 second).
     */
    public List<String> nextSentences() {
        List<String> lines = new ArrayList<>();
        Instant now = Instant.now();

        interpFrac += 0.04;
        if (interpFrac >= 1.0) {
            interpFrac = 0.0;
            waypointIdx = (waypointIdx + 1) % (WAYPOINTS.length - 1);
        }

        double[] from = WAYPOINTS[waypointIdx];
        double[] to   = WAYPOINTS[waypointIdx + 1];
        double lat = from[0] + (to[0] - from[0]) * interpFrac + (rng.nextDouble() - 0.5) * 0.00005;
        double lon = from[1] + (to[1] - from[1]) * interpFrac + (rng.nextDouble() - 0.5) * 0.00005;
        double alt = 14.5 + rng.nextDouble() * 2.0;

        String timeStr = NMEA_TIME_FMT.format(now);
        String dateStr = NMEA_DATE_FMT.format(now);

        lines.add(buildGGA(lat, lon, alt, timeStr));
        lines.add(buildRMC(lat, lon, timeStr, dateStr));
        lines.addAll(buildGSVGroup("GP", GPS_SATS_SIM));
        lines.addAll(buildGSVGroup("BD", BDS_SATS_SIM));
        lines.addAll(buildGSVGroup("GL", GLN_SATS_SIM));
        lines.addAll(buildGSVGroup("GA", GAL_SATS_SIM));
        lines.addAll(buildGSVGroup("QZ", QZS_SATS_SIM));
        lines.addAll(buildGSA());
        return lines;
    }

    // ── NMEA sentence builders ────────────────────────────────────────────────

    private String buildGGA(double lat, double lon, double alt, String t) {
        String latStr = decdegToNmea(Math.abs(lat));
        String lonStr = decdegToNmea(Math.abs(lon));
        String body = String.format("GNGGA,%s,%s,%s,%s,%s,1,25,0.7,%.1f,M,0.0,M,,",
                t, latStr, lat >= 0 ? "N" : "S",
                lonStr, lon >= 0 ? "E" : "W", alt);
        return "$" + body + "*" + checksum(body);
    }

    private String buildRMC(double lat, double lon, String t, String d) {
        String latStr = decdegToNmea(Math.abs(lat));
        String lonStr = decdegToNmea(Math.abs(lon));
        String body = String.format("GNRMC,%s,A,%s,%s,%s,%s,0.2,0.0,%s,,,A",
                t, latStr, lat >= 0 ? "N" : "S",
                lonStr, lon >= 0 ? "E" : "W", d);
        return "$" + body + "*" + checksum(body);
    }

    private List<String> buildGSVGroup(String talker, int[][] sats) {
        List<String> out    = new ArrayList<>();
        int total           = sats.length;
        if (total == 0) return out;
        int numMsgs         = (int) Math.ceil(total / 4.0);

        for (int msg = 1; msg <= numMsgs; msg++) {
            StringBuilder sb = new StringBuilder();
            sb.append(String.format("%sGSV,%d,%d,%02d", talker, numMsgs, msg, total));
            for (int i = (msg - 1) * 4; i < Math.min(msg * 4, total); i++) {
                int[] s   = sats[i];
                int   snr = Math.max(0, s[3] + rng.nextInt(5) - 2);
                sb.append(String.format(",%02d,%02d,%03d,%02d", s[0], s[1], s[2], snr));
            }
            String body = sb.toString();
            out.add("$" + body + "*" + checksum(body));
        }
        return out;
    }

    private List<String> buildGSA() {
        List<String> out = new ArrayList<>();

        // GPS GSA
        out.add(buildGSASentence("GP", GPS_SATS_SIM, 9, "1.2,0.9,0.8"));
        // BeiDou GSA
        out.add(buildGSASentence("BD", BDS_SATS_SIM, 9, "1.3,1.0,0.9"));
        // GLONASS GSA
        out.add(buildGSASentence("GL", GLN_SATS_SIM, 3, "1.5,1.2,0.9"));
        // Galileo GSA
        out.add(buildGSASentence("GA", GAL_SATS_SIM, 3, "1.4,1.1,0.9"));
        // QZSS GSA
        out.add(buildGSASentence("QZ", QZS_SATS_SIM, 1, "1.3,1.0,0.9"));

        return out;
    }

    private String buildGSASentence(String talker, int[][] sats, int usedCount, String dop) {
        StringBuilder sb = new StringBuilder(talker + "GSA,A,3");
        int count = 0;
        for (int[] s : sats) {
            if (count >= usedCount) break;
            sb.append(String.format(",%02d", s[0]));
            count++;
        }
        while (count++ < 12) sb.append(",");
        sb.append(",").append(dop);
        String body = sb.toString();
        return "$" + body + "*" + checksum(body);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Decimal degrees → NMEA DDDMM.MMMMM */
    private String decdegToNmea(double dd) {
        int    deg  = (int) dd;
        double min  = (dd - deg) * 60.0;
        return String.format("%02d%08.5f", deg, min);
    }

    private String checksum(String body) {
        int cs = 0;
        for (char c : body.toCharArray()) cs ^= c;
        return String.format("%02X", cs);
    }
}
