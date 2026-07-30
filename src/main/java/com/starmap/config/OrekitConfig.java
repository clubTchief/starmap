package com.starmap.config;

import jakarta.annotation.PostConstruct;
import org.orekit.data.DataContext;
import org.orekit.data.DataProvidersManager;
import org.orekit.data.DirectoryCrawler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

import java.io.File;

/**
 * Initialises the Orekit data context on startup.
 *
 * Orekit needs external data files for:
 *   • UTC-TAI leap second history  (UTC-TAI.history)
 *   • Earth Orientation Parameters (finals2000A.*.csv)
 *   • JPL ephemeris                (Lnnnnn.405 / DE405 series)
 *   • Gravity field coefficients   (EGM96/EIGEN)
 *
 * Download orekit-data-master.zip from:
 *   https://gitlab.orekit.org/orekit/orekit-data/-/archive/master/orekit-data-master.zip
 *
 * Extract it and set orekit.data.path in application.properties to the
 * directory that directly contains UTC-TAI.history.
 * Example: orekit.data.path=C:/orekit-data
 */
@Configuration
public class OrekitConfig {

    private static final Logger log = LoggerFactory.getLogger(OrekitConfig.class);

    @Value("${orekit.data.path:./orekit-data}")
    private String orekitDataPath;

    @PostConstruct
    public void init() {
        File dataDir = new File(orekitDataPath);
        if (!dataDir.exists() || !dataDir.isDirectory()) {
            log.error("Orekit data directory not found: {}. " +
                      "Download orekit-data-master.zip from " +
                      "https://gitlab.orekit.org/orekit/orekit-data/-/archive/master/orekit-data-master.zip " +
                      "and set orekit.data.path in application.properties", dataDir.getAbsolutePath());
            return;
        }

        DataProvidersManager manager = DataContext.getDefault().getDataProvidersManager();
        manager.addProvider(new DirectoryCrawler(dataDir));
        log.info("Orekit data loaded from: {}", dataDir.getAbsolutePath());
    }
}
