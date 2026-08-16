package com.starmap.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.starmap.model.*;
import com.starmap.service.ConstellationService;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.context.annotation.DependsOn;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Unified SSE broadcaster for STARMAP.
 *
 * Assembles a StarmapSnapshot every 1 Hz by pulling from:
 *   - GpsService       → GNSS position, satellites, track
 *   - SatelliteTrackingService → ISS + catalog satellite states
 *   - EphemerisService → all solar system bodies in all 4 frames
 *   - ObserverService  → current observer position
 *
 * A single SSE event stream ("starmap") delivers everything the frontend
 * needs to render any zoom level — from the GNSS sky plot to the solar system.
 */
@Service
@DependsOn("orekitConfig")
public class StarmapSseService {

    private static final Logger log = LoggerFactory.getLogger(StarmapSseService.class);

    private final GpsService               gpsService;
    private final SatelliteTrackingService satService;
    private final EphemerisService         ephemerisService;
    private final ObserverService          observerService;
    private final ConstellationService     constellationService;
    private final ObjectMapper             mapper;

    private final List<SseEmitter> emitters = new CopyOnWriteArrayList<>();

    // Unbounded SSE connections were flagged as a real risk on a public
    // endpoint — cap both per-client and total concurrent streams rather
    // than letting a single client (or a script) hold the server open
    // indefinitely with no limit.
    private static final int MAX_CONNECTIONS_PER_IP = 5;
    private static final int MAX_TOTAL_CONNECTIONS   = 200;
    private final Map<String, AtomicInteger> connectionsByIp = new ConcurrentHashMap<>();

    public StarmapSseService(GpsService gps, SatelliteTrackingService sat,
                             EphemerisService eph, ObserverService obs,
                             ConstellationService constellation,
                             ObjectMapper mapper) {
        this.gpsService            = gps;
        this.satService            = sat;
        this.ephemerisService      = eph;
        this.observerService       = obs;
        this.constellationService  = constellation;
        this.mapper                = mapper;
    }

    /** Registers a new SSE client, identified by IP for rate limiting.
     *  Returns null if the caller has hit its per-IP cap or the server has
     *  hit its global connection cap — the controller turns that into a
     *  429 response rather than silently accepting an unbounded stream. */
    public SseEmitter register(String clientIp) {
        if (emitters.size() >= MAX_TOTAL_CONNECTIONS) {
            log.warn("SSE registration rejected — global connection cap ({}) reached", MAX_TOTAL_CONNECTIONS);
            return null;
        }
        AtomicInteger perIp = connectionsByIp.computeIfAbsent(clientIp, k -> new AtomicInteger(0));
        if (perIp.incrementAndGet() > MAX_CONNECTIONS_PER_IP) {
            perIp.decrementAndGet();
            log.warn("SSE registration rejected for {} — per-IP cap ({}) reached", clientIp, MAX_CONNECTIONS_PER_IP);
            return null;
        }

        SseEmitter emitter = new SseEmitter(0L);
        emitters.add(emitter);
        Runnable release = () -> {
            emitters.remove(emitter);
            AtomicInteger count = connectionsByIp.get(clientIp);
            if (count != null && count.decrementAndGet() <= 0) connectionsByIp.remove(clientIp, count);
        };
        emitter.onCompletion(release::run);
        emitter.onTimeout(release::run);
        emitter.onError(e -> release.run());
        log.debug("SSE client connected ({}) — {} total, {} from this IP",
                   clientIp, emitters.size(), perIp.get());
        return emitter;
    }

    @Scheduled(fixedRateString = "${starmap.sse.interval-ms:1000}")
    public void broadcast() {
        if (emitters.isEmpty()) return;
        try {
            AbsoluteDate epoch = new AbsoluteDate(new Date(), TimeScalesFactory.getUTC());

            // ── Build the unified snapshot ─────────────────────────────
            StarmapSnapshot snap = new StarmapSnapshot();

            // GNSS layer — comes from GpsService.buildSnapshot() internals
            GpsPosition pos   = gpsService.getParser().getPosition();
            snap.position     = pos;
            // Use live GPS satellites if fix available, otherwise use real
            // CelesTrak constellation data for accurate sky positions
            List<com.starmap.model.Satellite> gpsSats = gpsService.getParser().getSatellites();
            if (!gpsSats.isEmpty()) {
                snap.satellites = gpsSats;
            } else {
                ObserverState obsForSats = observerService.get();
                snap.satellites = constellationService.getCurrentSatellites(
                    epoch,
                    obsForSats.latDeg,
                    obsForSats.lonDeg,
                    obsForSats.altM
                );
            }
            snap.gpsUtc       = pos.utcTime;
            snap.recentTrack  = gpsService.getRecentTrack();

            if (pos.fixQuality > 0) {
                snap.frameInspector = gpsService.getCoordService().compute(pos);
                // Update observer from live GPS fix
                observerService.setFromGps(pos.latitude, pos.longitude, pos.altitude);
                satService.updateObserverPosition(pos.latitude, pos.longitude, pos.altitude);
            }

            // Satellite tracking layer
            snap.trackedSats = satService.buildAllStates();

            // Cosmic layer — all bodies in all 4 frames from DE430
            ObserverState obs = observerService.get();
            if (ephemerisService.isReady()) {
                snap.bodies       = ephemerisService.computeAll(epoch);
                snap.frameContext = ephemerisService.computeFrameContext(epoch, obs);
            }
            snap.observer = obs;

            // ── Broadcast ─────────────────────────────────────────────
            String json = mapper.writeValueAsString(snap);
            List<SseEmitter> dead = new ArrayList<>();
            for (SseEmitter emitter : emitters) {
                try {
                    emitter.send(SseEmitter.event().name("starmap").data(json));
                } catch (IOException e) { dead.add(emitter); }
            }
            emitters.removeAll(dead);

        } catch (Exception e) {
            log.warn("SSE broadcast error: {}", e.getMessage());
        }
    }
}
