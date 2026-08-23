package com.starmap.controller;

import com.starmap.service.*;
import com.starmap.model.ObserverState;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;

/**
 * Unified REST + SSE controller for STARMAP.
 *
 * GET  /api/stream           → SSE "starmap" events at 1 Hz
 * GET  /api/status           → app health and readiness
 * GET  /api/stars            → static naked-eye star catalogue (once, not SSE)
 * GET  /api/observer         → current observer position
 * PUT  /api/observer         → manually set observer position
 * POST /api/observer/geo     → set from browser geolocation
 * POST /api/sat/add          → add a satellite by NORAD ID
 * DELETE /api/sat/remove     → stop tracking a satellite
 * POST /api/sat/refresh      → force OMM refresh from CelesTrak
 */
@RestController
@RequestMapping("/api")
public class StarmapController {

    private final StarmapSseService        sseService;
    private final ObserverService          observerService;
    private final EphemerisService         ephemerisService;
    private final GpsService               gpsService;
    private final SatelliteTrackingService satService;
    private final ConstellationService     constellationService;
    private final StarCatalogueService     starCatalogueService;

    public StarmapController(StarmapSseService sse, ObserverService obs,
                             EphemerisService eph, GpsService gps,
                             SatelliteTrackingService sat, ConstellationService constellation,
                             StarCatalogueService starCatalogue) {
        this.sseService       = sse;
        this.observerService  = obs;
        this.ephemerisService = eph;
        this.gpsService       = gps;
        this.satService       = sat;
        this.constellationService = constellation;
        this.starCatalogueService = starCatalogue;
    }

    /**
     * The static naked-eye star catalogue (mag <= 6.5, ~8,900 stars) —
     * served once per client, not over SSE. Az/El are computed by the
     * frontend itself from frameContext.lstDeg + observer.latDeg, same
     * pattern the existing celestial grid already uses. Deliberately a
     * plain GET, not SSE: this payload doesn't change tick-to-tick, so
     * re-sending it every second would cost real Railway egress ($0.05/GB)
     * for no benefit — a browser fetches this once and caches it.
     *
     * Star data: HYG Database v4.1, astronexus, CC BY-SA 4.0.
     */
    @GetMapping("/stars")
    public java.util.List<com.starmap.model.StarData> stars() {
        return starCatalogueService.getCatalogue();
    }

    @GetMapping(path = "/stream", produces = "text/event-stream")
    public SseEmitter stream(HttpServletRequest request) {
        String clientIp = clientIp(request);
        SseEmitter emitter = sseService.register(clientIp);
        if (emitter == null) {
            throw new org.springframework.web.server.ResponseStatusException(
                HttpStatus.TOO_MANY_REQUESTS,
                "Too many concurrent connections — please close other STARMAP tabs and retry.");
        }
        return emitter;
    }

    /** Honors X-Forwarded-For when present (Railway sits behind a proxy),
     *  falling back to the direct remote address otherwise. */
    private String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) return forwarded.split(",")[0].trim();
        return request.getRemoteAddr();
    }

    @GetMapping("/status")
    public Map<String,Object> status() {
        return Map.of(
            "gpsSimulating", gpsService.isSimulating(),
            "ephemerisReady", ephemerisService.isReady(),
            "trackedSats",    satService.trackedNoradIds(),
            "observer",       observerService.get(),
            "constellationCounts", constellationService.getCountByConstellation(),
            "staleConstellations", constellationService.getStaleConstellations()
        );
    }

    @GetMapping("/observer")
    public ObserverState getObserver() { return observerService.get(); }

    @PutMapping("/observer")
    public ResponseEntity<?> setObserver(
            @RequestParam double lat, @RequestParam double lon,
            @RequestParam(defaultValue = "0") double alt,
            @RequestParam(required = false) String city) {
        observerService.setManual(lat, lon, alt, city);
        return ResponseEntity.ok(observerService.get());
    }

    @PostMapping("/observer/geo")
    public ResponseEntity<?> setObserverGeo(
            @RequestParam double lat, @RequestParam double lon,
            @RequestParam(defaultValue = "0") double alt) {
        observerService.setFromBrowser(lat, lon, alt);
        return ResponseEntity.ok(observerService.get());
    }

    @PostMapping("/sat/add")
    public ResponseEntity<?> addSat(@RequestParam int noradId) {
        try {
            return ResponseEntity.ok(satService.addSatellite(noradId));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/sat/remove")
    public ResponseEntity<?> removeSat(@RequestParam int noradId) {
        satService.removeSatellite(noradId);
        return ResponseEntity.ok(Map.of("removed", noradId));
    }

    @PostMapping("/sat/refresh")
    public ResponseEntity<?> refreshSat(@RequestParam int noradId) {
        satService.fetchOmm(noradId);
        return ResponseEntity.ok(Map.of("status", "refresh requested", "noradId", noradId));
    }
}
