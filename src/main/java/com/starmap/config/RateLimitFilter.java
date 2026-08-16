package com.starmap.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * A deliberately simple in-memory, fixed-window, per-IP rate limiter for the
 * REST endpoints under /api/** (everything except /api/stream, which is
 * long-lived and rate-limited separately by connection count in
 * StarmapSseService rather than by request rate).
 *
 * This is intentionally not a distributed/production-grade limiter (no
 * Redis, no sliding window, resets on restart) — it's cheap insurance
 * against a single misbehaving client hammering the REST endpoints, sized
 * for a small single-instance deployment. If STARMAP ever runs multiple
 * instances behind a load balancer, replace this with a shared store
 * (e.g. Redis + Bucket4j) since per-instance counters won't coordinate.
 */
@Component
@Order(1)
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RateLimitFilter.class);

    private static final int    LIMIT_PER_WINDOW = 60;      // requests
    private static final long   WINDOW_MS        = 60_000L; // 1 minute

    private record Bucket(AtomicInteger count, AtomicLong windowStart) {}

    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                     FilterChain chain) throws ServletException, IOException {

        String path = request.getRequestURI();
        if (!path.startsWith("/api/") || path.equals("/api/stream")) {
            chain.doFilter(request, response);
            return;
        }

        String clientIp = clientIp(request);
        long now = System.currentTimeMillis();
        Bucket bucket = buckets.computeIfAbsent(clientIp,
            k -> new Bucket(new AtomicInteger(0), new AtomicLong(now)));

        synchronized (bucket) {
            if (now - bucket.windowStart().get() > WINDOW_MS) {
                bucket.windowStart().set(now);
                bucket.count().set(0);
            }
            int current = bucket.count().incrementAndGet();
            if (current > LIMIT_PER_WINDOW) {
                log.warn("Rate limit exceeded for {} on {} ({} requests this window)",
                          clientIp, path, current);
                response.setStatus(429);
                response.setContentType("application/json");
                response.getWriter().write(
                    "{\"error\":\"Rate limit exceeded — please slow down.\"}");
                return;
            }
        }

        chain.doFilter(request, response);
    }

    private String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) return forwarded.split(",")[0].trim();
        return request.getRemoteAddr();
    }
}
