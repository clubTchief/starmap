package com.starmap.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.util.StringUtils;

import java.util.Set;

@Configuration
public class GoogleIdTokenConfiguration {

    private static final Set<String> GOOGLE_ISSUERS = Set.of(
        "https://accounts.google.com",
        "accounts.google.com"
    );
    private static final String GOOGLE_JWK_SET_URI = "https://www.googleapis.com/oauth2/v3/certs";

    @Bean
    JwtDecoder googleIdTokenDecoder(@Value("${starmap.auth.google.client-id:}") String clientId) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(GOOGLE_JWK_SET_URI).build();
        decoder.setJwtValidator(googleIdTokenValidator(clientId.trim()));
        return decoder;
    }

    static OAuth2TokenValidator<Jwt> googleIdTokenValidator(String clientId) {
        return new DelegatingOAuth2TokenValidator<>(
            JwtValidators.createDefault(),
            requiredClaimsValidator(),
            issuerValidator(),
            audienceValidator(clientId)
        );
    }

    static OAuth2TokenValidator<Jwt> requiredClaimsValidator() {
        return jwt -> jwt.getExpiresAt() != null
            && jwt.getIssuedAt() != null
            && StringUtils.hasText(jwt.getSubject())
            ? OAuth2TokenValidatorResult.success()
            : OAuth2TokenValidatorResult.failure(
                new OAuth2Error("invalid_token", "Required Google token claims are missing", null));
    }

    static OAuth2TokenValidator<Jwt> issuerValidator() {
        return jwt -> GOOGLE_ISSUERS.contains(String.valueOf(jwt.getIssuer()))
            ? OAuth2TokenValidatorResult.success()
            : OAuth2TokenValidatorResult.failure(
                new OAuth2Error("invalid_token", "Invalid Google token issuer", null));
    }

    static OAuth2TokenValidator<Jwt> audienceValidator(String clientId) {
        return jwt -> {
            String authorizedParty = jwt.getClaimAsString("azp");
            boolean audienceIsValid = jwt.getAudience().contains(clientId)
                && (authorizedParty == null || clientId.equals(authorizedParty))
                && (jwt.getAudience().size() == 1 || clientId.equals(authorizedParty));
            return audienceIsValid
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(
                    new OAuth2Error("invalid_token", "Invalid Google token audience", null));
        };
    }
}
