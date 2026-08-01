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
RUN apk add --no-cache wget

RUN addgroup -S starmap && adduser -S starmap -G starmap

COPY --from=builder --chown=starmap:starmap \
     /build/target/starmap-1.0.0.jar app.jar

# ── Orekit reference data ───────────────────────────────────────────────────
# The vendored orekit-data/ folder is real and correct for almost everything
# (DE440 ephemeris, EOP, gravity field, space weather, MSAFE) — those are
# plain git blobs. But four files are Git-LFS-tracked (see .gitattributes:
# *.bsp, *.dat, *.tab, *.ecsv) and Railway's build clone does not resolve
# LFS pointers, so tai-utc.dat / de421.bsp / de440.bsp /
# fes2004_Cnm-Snm.dat land in the image as ~130-byte pointer stubs, not
# real data. (A GitLab archive re-download hits the exact same problem —
# GitLab doesn't include LFS objects in generated archives either.)
#
# de421.bsp / de440.bsp / fes2004_Cnm-Snm.dat aren't needed: planetary
# positions come from the already-real DE-440-ephemerides/*.440 file, and
# this app never loads an ocean tide model. tai-utc.dat (leap seconds) IS
# needed, so we drop the broken stub and fetch Orekit's other supported
# leap-second format straight from its IERS source of truth instead.
# Cache-buster: Railway injects the current commit SHA as this build arg
# when it's declared. Referencing it below means every commit produces a
# genuinely new layer here, so a stale/corrupted cache entry can never be
# silently reused for this step or anything after it (this is what bit us
# last deploy — the rm+wget layer got served from an old cached build).
ARG RAILWAY_GIT_COMMIT_SHA=local
RUN echo "Building orekit-data for commit ${RAILWAY_GIT_COMMIT_SHA}"

COPY --chown=starmap:starmap orekit-data ./orekit-data

RUN rm -f /app/orekit-data/tai-utc.dat \
          /app/orekit-data/de421.bsp \
          /app/orekit-data/de440.bsp \
          /app/orekit-data/fes2004_Cnm-Snm.dat \
    && wget -q "https://hpiers.obspm.fr/eoppc/bul/bulc/UTC-TAI.history" \
            -O /app/orekit-data/UTC-TAI.history \
    && chown starmap:starmap /app/orekit-data/UTC-TAI.history

# Fail the build loudly if the leap-second file ever comes back undersized
# instead of failing silently at Orekit startup like before.
RUN find /app/orekit-data -maxdepth 1 -name "UTC-TAI.history" -size +1k -print -quit \
        | grep -q . \
    && echo "orekit-data leap-second file looks good" \
    || (echo "UTC-TAI.history fetch produced an undersized file" && exit 1)

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
