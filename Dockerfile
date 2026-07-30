# ── Stage 1: Build ───────────────────────────────────────────────────────────
# Maven + JDK to compile and package the Spring Boot fat JAR
FROM maven:3.9-eclipse-temurin-17-alpine AS builder

WORKDIR /build

# Copy pom first — Docker caches this layer so dependency
# downloads only repeat when pom.xml changes
COPY pom.xml .

# Download dependencies (cached layer)
RUN mvn dependency:go-offline -q

# Copy source and build
COPY src ./src
RUN mvn package -DskipTests -q

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Slim JRE only — no Maven, no JDK tools in the final image
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

# Non-root user for security
RUN addgroup -S starmap && adduser -S starmap -G starmap
USER starmap

# Copy the fat JAR from the build stage
COPY --from=builder --chown=starmap:starmap \
     /build/target/starmap-1.0.0.jar app.jar

# Copy the Orekit data directory (includes DE430 ephemeris — required)
# This must exist in your project root before building:
#   Place your orekit-data/ folder next to the Dockerfile
COPY --chown=starmap:starmap orekit-data ./orekit-data

# ── Environment defaults ───────────────────────────────────────────────────────
# All can be overridden at runtime: docker run -e GPS_SIMULATE=true ...
ENV SERVER_PORT=8080 \
    GPS_SIMULATE=true \
    OREKIT_DATA_PATH=/app/orekit-data \
    OBSERVER_DEFAULT_LAT=19.1334 \
    OBSERVER_DEFAULT_LON=72.9133 \
    OBSERVER_DEFAULT_ALT=14.0 \
    SAT_TRACK_NORAD_IDS=25544 \
    JAVA_OPTS="-Xms256m -Xmx512m"

EXPOSE 8080

# Health check — Spring Boot's /api/status endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
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
