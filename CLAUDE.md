# STARMAP — Developer/Agent Context

This file previously held a Remotion video-production brief (scene
descriptions, frame timings, a `.mp4` output target). That content is still
useful if a promotional video is revisited, but it's a different purpose
from this file's — it now lives in `VIDEO_BRIEF.md`. This file is the real
architectural reference: what to read before extending STARMAP, so new work
reuses what exists instead of duplicating it.

## What this app is

STARMAP is a unified real-time geospatial and astrodynamics visualisation
platform. It merges live GNSS tracking (GPS from a Hiwonder USB module, or
a simulator) with a solar-system/celestial visualiser (JPL ephemeris,
real star field) into one Spring Boot app.

**Six modes**, not five — Sky View is a full mode, not a footnote:
- **GNSS** — live GPS position, 5-constellation satellite sky plot, ISS/arbitrary-satellite tracking
- **GEO·EQ** — Geocentric Equatorial (ECI/EME2000), RA/Dec celestial grid
- **GEO·ECL** — Geocentric Ecliptic, obliquity arc, ecliptic plane
- **HELIO·EQ** — Heliocentric Equatorial, solar system top-down orrery
- **HELIO·ECL** — Heliocentric Ecliptic, ecliptic reference prominent
- **Sky View** — first-person AzEl horizon from the observer's real position, with a real HYG star field, Sun/Moon/planets at true (scaled) 3D position

A scale slider at the bottom transitions from 10,000 km (GNSS) to 400
billion km (outer solar system) continuously.

## Stack & versions (verified against pom.xml, not copied from memory)

- Spring Boot **4.1.0**, Java **21**
- Orekit **13.1.7**, Hipparchus **4.0.3**
- Jackson **3** (`tools.jackson.databind.json.JsonMapper`) — **not** Jackson 2
  (`com.fasterxml`). Jackson 3's numeric coercion is strict where Jackson 2
  was lenient; see "Known gotchas" below.
- CesiumJS **1.142**, loaded from Cesium's own CDN in `index.html`
- `opencsv` 5.9 — only consumer is `StarCatalogueService`
- Deployed via Docker → GHCR → Railway, custom domain via Squarespace DNS
- `spring.task.scheduling.pool.size=4` — scheduled tasks run on a small
  pool, not Spring's single-threaded default (see "Concurrency" below)

## Backend architecture

**Services** (`src/main/java/com/starmap/service/`):

| Service | Responsibility |
|---|---|
| `SatelliteTrackingService` | The satellite registry. `Map<Integer, TrackedSat> satellites`, keyed by NORAD ID. `addSatellite(noradId)` / `removeSatellite(noradId)` / `buildAllStates()` → `List<SatelliteState>`. Fetches OMM JSON from CelesTrak per satellite, builds an Orekit `TLE` + `TLEPropagator`. Any new feature that needs "a satellite's current state" should call into this, not build a second propagation path. |
| `ConstellationService` | The 5 GNSS constellations (GPS/GLONASS/Galileo/BeiDou/SBAS) — bulk CelesTrak group fetches, not individually tracked like `SatelliteTrackingService`. Parallelized fetch via virtual threads (`Callable<Result>` + `invokeAll()`). |
| `EphemerisService` | Sun/Moon/planets/major moons via Orekit's JPL ephemeris, in all 4 frame-context modes. `computeAll(epoch)` → `List<CosmicBody>`, `computeFrameContext(epoch, obs)` → `FrameContext` (GMST/LST/obliquity/season/etc., whatever the active mode's HUD needs). |
| `StarCatalogueService` | Static HYG star catalogue, loaded once from a **bundled classpath resource** (`src/main/resources/stardata/stars.csv`), not fetched at runtime. Serves `GET /api/stars` once per client — Az/El are computed **client-side**, not server-side (see "Known gotchas" — cost). |
| `ObserverService` | Current observer lat/lon/alt/city, from GPS, manual entry, or IP geolocation. |
| `GpsService` / `GpsSimulator` / `NmeaParser` | Real serial-port GPS (Hiwonder module) or a simulated track when `gps.simulate=true`. |
| `CoordService` | Coordinate-frame transform helpers shared across services. |
| `StarmapSseService` | The 1Hz broadcast loop. `@Scheduled(fixedRateString = "...1000")`, builds one `StarmapSnapshot` per tick, serializes with Jackson 3, pushes to every registered `SseEmitter`. Per-IP (5) and global (200) connection caps. |

**Config** (`src/main/java/com/starmap/config/`): `OrekitConfig` (loads
bundled ephemeris/leap-second data — same "bundle it, don't fetch it"
pattern as `StarCatalogueService`), `ApiKeyFilter`, `RateLimitFilter`,
`WebConfig` (CORS).

**Model** (`src/main/java/com/starmap/model/`): `StarmapSnapshot` (the
per-tick SSE payload — `bodies`, `frameContext`, satellite lists, GPS
position), `SatelliteState`, `ObserverState`, `FrameContext`, `CosmicBody`,
`StarData`, `Satellite`, `FrameInspector`.

### REST API surface (`StarmapController`)

```
GET    /api/stream           -> SSE "starmap" events, 1 Hz
GET    /api/status           -> app health/readiness
GET    /api/stars            -> static star catalogue, ONCE (not SSE -- see cost note)
GET    /api/observer         -> current observer position
POST   /api/observer/geo     -> set observer by geolocation
POST   /api/sat/add          -> start tracking a NORAD ID
DELETE /api/sat/remove       -> stop tracking a NORAD ID
POST   /api/sat/refresh      -> force an immediate OMM refresh
```

**Pattern to follow for new static/semi-static data**: serve it once via
plain REST, not through the SSE snapshot. `StarCatalogueService`/`/api/stars`
is the precedent — adding ~9,000 stars to the 1Hz SSE payload was costed at
roughly $80/month in Railway egress per continuously-connected client
before being moved to a one-time fetch. Anything that doesn't need to
change every second doesn't belong in `StarmapSnapshot`.

## Frontend architecture (`src/main/resources/static/js/starmap.js`, ~4,300 lines)

One large script, no framework (deliberately -- see repo conventions below).

- **`satRegistry`** (`const satRegistry = {}`) -- the frontend satellite
  registry, `noradId -> { entity, trackEntities, footEntity, footOutline }`.
  Mirrors the backend's `TrackedSat` map. A satellite only gets one Cesium
  entity; anything that needs "the satellite for NORAD id X" should look it
  up here, not create a new entity.
- **`satFlyWith(noradId)`** / **`exitIssChase()`** -- the chase-camera
  function (named for ISS historically, already generalized to any NORAD
  ID). Sets `viewer.trackedEntity`, offsets the camera, remembers the
  pre-chase camera state to restore on exit. Reuse this directly rather
  than writing a new fly-to for mission spacecraft.
- **`handleStarmapSnapshot(snap)`** -- the per-tick SSE handler, called once
  per incoming snapshot. This is where per-tick rendering updates hook in
  (e.g. `renderStarField(snap)`).
- **Cesium clock**: currently `viewer.clock.clockStep = SYSTEM_CLOCK` --
  the clock free-runs on the browser's own wall-clock time, not
  continuously driven by server epoch data (one exception: GPS mode syncs
  `viewer.clock.currentTime` from `snap.gpsUtc` once). A mission-replay /
  variable-speed timeline would need `clockStep` switched to
  `TICK_DEPENDENT` with `shouldAnimate`/`multiplier` under explicit
  control -- the current `SYSTEM_CLOCK` setup doesn't support that as-is.
- **Sky View decorations** (`buildSkyViewGrid`, the star field) place
  points on a fixed-radius dome around the observer via
  `skyDomeElAzToCart(latDeg, lonDeg, elevDeg, azimDeg, distM)`. Sun/Moon/
  planets in Sky View do **not** use this -- they're placed at their real,
  much more distant, scaled 3D position (`bodyToCart`), with the camera
  repositioned to the observer. Mixing the two without
  `disableDepthTestDistance` causes wrong depth-occlusion (dome objects
  rendering in front of farther-but-dome-radius-closer real objects).
- **Entity rebuild cost varies by structure**: `buildGrid()`/
  `buildSkyViewGrid()` use heavy Cesium `Entity`/polyline objects and are
  deliberately rebuilt only on discrete events (mode transitions, Sky View
  entry) -- not per-tick, because recreating ~360+ entities every second
  would be expensive. `PointPrimitiveCollection` (used for the star field)
  is cheap to reposition every tick -- different structure, different
  update cadence is correct, not inconsistent.

CSS: `src/main/resources/static/css/starmap.css`. HTML:
`src/main/resources/static/index.html` -- left panel tabs (VIEW / DISPLAY /
TRACK / FRAME), right panel (FIX / STATUS / VIEWPT / UTC CLK / SIGNALS).

## Concurrency

`spring.task.scheduling.pool.size=4` -- scheduled tasks (1Hz broadcast,
2-hour satellite refresh, 10-min retry checks) run independently rather
than sharing Spring's single-threaded default. `SatelliteTrackingService`
and `ConstellationService` both parallelize their per-item network fetches
with Java 21 virtual threads (`Executors.newVirtualThreadPerTaskExecutor()`).
`TrackedSat`'s mutable fields are `volatile` -- this only matters once the
scheduler has more than one thread; it was silently safe before by
accident (single-threaded scheduler meant writer and reader never actually
overlapped).

## Known gotchas / history worth not repeating

- **DE430 vs DE440 naming**: `EphemerisService`'s own comments/log
  messages say "DE430" throughout, but the actual bundled ephemeris file
  is `lnxp1990.440` (the `.440` extension is JPL's own series-identifying
  convention) -- it's really DE440. Functionally harmless (Orekit loads
  whatever file is there), but the documentation has been wrong about
  which ephemeris it's using. Worth fixing the comments/log text at some
  point; not urgent.
- **Jackson 2->3 coercion**: `JsonNode.asDouble()`/`.asInt()` was lenient
  under Jackson 2 (invalid input silently returned 0) and is strict under
  Jackson 3 (throws `JsonNodeException`). A long-dormant dead line in
  `ConstellationService` (`n.path("EPOCH").asDouble()` -- trying to parse
  an ISO date string as a double) was harmless under Jackson 2 and broke
  every single satellite parse under Jackson 3 until removed. Audit any
  `JsonNode` numeric accessor against the field's real type before
  trusting it works just because it compiles.
- **Don't let same-named functions collide.** `starmap.js` once had two
  separate `skyElAzToCart` functions in the same scope -- a sky-dome
  placement version and a real orbital-shell version -- with the dome
  version silently winning everywhere via JS hoisting, including in code
  that needed the orbital one. Fixed by renaming the dome version to
  `skyDomeElAzToCart`. Check for this pattern before adding a new
  same-named helper.
- **Static/bulk data belongs in REST, not SSE.** See the `/api/stars`
  cost note above -- this is the single most expensive mistake to repeat
  given Railway's $0.05/GB egress billing.

## Deployment / infra

Docker -> GHCR (`ghcr.io/clubTchief/starmap`) -> Railway, auto-deploy on
merge to `main` (not on push to a feature branch -- GitHub Actions'
`docker-publish.yml` triggers on `push: [main]`). Custom domain
`tiara.club` via a Squarespace `ALIAS` record (apex domains can't use
`CNAME`). Orekit data (leap seconds, JPL ephemeris) is bundled into the
image rather than fetched at runtime -- same pattern `StarCatalogueService`
follows for star data. Rollback procedure: see `ROLLBACK.md`. Dependabot
PRs currently get no CI signal before merge (the workflow doesn't trigger
on `pull_request`) -- a known, not-yet-closed gap.

## Testing

`src/test/java/com/starmap/` -- `StarmapApplicationTests` (context-load
smoke test; this is what catches a broken bean wiring or a missing
starter), `SatelliteTrackingServiceTest`, `ConstellationServiceTest`,
`StarmapSseServiceTest` (connection-cap behaviour; constructor deps passed
as `null` since this test doesn't need a full Spring context).

## Repo conventions

- No frontend framework (React/Vue/Angular) -- one large `starmap.js`,
  deliberately. Don't introduce one for a new feature; extend the existing
  file following its patterns.
- Small, focused services with constructor injection -- match
  `SatelliteTrackingService`/`ConstellationService`'s shape for new
  backend work.
- File-backed or bundled static data over a database for anything that
  doesn't need live writes -- no database exists in this project yet.
- Full files, not patches, when iterating with an AI pairing tool in this
  repo -- Windows CRLF checkouts have repeatedly broken `git am`/patch
  application; direct file replacement has been the reliable path.

## Visual identity

```
Background:     #04080F   (near-black)
Primary text:   #DDE8F0   (light blue-grey)
Accent cyan:    #00C8E0   (primary brand colour -- mode bar, GPS FIX badge)
Gold:           #E8A020   (GEO.ECL mode, Night Lights, ISS ground track)
Violet:         #A030D8   (HELIO.ECL mode)
Sky blue:       #30A8E0   (HELIO.EQ mode, satellite links)
Muted:          #6080A0   (secondary labels, timestamps)
Border:         #253545   (panel separators)
Panel fill:     #0C1828   (right/left panel background)
Font:           'Courier New' for labels/code, 'Calibri' for body text
```

## App layout

```
+----------------------------------------------------------------------+
|  STARMAP  | GNSS | GEO.EQ | GEO.ECL | HELIO.EQ | HELIO.ECL |   UTC    |
+----------+--------------------------------------------+--------------+
| LEFT     |                                            |  RIGHT       |
| PANEL    |         CesiumJS 3D GLOBE                  |  PANEL       |
| (320px)  |         (WebGL, dark star background)      |  (320px)     |
| VIEW     |                                            |  FIX         |
| DISPLAY  |         [Earth globe, satellites,          |  STATUS      |
| TRACK    |          ISS, city lights, graticule]      |  VIEWPT      |
| FRAME    |                                            |  UTC CLK     |
|          +--------------------------------------------+  SIGNALS     |
|  CONTROLS|    SCALE o----------------------  GNSS/Ground             |
+----------+--------------------------------------------+--------------+
```
