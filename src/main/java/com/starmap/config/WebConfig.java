package com.starmap.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.*;

/**
 * Routes the root URL "/" to index.html (served from src/main/resources/static/).
 * Also sets the async request timeout to 0 (unlimited) for SSE connections.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    // Was allowedOriginPatterns("*") — fine for local dev, unnecessarily
    // open on a public deployment. Defaults to the app's own Railway URL
    // plus localhost for local development; override via
    // starmap.cors.allowed-origins for any other frontend that needs access.
    @Value("${starmap.cors.allowed-origins:https://starmap-production-fbf2.up.railway.app,http://localhost:8080,http://localhost:3000}")
    private String allowedOrigins;

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addViewController("/").setViewName("forward:/index.html");
    }

    @Override
    public void configureAsyncSupport(AsyncSupportConfigurer configurer) {
        // 0 = no server-side timeout on SSE streams
        configurer.setDefaultTimeout(0);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins.split(","))
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS");
    }
}
