package com.starmap.config;

import jakarta.servlet.ServletException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.jwt.JwtException;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class WriteAuthenticationFilterTest {

    @Test
    void protectedWriteIsDeniedWhenNoAuthenticationIsConfigured() throws Exception {
        GoogleIdTokenAuthenticator googleAuthenticator = mock(GoogleIdTokenAuthenticator.class);
        when(googleAuthenticator.isEnabled()).thenReturn(false);
        WriteAuthenticationFilter filter = new WriteAuthenticationFilter("", false, googleAuthenticator);

        MockHttpServletResponse response = invoke(filter, "POST", "/api/sat/add", null, null);

        assertEquals(401, response.getStatus());
        assertTrue(response.getContentAsString().contains("Authentication required"));
    }

    @Test
    void readsRemainPublic() throws Exception {
        GoogleIdTokenAuthenticator googleAuthenticator = mock(GoogleIdTokenAuthenticator.class);
        WriteAuthenticationFilter filter = new WriteAuthenticationFilter("", false, googleAuthenticator);
        AtomicBoolean continued = new AtomicBoolean();

        filter.doFilterInternal(request("GET", "/api/observer", null, null), new MockHttpServletResponse(),
            (request, response) -> continued.set(true));

        assertTrue(continued.get());
    }

    @Test
    void sharedApiKeyRemainsAvailableForApiClients() throws Exception {
        GoogleIdTokenAuthenticator googleAuthenticator = mock(GoogleIdTokenAuthenticator.class);
        when(googleAuthenticator.isEnabled()).thenReturn(false);
        WriteAuthenticationFilter filter = new WriteAuthenticationFilter("secret", false, googleAuthenticator);
        AtomicBoolean continued = new AtomicBoolean();

        filter.doFilterInternal(request("PUT", "/api/observer", null, "secret"), new MockHttpServletResponse(),
            (request, response) -> continued.set(true));

        assertTrue(continued.get());
    }

    @Test
    void approvedGoogleTokenAuthorizesWrite() throws Exception {
        GoogleIdTokenAuthenticator googleAuthenticator = mock(GoogleIdTokenAuthenticator.class);
        when(googleAuthenticator.isEnabled()).thenReturn(true);
        when(googleAuthenticator.isAuthorized("id-token")).thenReturn(true);
        WriteAuthenticationFilter filter = new WriteAuthenticationFilter("", false, googleAuthenticator);
        AtomicBoolean continued = new AtomicBoolean();

        filter.doFilterInternal(request("POST", "/api/observer/geo", "Bearer id-token", null),
            new MockHttpServletResponse(), (request, response) -> continued.set(true));

        assertTrue(continued.get());
    }

    @Test
    void invalidGoogleTokenIsDenied() throws Exception {
        GoogleIdTokenAuthenticator googleAuthenticator = mock(GoogleIdTokenAuthenticator.class);
        when(googleAuthenticator.isEnabled()).thenReturn(true);
        when(googleAuthenticator.isAuthorized("bad-token")).thenThrow(new JwtException("invalid token"));
        WriteAuthenticationFilter filter = new WriteAuthenticationFilter("", false, googleAuthenticator);

        MockHttpServletResponse response = invoke(filter, "POST", "/api/observer/geo",
            "Bearer bad-token", null);

        assertEquals(401, response.getStatus());
    }

    private static MockHttpServletResponse invoke(WriteAuthenticationFilter filter, String method, String path,
                                                   String authorization, String apiKey)
        throws ServletException, IOException {
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean continued = new AtomicBoolean();
        filter.doFilterInternal(request(method, path, authorization, apiKey), response,
            (request, servletResponse) -> continued.set(true));
        assertFalse(continued.get());
        return response;
    }

    private static MockHttpServletRequest request(String method, String path, String authorization, String apiKey) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        if (authorization != null) request.addHeader("Authorization", authorization);
        if (apiKey != null) request.addHeader("X-API-Key", apiKey);
        return request;
    }
}
