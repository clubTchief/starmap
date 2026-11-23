# ── Stage 1: Orekit data prep ────────────────────────────────────────────────
# Isolated into its own stage so BOTH the Maven build (which now runs the
# StarmapApplicationTests context-load smoke test) and the final runtime
# image can use the exact same, verified-correct orekit-data — without
# needing a full JDK/Maven toolchain just to assemble a data directory.
FROM alpine:3.19 AS orekit-prep

WORKDIR /prep
RUN apk add --no-cache wget

# The vendored orekit-data/ folder contains the DE440 ephemeris, EOP,
# gravity field, space weather, and MSAFE. Some of its Git-LFS-tracked files
# can be checked out as pointer stubs when LFS objects are unavailable.
#
# de421.bsp / de440.bsp / fes2004_Cnm-Snm.dat aren't needed: planetary
# positions come from the already-real DE-440-ephemerides/*.440 file, and
# this app never loads an ocean tide model. tai-utc.dat (leap seconds) IS
# needed, so we drop the broken stub and fetch Orekit's other supported
# leap-second format straight from its IERS source of truth instead.
COPY orekit-data ./orekit-data-raw

# We tried deleting the four Git-LFS-broken stub files (tai-utc.dat,
# de421.bsp, de440.bsp, fes2004_Cnm-Snm.dat) out of the copied tree with
# `rm -f`, and verified in cached and uncached container builds that the
# deletion did not reliably remove the files from the final image.
# Rather than rely on deleting them, build a brand new
# orekit-data directory containing ONLY the pieces we've confirmed are
# real and needed, so the broken files are simply never copied into it
# in the first place.
RUN mkdir -p ./orekit-data \
    && cp -r ./orekit-data-raw/DE-440-ephemerides         ./orekit-data/ \
    && cp -r ./orekit-data-raw/Earth-Orientation-Parameters ./orekit-data/ \
    && cp -r ./orekit-data-raw/CSSI-Space-Weather-Data     ./orekit-data/ \
    && cp -r ./orekit-data-raw/MSAFE                      ./orekit-data/ \
    && cp -r ./orekit-data-raw/Potential                  ./orekit-data/ \
    && cp ./orekit-data-raw/itrf-versions.conf             ./orekit-data/ \
    && rm -rf ./orekit-data-raw \
    && wget -q "https://hpiers.obspm.fr/eoppc/bul/bulc/UTC-TAI.history" \
            -O ./orekit-data/UTC-TAI.history

# Fail the build loudly instead of failing silently at Orekit startup:
#  - leap seconds: UTC-TAI.history must exist and be a real size
#  - planetary ephemeris: JPLEphemeridesLoader recognizes [lu]nx[mp]####.ddd
#    (e.g. lnxp1990.440) — confirm one is actually present, recursively,
#    since it lives in a subdirectory (DE-440-ephemerides/) and a broken
#    checkout/copy step wouldn't otherwise be caught until EphemerisService
#    fails at runtime.
RUN echo "── orekit-data contents ──" \
    && find ./orekit-data -type f -exec ls -la {} \; \
    && for bad in tai-utc.dat de421.bsp de440.bsp fes2004_Cnm-Snm.dat; do \
         if [ -e "./orekit-data/$bad" ]; then \
           echo "STILL PRESENT (should have been excluded): $bad" && exit 1; \
         fi; \
       done \
    && echo "confirmed: no broken LFS-stub files in the image" \
    && find ./orekit-data -maxdepth 1 -name "UTC-TAI.history" -size +1k -print -quit \
        | grep -q . \
    && echo "orekit-data leap-second file looks good" \
    || (echo "UTC-TAI.history fetch produced an undersized file" && exit 1)

RUN test -f ./orekit-data/DE-440-ephemerides/lnxp1990.440 \
    && [ "$(wc -c < ./orekit-data/DE-440-ephemerides/lnxp1990.440)" -gt 1000000 ] \
    && echo "orekit-data JPL ephemeris file looks good" \
    || (echo "DE-440-ephemerides/lnxp1990.440 is missing or undersized" && exit 1)

# ── Stage 2: Build + test ────────────────────────────────────────────────────
FROM maven:3.9-eclipse-temurin-25-alpine AS builder

WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline -q
COPY src ./src

# orekit-data is needed here now too: StarmapApplicationTests boots the full
# Spring context (including OrekitConfig and every @DependsOn-ordered
# service), so a missing/broken orekit-data would fail the test — which is
# exactly the point. Tests are no longer skipped: this is the build's one
# real check that the app can actually start before an image ships.
COPY --from=orekit-prep /prep/orekit-data ./orekit-data
RUN mvn package -q

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM eclipse-temurin:25-jre-alpine

WORKDIR /app
RUN apk add --no-cache wget

RUN addgroup -S starmap && adduser -S starmap -G starmap
RUN chown starmap:starmap /app

COPY --from=builder --chown=starmap:starmap \
     /build/target/starmap-1.0.0.jar app.jar

COPY --from=orekit-prep --chown=starmap:starmap /prep/orekit-data ./orekit-data

USER starmap

ENV SERVER_PORT=8080 \
    GPS_SIMULATE=true \
    OREKIT_DATA_PATH=/app/orekit-data \
    OBSERVER_DEFAULT_LAT=19.1334 \
    OBSERVER_DEFAULT_LON=72.9133 \
    OBSERVER_DEFAULT_ALT=14.0 \
    SAT_TRACK_NORAD_IDS=25544 \
    JAVA_OPTS="-Xms512m -Xmx1024m -Djava.net.preferIPv4Stack=true --enable-native-access=ALL-UNNAMED"

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD wget -qO- http://localhost:8080/api/status || exit 1

ENTRYPOINT ["sh", "-c", \
    "java $JAVA_OPTS \
     -jar app.jar \
     --server.port=${SERVER_PORT} \
     --gps.simulate=${GPS_SIMULATE} \
     --orekit.data.path=${OREKIT_DATA_PATH} \
     --observer.default.lat=${OBSERVER_DEFAULT_LAT} \
     --observer.default.lon=${OBSERVER_DEFAULT_LON} \
     --observer.default.alt=${OBSERVER_DEFAULT_ALT} \
     --sat.track.norad-ids=${SAT_TRACK_NORAD_IDS}"]
