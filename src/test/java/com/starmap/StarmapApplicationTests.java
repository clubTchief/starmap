package com.starmap;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

/**
 * Deliberately minimal: this is a context-load smoke test, not full unit
 * coverage. Its job is narrow but important — fail the build if the Spring
 * context can't start at all, which is exactly the class of bug this
 * project spent a long debugging session on (the OrekitConfig bean-ordering
 * issue would have failed this test immediately, long before reaching
 * production).
 *
 * gps.simulate is forced true here so the test never tries to open a real
 * serial port in CI.
 */
@SpringBootTest
@TestPropertySource(properties = {
    "gps.simulate=true",
    "orekit.data.path=orekit-data"
})
class StarmapApplicationTests {

    @Test
    void contextLoads() {
        // If the application context fails to start — including any
        // @DependsOn ordering problem, missing Orekit data, or a broken
        // bean wiring — this test fails and the build stops here, before
        // a broken image ever reaches GHCR or Railway.
    }
}
