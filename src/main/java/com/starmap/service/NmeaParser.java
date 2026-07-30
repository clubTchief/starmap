package com.starmap.service;

import com.starmap.model.GpsPosition;
import com.starmap.model.Satellite;
import org.springframework.stereotype.Component;

import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Stateful NMEA-0183 sentence parser for the Hiwonder GPS module.
 *
 * Handles:
 *   $GPGGA / $GNGGA  — position, altitude, fix quality, HDOP, sats used
 *   $GPRMC / $GNRMC  — date+time (to form full ISO-8601 UTC)
 *   $GPGSV / $GLGSV / $GAGSV / $GBGSV — satellites in view per constellation
 *   $GPGSA / $GNGSA  — satellites used in fix
 *
 * Call feed(line) with each raw NMEA line. Use getPosition() / getSatellites()
 * to read the latest parsed state.
 */
@Component
public class NmeaParser {

    // ── Current fix state ────────────────────────────────────────────────────
    private final GpsPosition position = new GpsPosition();

    // ── Satellite tracking ───────────────────────────────────────────────────
    // GSV messages arrive in multi-sentence sequences; accumulate here then
    // commit when the last sentence of a sequence arrives.
    private final Map<String, Satellite> satMap   = new LinkedHashMap<>();
    private final Map<String, List<Satellite>> gsvBuffer = new HashMap<>();
    private final Set<String> usedPrns = new HashSet<>();

    // Cleared once per fix epoch (on first GSA of the cycle).
    // Reset by each new GGA so the next GSA batch starts fresh.
    private boolean gsaClearedThisCycle = false;

    // Last RMC date (DDMMYY) to combine with GGA time
    private String lastRmcDate = null;

    // ── Public API ───────────────────────────────────────────────────────────

    public synchronized void feed(String line) {
        if (line == null || line.isEmpty()) return;
        if (!validateChecksum(line)) return;

        // Strip leading $ and checksum
        final int star = line.indexOf('*');
        final String body = line.startsWith("$")
                ? line.substring(1, star > 0 ? star : line.length())
                : line.substring(0, star > 0 ? star : line.length());

        final String[] f = body.split(",", -1);
        if (f.length == 0) return;

        switch (f[0].toUpperCase()) {
            case "GPGGA", "GNGGA", "GLGGA", "GAGGA", "GBGGA", "BDGGA", "QZGGA" -> parseGGA(f);
            case "GPRMC", "GNRMC", "BDRMC"                                       -> parseRMC(f);
            case "GPGSV", "GLGSV", "GAGSV", "GBGSV", "BDGSV", "QZGSV"          -> parseGSV(f);
            case "GPGSA", "GNGSA", "GLGSA", "GAGSA", "GBGSA", "BDGSA", "QZGSA" -> parseGSA(f);
        }
    }

    public synchronized GpsPosition getPosition() {
        return position;
    }

    public synchronized List<Satellite> getSatellites() {
        return new ArrayList<>(satMap.values());
    }

    // ── GGA — fix, position, altitude ───────────────────────────────────────
    private void parseGGA(String[] f) {
        // f[0]=talker+GGA, f[1]=hhmmss.ss, f[2]=lat, f[3]=N/S,
        // f[4]=lon, f[5]=E/W, f[6]=fixQ, f[7]=satsUsed, f[8]=hdop,
        // f[9]=alt, f[10]=M
        if (f.length < 10) return;
        try {
            position.fixQuality     = parseInt(f[6]);
            position.satellitesUsed = parseInt(f[7]);
            position.hdop           = parseDouble(f[8]);
            position.altitude       = parseDouble(f[9]);
            position.latitude       = parseLatLon(f[2], f[3]);
            position.longitude      = parseLatLon(f[4], f[5]);
            position.epochMillis    = System.currentTimeMillis();
            buildUtcTime(f[1]);
            gsaClearedThisCycle = false;  // allow next GSA batch to clear usedPrns
        } catch (Exception ignored) {}
    }

    // ── RMC — date + time ───────────────────────────────────────────────────
    private void parseRMC(String[] f) {
        // f[9] = DDMMYY
        if (f.length > 9 && !f[9].isEmpty()) {
            lastRmcDate = f[9];
            buildUtcTime(f[1]);
        }
    }

    private void buildUtcTime(String hhmmss) {
        if (hhmmss == null || hhmmss.length() < 6) return;
        try {
            int hh = Integer.parseInt(hhmmss.substring(0, 2));
            int mm = Integer.parseInt(hhmmss.substring(2, 4));
            int ss = Integer.parseInt(hhmmss.substring(4, 6));

            String dateStr;
            if (lastRmcDate != null && lastRmcDate.length() == 6) {
                int day  = Integer.parseInt(lastRmcDate.substring(0, 2));
                int mon  = Integer.parseInt(lastRmcDate.substring(2, 4));
                int year = 2000 + Integer.parseInt(lastRmcDate.substring(4, 6));
                dateStr  = String.format("%04d-%02d-%02d", year, mon, day);
            } else {
                dateStr = ZonedDateTime.now(ZoneOffset.UTC)
                        .format(DateTimeFormatter.ISO_LOCAL_DATE);
            }
            position.utcTime = String.format("%sT%02d:%02d:%02dZ", dateStr, hh, mm, ss);
        } catch (Exception ignored) {}
    }

    // ── GSV — satellites in view ─────────────────────────────────────────────
    private void parseGSV(String[] f) {
        if (f.length < 4) return;
        try {
            String talker = f[0].substring(0, 2).toUpperCase();
            String cons   = constellationFromTalker(talker);
            String prefix = prnPrefix(talker);

            int totalMsgs = parseInt(f[1]);
            int msgNum    = parseInt(f[2]);

            gsvBuffer.computeIfAbsent(talker, k -> new ArrayList<>());

            // Detect NMEA 4.10 signal-ID extension: each sat block is 5 fields
            // (prn, elev, az, snr, sigId) instead of standard 4.
            int dataFields = f.length - 4;
            int blockSize  = (dataFields > 0 && dataFields % 5 == 0) ? 5 : 4;

            for (int i = 4; i + 3 <= f.length - 1; i += blockSize) {
                if (f[i].isEmpty()) continue;
                Satellite s     = new Satellite();
                s.prn           = prefix + String.format("%02d", parseInt(f[i]));
                s.constellation = cons;
                s.elevation     = parseInt(f[i + 1]);
                s.azimuth       = parseInt(f[i + 2]);
                s.snr           = (i + 3 <= f.length - 1 && !f[i + 3].isEmpty())
                                  ? parseInt(f[i + 3]) : 0;
                s.used          = usedPrns.contains(s.prn);
                gsvBuffer.get(talker).add(s);
            }

            if (msgNum == totalMsgs) {
                for (Satellite s : gsvBuffer.get(talker)) {
                    s.used = usedPrns.contains(s.prn);
                    satMap.put(s.prn, s);
                }
                gsvBuffer.get(talker).clear();
            }
        } catch (Exception ignored) {}
    }

    // ── GSA — satellites used in fix ─────────────────────────────────────────
    private void parseGSA(String[] f) {
        if (f.length < 3) return;
        String talker = f[0].length() >= 2 ? f[0].substring(0, 2).toUpperCase() : "GP";

        // Clear stale used flags exactly once per fix cycle — on the first
        // GSA sentence after a fresh GGA. Subsequent GSA sentences (one per
        // constellation) add to the set without clearing it again.
        if (!gsaClearedThisCycle) {
            usedPrns.clear();
            satMap.values().forEach(s -> s.used = false);
            gsaClearedThisCycle = true;
        }

        boolean isGN = "GN".equals(talker);
        for (int i = 3; i <= 14 && i < f.length; i++) {
            if (f[i].isEmpty()) continue;
            int num = parseInt(f[i]);
            if (num == 0) continue;

            if (isGN) {
                // $GNGSA PRNs span all constellations — try every prefix
                // against satMap to find the right one. If ambiguous (same
                // PRN number exists in multiple constellations e.g. G19 and Q19),
                // mark ALL matches as used so we don't under-count.
                boolean found = false;
                for (String p : new String[]{"G","R","E","B","Q","I","S"}) {
                    String key = p + String.format("%02d", num);
                    if (satMap.containsKey(key)) {
                        usedPrns.add(key);
                        satMap.get(key).used = true;
                        found = true;
                    }
                }
                if (!found) {
                    // Not in satMap yet — store as GPS fallback; will be
                    // re-evaluated when GSV arrives
                    usedPrns.add("G" + String.format("%02d", num));
                }
            } else {
                String key = prnPrefix(talker) + String.format("%02d", num);
                usedPrns.add(key);
                Satellite s = satMap.get(key);
                if (s != null) s.used = true;
            }
        }
    }

    private String constellationFromTalker(String talker) {
        return switch (talker) {
            case "GP", "GN" -> "GPS";
            case "GL"       -> "GLONASS";
            case "GA"       -> "GALILEO";
            case "GB", "BD" -> "BEIDOU";
            case "QZ"       -> "QZSS";
            case "GI"       -> "IRNSS";
            case "GS", "SB" -> "SBAS";
            default         -> "GPS";
        };
    }

    private String prnPrefix(String talker) {
        return switch (talker) {
            case "GP", "GN" -> "G";
            case "GL"       -> "R";
            case "GA"       -> "E";
            case "GB", "BD" -> "B";   // BeiDou → B prefix (matches GnssToolKit3 display)
            case "QZ"       -> "Q";   // QZSS → Q prefix
            case "GI"       -> "I";   // IRNSS → I prefix
            case "GS", "SB" -> "S";   // SBAS → S prefix
            default         -> "G";
        };
    }

    private int parseInt(String s) {
        if (s == null || s.isEmpty()) return 0;
        try { return (int) Double.parseDouble(s.trim()); }
        catch (NumberFormatException e) { return 0; }
    }

    private double parseDouble(String s) {
        if (s == null || s.isEmpty()) return 0.0;
        try { return Double.parseDouble(s.trim()); }
        catch (NumberFormatException e) { return 0.0; }
    }

    /** NMEA lat/lon DDDMM.MMMMM → decimal degrees */
    private double parseLatLon(String raw, String dir) {
        if (raw == null || raw.isEmpty()) return 0.0;
        int dotIdx = raw.indexOf('.');
        if (dotIdx < 2) return 0.0;
        int degLen = dotIdx - 2;   // minutes are always 2 digits before the dot
        double deg = Double.parseDouble(raw.substring(0, degLen));
        double min = Double.parseDouble(raw.substring(degLen));
        double dd  = deg + min / 60.0;
        if ("S".equalsIgnoreCase(dir) || "W".equalsIgnoreCase(dir)) dd = -dd;
        return dd;
    }

    /** NMEA XOR checksum validation */
    private boolean validateChecksum(String sentence) {
        int star = sentence.lastIndexOf('*');
        if (star < 1 || star + 2 >= sentence.length()) return true; // no checksum — accept
        try {
            int expected = Integer.parseInt(sentence.substring(star + 1, star + 3), 16);
            int calc = 0;
            for (int i = 1; i < star; i++) calc ^= sentence.charAt(i);
            return calc == expected;
        } catch (Exception e) { return false; }
    }
}
