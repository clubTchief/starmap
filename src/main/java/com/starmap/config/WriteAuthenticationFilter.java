package com.starmap.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

@Component
@Order(2)
public class WriteAuthenticationFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(WriteAuthenticationFilter.class);

    private final String apiKey;
    private final boolean allowAnonymousWrites;
    private final GoogleIdTokenAuthenticator googleAuthenticator;

    public WriteAuthenticationFilter(
        @Value("${starmap.api.key:}") String apiKey,
        @Value("${starmap.auth.allow-anonymous-writes:false}") boolean allowAnonymousWrites,
        GoogleIdTokenAuthenticator googleAuthenticator
    ) {
        this.apiKey = apiKey;
        this.allowAnonymousWrites = allowAnonymousWrites;
        this.googleAuthenticator = googleAuthenticator;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        if (!isProtectedWrite(request)) {
            chain.doFilter(request, response);
            return;
        }

        String authorization = request.getHeader("Authorization");
        if (googleAuthenticator.isEnabled() && authorization != null && authorization.startsWith("Bearer ")) {
            String idToken = authorization.substring("Bearer ".length()).trim();
            try {
                if (StringUtils.hasText(idToken) && googleAuthenticator.isAuthorized(idToken)) {
                    chain.doFilter(request, response);
                    return;
                }
            } catch (JwtException exception) {
                reject(request, response);
                return;
            }
            reject(request, response);
            return;
        }

        if (StringUtils.hasText(apiKey)) {
            if (apiKey.equals(request.getHeader("X-API-Key"))) {
                chain.doFilter(request, response);
                return;
            }
            reject(request, response);
            return;
        }

        if (googleAuthenticator.isEnabled() || !allowAnonymousWrites) {
            reject(request, response);
            return;
        }

        chain.doFilter(request, response);
    }

    private void reject(HttpServletRequest request, HttpServletResponse response) throws IOException {
        log.warn("Rejected unauthenticated write to {} {} from {}",
            request.getMethod(), request.getRequestURI(), request.getRemoteAddr());
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"Authentication required for write actions.\"}");
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
