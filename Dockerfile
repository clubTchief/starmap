# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM maven:3.9-eclipse-temurin-17-alpine AS builder

WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline -q
COPY src ./src
RUN mvn package -DskipTests -q

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app
RUN apk add --no-cache wget unzip

RUN addgroup -S starmap && adduser -S starmap -G starmap

COPY --from=builder --chown=starmap:starmap \
     /build/target/starmap-1.0.0.jar app.jar

# ── Orekit reference data ───────────────────────────────────────────────────
# NOTE: We do NOT copy orekit-data/ from the repo. The vendored copy in git
# relies on Git LFS for tai-utc.dat, de421.bsp, de440.bsp, and
# fes2004_Cnm-Snm.dat (see .gitattributes), and Railway's build clone does
# not resolve LFS pointers — it was silently checking out ~130-byte LFS
# pointer stubs in place of the real files, which broke leap-second loading
# at startup (tai-utc.dat).
#
# Instead we fetch the current official convenience archive fresh, every
# build, straight from the Orekit project. This also means the data stays
# current without us having to manually update the vendored copy.
RUN wget -q "https://gitlab.orekit.org/orekit/orekit-data/-/archive/main/orekit-data-main.zip" \
        -O /tmp/orekit-data.zip \
    && unzip -q /tmp/orekit-data.zip -d /app \
    && mv /app/orekit-data-main /app/orekit-data \
    && rm /tmp/orekit-data.zip

# Fail the build loudly (not silently at runtime) if the fetch ever regresses
# back to stub-sized files.
RUN ls -lh /app/orekit-data/ && \
    find /app/orekit-data -name "tai-utc.dat"  -size +1k -print -quit | grep -q . && \
    find /app/orekit-data -name "de440.bsp"     -size +1M -print -quit | grep -q . && \
    echo "orekit-data looks good" \
    || (echo "orekit-data fetch produced undersized files" && exit 1)

RUN chown -R starmap:starmap /app/orekit-data

USER starmap

ENV SERVER_PORT=8080 \
    GPS_SIMULATE=true \
    OREKIT_DATA_PATH=/app/orekit-data \
    OBSERVER_DEFAULT_LAT=19.1334 \
    OBSERVER_DEFAULT_LON=72.9133 \
    OBSERVER_DEFAULT_ALT=14.0 \
    SAT_TRACK_NORAD_IDS=25544 \
    JAVA_OPTS="-Xms512m -Xmx1024m"

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
