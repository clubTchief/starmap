package com.starmap.service;

import com.starmap.model.ObserverState;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;

/**
 * Manages the observer's geographic position.
 *
 * Priority:
 *   1. Manual override (PUT /api/observer)
 *   2. Browser Geolocation API (sent via POST /api/observer/geo)
 *   3. IP geolocation via ip-api.com (free, no key required)
 *   4. Configured default (application.properties)
 */
@Service
public class ObserverService {

    private static final Logger log = LoggerFactory.getLogger(ObserverService.class);

    @Value("${observer.default.lat:19.1334}") private double defaultLat;
    @Value("${observer.default.lon:72.9133}") private double defaultLon;
    @Value("${observer.default.alt:14.0}")    private double defaultAlt;

    private volatile ObserverState current;

    @PostConstruct
    public void init() {
        current = new ObserverState();
        current.latDeg = defaultLat;
        current.lonDeg = defaultLon;
        current.altM   = defaultAlt;
        current.source = "default";
        current.city   = "Default Location";

        // Try IP geolocation in background
        Thread t = new Thread(this::tryIpGeolocation, "ip-geo");
        t.setDaemon(true);
        t.start();
    }

    public ObserverState get() { return current; }

    public void setManual(double latDeg, double lonDeg, double altM, String city) {
        ObserverState s = new ObserverState();
        s.latDeg = latDeg; s.lonDeg = lonDeg; s.altM = altM;
        s.city   = city != null ? city : "Manual";
        s.source = "manual";
        current  = s;
        log.info("Observer set manually: {:.4f}°N {:.4f}°E", latDeg, lonDeg);
    }

    public void setFromBrowser(double latDeg, double lonDeg, double altM) {
        ObserverState s = new ObserverState();
        s.latDeg = latDeg; s.lonDeg = lonDeg; s.altM = altM;
        s.source = "geolocation";
        s.city   = "Browser Location";
        current  = s;
        log.info("Observer from browser geolocation: {}", latDeg);
    }

    private void tryIpGeolocation() {
        try {
            // ip-api.com free tier — returns JSON with lat/lon/city
            String url = "http://ip-api.com/json/?fields=lat,lon,city,country";
            HttpURLConnection conn = (HttpURLConnection)
                URI.create(url).toURL().openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            if (conn.getResponseCode() != 200) return;
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(conn.getInputStream()))) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                String json = sb.toString();
                double lat  = extractDouble(json, "lat");
                double lon  = extractDouble(json, "lon");
                String city = extractString(json, "city");
                String country = extractString(json, "country");
                ObserverState s = new ObserverState();
                s.latDeg = lat; s.lonDeg = lon; s.altM = 0;
                s.city   = city + ", " + country;
                s.source = "geolocation";
                // Only override if still on default
                if ("default".equals(current.source)) {
                    current = s;
                    log.info("Observer from IP geolocation: {} ({}, {})", s.city, lat, lon);
                }
            } finally { conn.disconnect(); }
        } catch (Exception e) {
            log.debug("IP geolocation failed: {}", e.getMessage());
        }
    }

    private double extractDouble(String json, String key) {
        String search = "\"" + key + "\":";
        int idx = json.indexOf(search);
        if (idx < 0) return 0;
        int start = idx + search.length();
        int end = start;
        while (end < json.length() && (Character.isDigit(json.charAt(end))
               || json.charAt(end) == '.' || json.charAt(end) == '-')) end++;
        try { return Double.parseDouble(json.substring(start, end)); }
        catch (Exception e) { return 0; }
    }

    private String extractString(String json, String key) {
        String search = "\"" + key + "\":\"";
        int idx = json.indexOf(search);
        if (idx < 0) return "";
        int start = idx + search.length();
        int end = json.indexOf('"', start);
        return end > start ? json.substring(start, end) : "";
    }

    /** Called by StarmapSseService on every GPS fix to update observer position. */
    public void setFromGps(double latDeg, double lonDeg, double altM) {
        if ("manual".equals(current.source)) return;
        ObserverState s = new ObserverState();
        s.latDeg = latDeg; s.lonDeg = lonDeg; s.altM = altM;
        s.source = "gnss"; s.city = current.city;
        current = s;
    }
}
