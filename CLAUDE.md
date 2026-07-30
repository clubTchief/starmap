# STARMAP — Claude Code Context

## What this app is

STARMAP is a unified real-time geospatial and astrodynamics visualisation platform.
It merges GNSS Tracker (live GPS from a Hiwonder USB module) with COSMOFRAME
(solar system visualiser using JPL DE430 ephemeris) into a single Spring Boot app
running on localhost:8080.

The app has five frame modes:
- **GNSS** — live GPS position, 5-constellation satellite sky plot, ISS tracking
- **GEO·EQ** — Geocentric Equatorial (ECI/EME2000), RA/Dec celestial grid
- **GEO·ECL** — Geocentric Ecliptic, obliquity arc, ecliptic plane
- **HELIO·EQ** — Heliocentric Equatorial, solar system top-down orrery
- **HELIO·ECL** — Heliocentric Ecliptic, ecliptic reference prominent

A scale slider at the bottom transitions from 10,000 km (GNSS) to 400 billion km
(outer solar system) continuously.

---

## Visual identity (use these exactly in the video)

```
Background:     #04080F   (near-black)
Primary text:   #DDE8F0   (light blue-grey)
Accent cyan:    #00C8E0   (primary brand colour — mode bar, GPS FIX badge)
Gold:           #E8A020   (GEO·ECL mode, Night Lights, ISS ground track)
Violet:         #A030D8   (HELIO·ECL mode)
Sky blue:       #30A8E0   (HELIO·EQ mode, satellite links)
Muted:          #6080A0   (secondary labels, timestamps)
Border:         #253545   (panel separators)
Panel fill:     #0C1828   (right/left panel background)
Font:           'Courier New' for labels/code, 'Calibri' for body text
```

---

## App layout (what the screen looks like)

```
┌──────────────────────────────────────────────────────────────────┐
│  STARMAP  │ ⊕ GNSS │ ① GEO·EQ │ ② GEO·ECL │ ③ HELIO·EQ │ ④ HELIO·ECL │  UTC  │
├──────────┬───────────────────────────────────────────┬───────────┤
│ LEFT     │                                           │  RIGHT    │
│ PANEL    │         CesiumJS 3D GLOBE                 │  PANEL    │
│ (320px)  │         (WebGL, dark star background)     │  (320px)  │
│ VIEW     │                                           │  FIX      │
│ DISPLAY  │         [Earth globe, satellites,         │  STATUS   │
│ TRACK    │          ISS, city lights, graticule]     │  VIEWPT   │
│ FRAME    │                                           │  UTC CLK  │
│          ├───────────────────────────────────────────┤  SIGNALS  │
│  CONTROLS│    SCALE ●━━━━━━━━━━━━━━━━━━━━━━━━  GNSS/Ground    │
└──────────┴───────────────────────────────────────────┴───────────┘
```

---

## Screenshot descriptions for each scene

Use these as art direction when synthesising video frames:

### Scene 1 — GNSS Mode (default)
- Full Earth globe, India visible and centred
- Cyan graticule lines wrapping the globe
- Orange ISS dot near Indian Ocean with red dashed ground track
- Cyan GPS satellite dots at 20,200 km in orbit, link lines to observer
- Blue observer marker dot near Mumbai (19.15°N, 72.88°E)
- White dashed terminator line (day/night boundary)
- Right panel: "GPS FIX" green badge, SATS: 27, lat/lon/alt values, signal bars

### Scene 2 — Night Lights
- Same globe but northern Europe, India, East Asia blazing with orange city lights
- Day side: Blue Marble imagery. Night side: NASA Black Marble VIIRS city lights
- Mumbai, Delhi, Tokyo, London clearly visible clusters

### Scene 3 — GEO·EQ mode
- Same Earth globe at 10,000 km
- Cyan RA/Dec celestial grid lines radiating outward from Earth
- Dashed red Earth rotation axis through the poles (23.44° tilt visible)
- Equatorial plane disc (cyan, transparent)
- Right panel shows ECI coordinates updating

### Scene 4 — HELIO·ECL mode (the wow moment)
- Black space, no globe
- Bright warm Sun glow (radial gradient, yellow-orange) at centre
- Mercury (grey dot, closest), Venus (gold dot), Earth (blue dot ~1 AU),
  Mars (red-orange dot, outside Earth)
- Moon dot near Earth with "☽ Moon (offset exaggerated 80×)" label
- Cyan equatorial ring around Sun
- Gold ecliptic disc (tilted ellipse)
- Top-down view looking down the ecliptic north pole

### Scene 5 — Sky View
- Near-black background (first-person horizon)
- Cyan azimuth/elevation grid: rings at 15° intervals, spokes every 15°
- N, NE, E, SE, S, SW, W, NW compass labels in cyan
- Sun glow visible above horizon, Moon glow on opposite side
- "Z" zenith marker at centre

### Scene 6 — Scale Slider zoom-out
- Start: GNSS globe view (Earth fills 65% of screen)
- Zoom out → Moon appears → planets appear → full solar system

---

## Key facts for title cards and lower thirds

- **GPS accuracy**: Sub-metre (HDOP 0.5)
- **Constellations**: GPS · GLONASS · Galileo · BeiDou · QZSS
- **ISS tracking**: Orekit SGP4 · CelesTrak OMM JSON
- **Ephemeris**: JPL DE430 · sub-arcsecond accuracy
- **Coordinate frames**: WGS-84 · ECEF · ECI/EME2000 · Geocentric Ecliptic · Heliocentric Ecliptic
- **Update rate**: 1 Hz via Server-Sent Events
- **Stack**: Spring Boot 3.2 · Java 17 · Orekit 12.1 · CesiumJS 1.142 · NASA GIBS
- **Scale range**: 10,000 km → 400 billion km (continuous)

---

## Video structure (5 minutes = 300 seconds at 30fps = 9000 frames)

| Scene | Duration | Title | Key visual |
|-------|----------|-------|------------|
| 00–03s | 3s | Intro fade | Black to STARMAP logo on dark background |
| 03–08s | 5s | Tagline | "From GPS to the Solar System" |
| 08–45s | 37s | GNSS Mode | Globe + GPS fix + ISS |
| 45–70s | 25s | Night Lights | City lights reveal |
| 70–110s | 40s | ISS Tracking | ISS chase + ground track |
| 110–155s | 45s | Geocentric Frames | GEO·EQ → GEO·ECL with annotations |
| 155–210s | 55s | Solar System | HELIO·ECL orrery — the centrepiece |
| 210–240s | 30s | Sky View | First-person AzEl horizon |
| 240–265s | 25s | Scale Slider | Continuous zoom from ground to solar system |
| 265–285s | 20s | Tech Stack | Animated stack cards |
| 285–300s | 15s | Closing | STARMAP logo + "Built with Claude" |

---

## Remotion component hints

- Use `interpolate()` with `Easing.bezier` for all camera-like transitions
- Use `spring()` for element entrances (stiffness: 80, damping: 15)
- Globe scenes: dark background (#04080F), glowing sphere using radial gradients
- Text: Courier New for labels, Calibri/sans-serif for body
- The scale slider zoom should use `interpolate(frame, [0, 60], [10000, 400e9])`
  mapped to a visual camera-distance metaphor
- Sun glow: two concentric `radialGradient` circles (core 130px, halo 340px)
- Moon glow: point with 14px core, 90px halo, cool blue-white palette
- Orbital rings: SVG ellipses with `strokeDasharray` and slow rotation
- City lights: bright warm spots (#FF8800 to #FFCC40) on dark globe silhouette

---

## Tone

Cinematic, precise, confident. No exclamation marks. No marketing language.
The visuals are the argument — narration and titles should be sparse and factual.
The solar system scene should feel like a discovery, not a feature list.

---

## Output

Target: `out/starmap-demo.mp4`  
Resolution: 1920×1080  
FPS: 30  
Duration: exactly 300 seconds (9000 frames)
