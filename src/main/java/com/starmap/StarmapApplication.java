package com.starmap;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class StarmapApplication {
    public static void main(String[] args) {
        SpringApplication.run(StarmapApplication.class, args);
    }
}
