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
RUN apk add --no-cache wget curl

RUN addgroup -S starmap && adduser -S starmap -G starmap

COPY --from=builder --chown=starmap:starmap \
     /build/target/starmap-1.0.0.jar app.jar

# Copy the orekit-data folder from the repo
# (must contain tai-utc.dat and other IERS files)
COPY --chown=starmap:starmap orekit-data ./orekit-data

# Download only the ephemeris binary — DE421 is 17MB vs DE440's 115MB
# Same visual accuracy for a visualisation app
RUN wget --timeout=300 \
    "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de421.bsp" \
    -O /app/orekit-data/de421.bsp && \
    chown starmap:starmap /app/orekit-data/de421.bsp && \
    echo "DE421: $(du -sh /app/orekit-data/de421.bsp)"

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
