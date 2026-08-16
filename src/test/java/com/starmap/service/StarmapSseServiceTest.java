package com.starmap.service;

import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for StarmapSseService's per-IP and global connection caps.
 * register() only touches its own emitter/connection bookkeeping — none
 * of the constructor dependencies are needed for this behaviour, so they're
 * passed as null rather than standing up a full Spring context.
 */
class StarmapSseServiceTest {

    private final StarmapSseService svc =
        new StarmapSseService(null, null, null, null, null, null);

    @Test
    void allowsConnectionsUpToPerIpCap() {
        List<SseEmitter> granted = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            SseEmitter e = svc.register("203.0.113.10");
            assertNotNull(e, "Connection " + (i + 1) + " of 5 should be allowed");
            granted.add(e);
        }
    }

    @Test
    void rejectsConnectionBeyondPerIpCap() {
        String ip = "203.0.113.20";
        for (int i = 0; i < 5; i++) {
            assertNotNull(svc.register(ip), "First 5 connections from one IP should succeed");
        }
        SseEmitter sixth = svc.register(ip);
        assertNull(sixth, "A 6th concurrent connection from the same IP should be rejected");
    }

    @Test
    void differentIpsAreTrackedIndependently() {
        for (int i = 0; i < 5; i++) {
            assertNotNull(svc.register("203.0.113.30"));
        }
        // A different client shouldn't be blocked by another IP's cap.
        assertNotNull(svc.register("203.0.113.31"),
            "A different client IP should not be affected by another IP's connection cap");
    }

    @Test
    void releasingAConnectionFreesUpItsSlot() {
        String ip = "203.0.113.40";
        SseEmitter first = svc.register(ip);
        assertNotNull(first);

        // Exercises the actual release logic directly (the same method
        // Spring's onCompletion/onTimeout/onError callbacks invoke inside
        // register()), rather than depending on Spring's internal
        // request-lifecycle wiring, which a plain unit test doesn't have —
        // calling emitter.complete() alone here would not fire those
        // callbacks the way it does inside a real HTTP request.
        svc.releaseConnection(ip, first);

        // With the slot freed, five more should be grantable.
        for (int i = 0; i < 5; i++) {
            assertNotNull(svc.register(ip), "Connection " + (i + 1) + " after release should succeed");
        }
    }
}
