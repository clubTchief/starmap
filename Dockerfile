# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM maven:3.9-eclipse-temurin-17-alpine AS builder

WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline -q
COPY src ./src
RUN mvn package -DskipTests -q

# ── Stage 2: Orekit data fetcher ──────────────────────────────────────────────
# Download orekit-data + DE440 in a separate stage so the layer is cached
FROM alpine:3.19 AS data-fetcher

RUN apk add --no-cache wget unzip

WORKDIR /orekit-data

# 1. Download the standard orekit-data package (IERS, UTC-TAI, EOP, gravity)
RUN wget -q "https://gitlab.orekit.org/orekit/orekit-data/-/archive/master/orekit-data-master.zip" \
    -O orekit-data.zip && \
    unzip -q orekit-data.zip && \
    cp -r orekit-data-master/. . && \
    rm -rf orekit-data-master orekit-data.zip

# 2. Download DE440 ephemeris binary from NASA JPL
#    de440.bsp covers 1849–2150, ~114MB — Orekit 12.x uses this by default
RUN wget -q "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440.bsp" \
    -O de440.bsp && \
    echo "DE440 downloaded: $(du -sh de440.bsp)"

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app
RUN apk add --no-cache wget

RUN addgroup -S starmap && adduser -S starmap -G starmap

# Copy the fat JAR from build stage
COPY --from=builder --chown=starmap:starmap \
     /build/target/starmap-1.0.0.jar app.jar

# Copy complete orekit-data (including DE440) from data-fetcher stage
COPY --from=data-fetcher --chown=starmap:starmap \
     /orekit-data ./orekit-data

USER starmap

ENV SERVER_PORT=8080 \
    GPS_SIMULATE=true \
    OREKIT_DATA_PATH=/app/orekit-data \
    OBSERVER_DEFAULT_LAT=19.1334 \
    OBSERVER_DEFAULT_LON=72.9133 \
    OBSERVER_DEFAULT_ALT=14.0 \
    SAT_TRACK_NORAD_IDS=25544 \
    JAVA_OPTS="-Xms512m -Xmx1536m"

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
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
