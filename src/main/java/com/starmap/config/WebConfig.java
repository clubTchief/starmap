package com.starmap.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.*;

/**
 * Routes the root URL "/" to index.html (served from src/main/resources/static/).
 * Also sets the async request timeout to 0 (unlimited) for SSE connections.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

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
        // Allow local dev tools (e.g. browser direct-open) to hit the API
        registry.addMapping("/api/**")
                .allowedOriginPatterns("*")
                .allowedMethods("GET", "POST", "OPTIONS");
    }
}
