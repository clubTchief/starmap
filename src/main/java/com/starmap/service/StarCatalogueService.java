package com.starmap.service;

import com.opencsv.CSVReader;
import com.starmap.model.StarData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Loads the (pre-filtered, mag <= 6.5) HYG star catalogue once at startup
 * from a bundled classpath resource — same pattern as JPL DE440 ephemeris
 * data (OrekitConfig), which is baked into the image rather than fetched
 * at runtime. This was originally a live GitHub fetch, but that has two
 * real problems bundling avoids: the exact file this depends on has
 * already moved once (hyg/v3/hyg.csv -> hyg/CURRENT/hygdata_v41.csv, a
 * real 404 hit in production), and a live fetch adds a startup dependency
 * on GitHub's raw-content endpoint being reachable at that exact moment,
 * for data that only changes about once a year.
 *
 * Az/El are NOT computed here — see StarData's javadoc for why (cost).
 * This service only loads and serves the static catalogue; the frontend
 * computes each star's sky position itself, per tick, from frameContext.
 *
 * Star data: HYG Database (currently v4.1), astronexus, CC BY-SA 4.0
 * (https://github.com/astronexus/HYG-Database). The ShareAlike term means
 * attribution belongs in the UI, not just here — see the credit line in
 * the DISPLAY panel's star toggle tooltip.
 */
@Service
public class StarCatalogueService {

    private static final Logger log = LoggerFactory.getLogger(StarCatalogueService.class);
    private static final String RESOURCE_PATH = "stardata/stars.csv";

    private volatile List<StarData> catalogue = List.of();

    @PostConstruct
    public void init() {
        try {
            loadCatalogue();
        } catch (Exception e) {
            // Deliberately non-fatal: Sky View should still work (just with
            // no stars) rather than taking down the whole app over what is,
            // relative to GNSS/ephemeris data, a purely decorative feature.
            log.error("Failed to load bundled star catalogue — Sky View will show no stars", e);
        }
    }

    private void loadCatalogue() throws Exception {
        var resource = new ClassPathResource(RESOURCE_PATH);
        List<StarData> loaded = new ArrayList<>(9_000);
        int skipped = 0;

        try (CSVReader reader = new CSVReader(
                new InputStreamReader(resource.getInputStream(), StandardCharsets.UTF_8))) {

            String[] header = reader.readNext();
            if (header == null) {
                log.error("StarCatalogueService: bundled {} is empty", RESOURCE_PATH);
                return;
            }

            Map<String, Integer> col = new HashMap<>();
            for (int i = 0; i < header.length; i++) col.put(header[i], i);

            Integer idxHip    = col.get("hip");
            Integer idxProper = col.get("proper");
            Integer idxRaRad  = col.get("rarad");
            Integer idxDecRad = col.get("decrad");
            Integer idxMag    = col.get("mag");
            Integer idxCi     = col.get("ci");

            if (idxRaRad == null || idxDecRad == null || idxMag == null) {
                log.error("StarCatalogueService: bundled {} is missing expected columns " +
                          "(rarad/decrad/mag)", RESOURCE_PATH);
                return;
            }

            String[] row;
            while ((row = reader.readNext()) != null) {
                try {
                    double raRad  = Double.parseDouble(row[idxRaRad]);
                    double decRad = Double.parseDouble(row[idxDecRad]);
                    float  mag    = Float.parseFloat(row[idxMag]);

                    int hip = (idxHip != null && idxHip < row.length && !row[idxHip].isBlank())
                              ? Integer.parseInt(row[idxHip]) : 0;
                    String proper = (idxProper != null && idxProper < row.length)
                                    ? row[idxProper] : "";
                    float ci = (idxCi != null && idxCi < row.length && !row[idxCi].isBlank())
                               ? Float.parseFloat(row[idxCi]) : Float.NaN;

                    loaded.add(new StarData(hip, proper, raRad, decRad, mag, ci));
                } catch (NumberFormatException nfe) {
                    // Skip the one bad row rather than aborting the whole
                    // catalogue over it — the failure mode that bit
                    // ConstellationService before (one bad field killing
                    // every record), deliberately not repeated here.
                    skipped++;
                }
            }
        }

        catalogue = List.copyOf(loaded);
        log.info("StarCatalogueService: loaded {} stars from bundled catalogue " +
                  "[{} rows skipped] — HYG v4.1, CC BY-SA 4.0, astronexus/HYG-Database",
                  catalogue.size(), skipped);
    }

    /** The full static catalogue, served as-is by GET /api/stars. */
    public List<StarData> getCatalogue() {
        return catalogue;
    }

    public int catalogueSize() {
        return catalogue.size();
    }
}
