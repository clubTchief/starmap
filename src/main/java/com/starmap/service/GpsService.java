package com.starmap.service;

import com.fazecast.jSerialComm.SerialPort;
import com.starmap.model.FrameInspector;
import com.starmap.model.GpsPosition;
import com.starmap.model.Satellite;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/**
 * Core GPS service. On startup either:
 *   • Opens the Hiwonder GPS serial port and reads NMEA sentences on a
 *     background thread, or
 *   • Runs the built-in simulator at 1 Hz when gps.simulate=true.
 *
 * Maintains a rolling track buffer and assembles TelemetrySnapshot on demand.
 */
@Service
public class GpsService {

    private static final Logger log = LoggerFactory.getLogger(GpsService.class);

    @Value("${gps.serial.port:/dev/ttyUSB0}")
    private String serialPort;

    @Value("${gps.serial.baud:9600}")
    private int baudRate;

    @Value("${gps.simulate:false}")
    private boolean simulate;

    @Value("${gps.track.max-points:500}")
    private int maxTrackPoints;

    private final NmeaParser               nmeaParser;
    private final GpsSimulator             simulator;
    private final CoordService             coordService;
    private final SatelliteTrackingService satService;

    private final Deque<GpsPosition> trackBuffer = new ArrayDeque<>();
    private volatile boolean running = false;
    private Thread           serialThread;
    private ScheduledExecutorService simExecutor;

    public GpsService(NmeaParser nmeaParser, GpsSimulator simulator,
                      CoordService coordService, SatelliteTrackingService satService) {
        this.nmeaParser    = nmeaParser;
        this.simulator     = simulator;
        this.coordService  = coordService;
        this.satService    = satService;
    }

    // ── Accessors for StarmapSseService ──────────────────────────────────
    public NmeaParser getParser()          { return nmeaParser; }
    public CoordService getCoordService()  { return coordService; }
    public synchronized List<GpsPosition> getRecentTrack() {
        return new java.util.ArrayList<>(trackBuffer);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @PostConstruct
    public void start() {
        running = true;
        if (simulate) {
            log.info("GPS: running in SIMULATION mode (Powai walk)");
            simExecutor = Executors.newSingleThreadScheduledExecutor(
                    r -> { Thread t = new Thread(r, "gps-sim"); t.setDaemon(true); return t; });
            simExecutor.scheduleAtFixedRate(this::simTick, 0, 1, TimeUnit.SECONDS);
        } else {
            log.info("GPS: opening serial port {} at {} baud", serialPort, baudRate);
            serialThread = new Thread(this::readSerial, "gps-serial");
            serialThread.setDaemon(true);
            serialThread.start();
        }
    }

    @PreDestroy
    public void stop() {
        running = false;
        if (simExecutor != null) simExecutor.shutdownNow();
        if (serialThread != null) serialThread.interrupt();
    }

    // ── Simulation tick ───────────────────────────────────────────────────────

    private void simTick() {
        try {
            List<String> sentences = simulator.nextSentences();
            for (String line : sentences) nmeaParser.feed(line);
            appendTrack(nmeaParser.getPosition());
        } catch (Exception e) {
            log.warn("Sim tick error: {}", e.getMessage());
        }
    }

    // ── Serial port reader ────────────────────────────────────────────────────

    private void readSerial() {
        // On Windows, jSerialComm is most reliable with the \\.\COMn device path.
        // Normalize plain "COMn" → "\\.\COMn" so both forms work in config.
        String portName = serialPort;
        if (portName.matches("(?i)COM\\d+") && !portName.startsWith("\\\\.\\")) {
            portName = "\\\\.\\\\" + portName;
        }
        final String resolvedPort = portName;

        while (running) {
            SerialPort port = null;
            try {
                port = SerialPort.getCommPort(resolvedPort);
                port.setBaudRate(baudRate);
                port.setNumDataBits(8);
                port.setNumStopBits(1);
                port.setParity(SerialPort.NO_PARITY);
                port.setComPortTimeouts(SerialPort.TIMEOUT_READ_SEMI_BLOCKING, 2000, 0);

                if (!port.openPort()) {
                    log.warn("Cannot open {}. Is GnssToolKit3 or another app using it? Retrying in 5s.", resolvedPort);
                    Thread.sleep(5000);
                    continue;
                }
                log.info("Serial port {} opened", resolvedPort);

                BufferedReader reader = new BufferedReader(
                        new InputStreamReader(port.getInputStream(), StandardCharsets.US_ASCII));
                String line;
                while (running && (line = reader.readLine()) != null) {
                    nmeaParser.feed(line.trim());
                    appendTrack(nmeaParser.getPosition());
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                log.warn("Serial error: {} — reconnecting in 3s", e.getMessage());
                try { Thread.sleep(3000); } catch (InterruptedException ie) { break; }
            } finally {
                if (port != null && port.isOpen()) port.closePort();
            }
        }
    }

    // ── Track buffer ──────────────────────────────────────────────────────────

    private synchronized void appendTrack(GpsPosition pos) {
        if (pos == null || pos.fixQuality == 0) return;
        // Avoid duplicates from multiple sentences in same second
        if (!trackBuffer.isEmpty()) {
            GpsPosition last = trackBuffer.peekLast();
            if (Objects.equals(last.utcTime, pos.utcTime)) return;
        }
        GpsPosition copy = shallowCopy(pos);
        trackBuffer.addLast(copy);
        while (trackBuffer.size() > maxTrackPoints) trackBuffer.pollFirst();
    }

    // ── Snapshot assembly ─────────────────────────────────────────────────────

    // Snapshot assembly moved to StarmapSseService

    // ── Status ────────────────────────────────────────────────────────────────

    public boolean isSimulating() { return simulate; }

    public List<GpsPosition> getTrack() {
        synchronized (this) { return new ArrayList<>(trackBuffer); }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private GpsPosition shallowCopy(GpsPosition src) {
        GpsPosition c = new GpsPosition();
        c.fixQuality     = src.fixQuality;
        c.latitude       = src.latitude;
        c.longitude      = src.longitude;
        c.altitude       = src.altitude;
        c.hdop           = src.hdop;
        c.satellitesUsed = src.satellitesUsed;
        c.utcTime        = src.utcTime;
        c.epochMillis    = src.epochMillis;
        return c;
    }
}
