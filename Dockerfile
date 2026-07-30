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
RUN apk add --no-cache wget curl unzip

RUN addgroup -S starmap && adduser -S starmap -G starmap

COPY --from=builder --chown=starmap:starmap \
     /build/target/starmap-1.0.0.jar app.jar

# Download orekit-data from the Orekit GitLab archive
# This is the canonical source with correct folder structure
RUN mkdir -p /app/orekit-data && \
    wget --timeout=180 -q \
      "https://gitlab.orekit.org/orekit/orekit-data/-/archive/master/orekit-data-master.zip" \
      -O /tmp/od.zip || \
    wget --timeout=180 -q \
      "https://github.com/CS-SI/Orekit/releases/download/12.1/orekit-data.zip" \
      -O /tmp/od.zip && \
    unzip -q /tmp/od.zip -d /tmp/oe && \
    SUBDIR=$(ls /tmp/oe/) && \
    echo "Found subdir: $SUBDIR" && \
    cp -r /tmp/oe/$SUBDIR/. /app/orekit-data/ && \
    rm -rf /tmp/od.zip /tmp/oe && \
    find /app/orekit-data -name "tai-utc.dat" && \
    echo "Orekit base: $(du -sh /app/orekit-data)"

# Download DE440 from NASA JPL
RUN wget --timeout=600 -q \
    "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440.bsp" \
    -O /app/orekit-data/de440.bsp && \
    echo "DE440: $(du -sh /app/orekit-data/de440.bsp)"

RUN chown -R starmap:starmap /app/orekit-data
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
