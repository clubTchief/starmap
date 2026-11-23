package com.starmap.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthConfigController {

    private final String googleClientId;

    public AuthConfigController(@Value("${starmap.auth.google.client-id:}") String googleClientId) {
        this.googleClientId = googleClientId.trim();
    }

    @GetMapping("/config")
    public Map<String, String> getAuthConfig() {
        return Map.of("googleClientId", googleClientId);
    }
}
