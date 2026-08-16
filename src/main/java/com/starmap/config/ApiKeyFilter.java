package com.starmap.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Requires a shared API key on the WRITE endpoints only:
 *   PUT  /api/observer
 *   POST /api/observer/geo
 *   POST /api/sat/add
 *   DELETE /api/sat/remove
 *   POST /api/sat/refresh
 *
 * The GNSS/telemetry read endpoints (/api/stream, /api/status,
 * /api/observer GET) and the static frontend stay completely open — this
 * is deliberately not full authentication, just a lightweight guard
 * against anyone anonymously mutating shared server state (adding
 * satellites, moving the observer position) on a public deployment.
 *
 * If starmap.api.key is left unset, this filter is a no-op (write
 * endpoints stay open) — set it via an environment variable in
 * production; never commit a real key to application.properties.
 */
@Component
@Order(2)
public class ApiKeyFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(ApiKeyFilter.class);

    @Value("${starmap.api.key:}")
    private String apiKey;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                     FilterChain chain) throws ServletException, IOException {

        if (!StringUtils.hasText(apiKey) || !isProtectedWrite(request)) {
            chain.doFilter(request, response);
            return;
        }

        String provided = request.getHeader("X-API-Key");
        if (apiKey.equals(provided)) {
            chain.doFilter(request, response);
            return;
        }

        log.warn("Rejected unauthenticated write to {} {} from {}",
                  request.getMethod(), request.getRequestURI(), request.getRemoteAddr());
        response.setStatus(401);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"Missing or invalid X-API-Key header.\"}");
    }

    private boolean isProtectedWrite(HttpServletRequest request) {
        String method = request.getMethod();
        String path = request.getRequestURI();
        boolean isWrite = "POST".equals(method) || "PUT".equals(method) || "DELETE".equals(method);
        boolean isProtectedPath = path.equals("/api/observer")
            || path.equals("/api/observer/geo")
            || path.startsWith("/api/sat/");
        return isWrite && isProtectedPath;
    }
}
