package com.starmap.config;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class GoogleIdTokenAuthenticatorTest {

    private final JwtDecoder jwtDecoder = mock(JwtDecoder.class);

    @Test
    void allowsOnlyVerifiedAllowlistedEmailsCaseInsensitively() {
        GoogleIdTokenAuthenticator authenticator =
            new GoogleIdTokenAuthenticator("web-client-id", "Admin@Example.com", jwtDecoder);
        when(jwtDecoder.decode("allowed")).thenReturn(token("admin@example.com", true));
        when(jwtDecoder.decode("unverified")).thenReturn(token("admin@example.com", false));
        when(jwtDecoder.decode("other")).thenReturn(token("other@example.com", true));

        assertTrue(authenticator.isAuthorized("allowed"));
        assertFalse(authenticator.isAuthorized("unverified"));
        assertFalse(authenticator.isAuthorized("other"));
    }

    @Test
    void requiresAnEmailAllowlistWhenGoogleSignInIsEnabled() {
        assertThrows(IllegalStateException.class,
            () -> new GoogleIdTokenAuthenticator("web-client-id", "", jwtDecoder));
    }

    @Test
    void disablesGoogleSignInWhenClientIdIsUnset() {
        GoogleIdTokenAuthenticator authenticator =
            new GoogleIdTokenAuthenticator("", "", jwtDecoder);

        assertFalse(authenticator.isEnabled());
        assertFalse(authenticator.isAuthorized("id-token"));
        verifyNoInteractions(jwtDecoder);
    }

    @Test
    void acceptsOnlyTokensForTheConfiguredAudience() {
        var validator = GoogleIdTokenConfiguration.audienceValidator("web-client-id");

        assertFalse(validator.validate(token("admin@example.com", true, "web-client-id")).hasErrors());
        assertTrue(validator.validate(token("admin@example.com", true, "other-client-id")).hasErrors());
        assertTrue(validator.validate(token("admin@example.com", true, List.of("web-client-id", "other"),
            null)).hasErrors());
        assertTrue(validator.validate(token("admin@example.com", true, "web-client-id", "other-client-id"))
            .hasErrors());
    }

    @Test
    void acceptsOnlyGoogleTokenIssuers() {
        var validator = GoogleIdTokenConfiguration.issuerValidator();

        assertFalse(validator.validate(token("admin@example.com", true, "web-client-id")).hasErrors());
        assertTrue(validator.validate(token("admin@example.com", true, List.of("web-client-id"),
            "https://attacker.example", null)).hasErrors());
    }

    @Test
    void requiresExpirationIssueTimeAndSubjectClaims() {
        var validator = GoogleIdTokenConfiguration.requiredClaimsValidator();
        Jwt incompleteToken = Jwt.withTokenValue("incomplete")
            .header("alg", "RS256")
            .issuer("https://accounts.google.com")
            .audience(List.of("web-client-id"))
            .build();

        assertFalse(validator.validate(token("admin@example.com", true)).hasErrors());
        assertTrue(validator.validate(incompleteToken).hasErrors());
    }

    @Test
    void rejectsExpiredTokensWithTheConfiguredGoogleValidators() {
        var validator = GoogleIdTokenConfiguration.googleIdTokenValidator("web-client-id");
        Instant now = Instant.now();
        Jwt expiredToken = Jwt.withTokenValue("expired")
            .header("alg", "RS256")
            .claim("email", "admin@example.com")
            .claim("email_verified", true)
            .audience(List.of("web-client-id"))
            .issuer("https://accounts.google.com")
            .subject("user-123")
            .issuedAt(now.minusSeconds(600))
            .expiresAt(now.minusSeconds(300))
            .build();

        assertTrue(validator.validate(expiredToken).hasErrors());
    }

    private static Jwt token(String email, boolean emailVerified) {
        return token(email, emailVerified, "web-client-id");
    }

    private static Jwt token(String email, boolean emailVerified, String audience) {
        return token(email, emailVerified, List.of(audience), "https://accounts.google.com", null);
    }

    private static Jwt token(String email, boolean emailVerified, String audience, String authorizedParty) {
        return token(email, emailVerified, List.of(audience), "https://accounts.google.com", authorizedParty);
    }

    private static Jwt token(String email, boolean emailVerified, List<String> audiences, String authorizedParty) {
        return token(email, emailVerified, audiences, "https://accounts.google.com", authorizedParty);
    }

    private static Jwt token(String email, boolean emailVerified, List<String> audiences, String issuer,
                             String authorizedParty) {
        Instant now = Instant.now();
        Jwt.Builder builder = Jwt.withTokenValue("test-token")
            .header("alg", "RS256")
            .claim("email", email)
            .claim("email_verified", emailVerified)
            .audience(audiences)
            .issuer(issuer)
            .subject("user-123")
            .issuedAt(now)
            .expiresAt(now.plusSeconds(300));
        if (authorizedParty != null) {
            builder.claim("azp", authorizedParty);
        }
        return builder.build();
    }
}
