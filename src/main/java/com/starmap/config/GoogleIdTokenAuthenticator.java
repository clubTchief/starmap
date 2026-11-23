package com.starmap.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public class GoogleIdTokenAuthenticator {

    private final String clientId;
    private final Set<String> allowedEmails;
    private final JwtDecoder jwtDecoder;

    public GoogleIdTokenAuthenticator(
        @Value("${starmap.auth.google.client-id:}") String clientId,
        @Value("${starmap.auth.allowed-emails:}") String allowedEmails,
        JwtDecoder jwtDecoder
    ) {
        this.clientId = clientId.trim();
        this.allowedEmails = Arrays.stream(allowedEmails.split(","))
            .map(String::trim)
            .filter(StringUtils::hasText)
            .map(email -> email.toLowerCase(Locale.ROOT))
            .collect(Collectors.toUnmodifiableSet());
        this.jwtDecoder = jwtDecoder;

        if (isEnabled() && this.allowedEmails.isEmpty()) {
            throw new IllegalStateException(
                "STARMAP_ALLOWED_EMAILS must contain at least one email when STARMAP_GOOGLE_CLIENT_ID is set.");
        }
    }

    public boolean isEnabled() {
        return StringUtils.hasText(clientId);
    }

    public boolean isAuthorized(String idToken) {
        if (!isEnabled()) {
            return false;
        }

        Jwt jwt = jwtDecoder.decode(idToken);
        String email = jwt.getClaimAsString("email");
        return Boolean.TRUE.equals(jwt.getClaim("email_verified"))
            && email != null
            && allowedEmails.contains(email.toLowerCase(Locale.ROOT));
    }
}
