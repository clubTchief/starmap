'use strict';

// ── Frame mode metadata ──────────────────────────────────────────────────────
const FRAME_META = {
  0: { name:'GNSS / Ground',             accent:'#00e5ff', origin:'Earth', frame:'WGS-84',           posKey:null },
  1: { name:'Geocentric · Equatorial',   accent:'#00e5ff', origin:'Earth', frame:'ECI / EME2000',    posKey:'eciM' },
  2: { name:'Geocentric · Ecliptic',     accent:'#ffc040', origin:'Earth', frame:'Geocentric Ecl',   posKey:'geoEclM' },
  3: { name:'Heliocentric · Equatorial', accent:'#40c0ff', origin:'Sun',   frame:'Heliocentric Eq',  posKey:'helioEqM' },
  4: { name:'Heliocentric · Ecliptic',   accent:'#c040ff', origin:'Sun',   frame:'Heliocentric Ecl', posKey:'helioEclM' },
};

// ── Scale zones (slider 0-100 → camera distance) ─────────────────────────────
const SCALE_ZONES = [
  { min:0,  max:25,  label:'GNSS / Ground',       dist:1.0e7, frame:0 },
  { min:25, max:45,  label:'Earth–Moon System',   dist:5e8,   frame:1 },
  { min:45, max:65,  label:'Inner Solar System',  dist:3e9,   frame:1 },
  { min:65, max:85,  label:'Solar System',        dist:6e10,  frame:4 },
  { min:85, max:100, label:'Outer Solar System',  dist:4e11,  frame:4 },
];




let activeFrameMode = 0;
let latestStarmapSnap = null;
let currentScaleValue = 20;  // slider 0-100, used to gate satellite rendering
let nightLayer = null;   // set inside initGlobe()
let graticuleVisible = true;
let graticuleEntities = [];
let terminatorEnabled  = true;
let nightLightsEnabled = false;




'use strict';




/* ----------------------------------------------------------------
   CESIUM GLOBE INIT  (merged from initGlobe.js)
   — NASA Blue Marble day layer + VIIRS Black Marble night lights
   — Custom GIBS epsg4326 tiling scheme (fixes tile distortion)
   — globe.enableLighting for physically-correct terminator
   — Lat/lon graticule, observer marker, constellation entities
---------------------------------------------------------------- */
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjOWRiZWFiNS04MjA2LTQyMTYtODk2NC1lNmZkMjI1MDYwMjMiLCJpZCI6MjAwOTE1LCJpYXQiOjE3MTAxMjUxOTh9.rn-mJGC8AVINKYd6pRCT2KScL3knDF6HG1fsLkQMdFE';

// Viewer declared at module scope so all GPS/constellation code can reference it
let viewer;

function initGlobe() {
  viewer = new Cesium.Viewer('cesiumContainer', {
    globe:                new Cesium.Globe(Cesium.Ellipsoid.WGS84),
    skyAtmosphere:        new Cesium.SkyAtmosphere(),
    sceneModePicker:      false,
    baseLayerPicker:      false,
    geocoder:             false,
    homeButton:           false,
    navigationHelpButton: false,
    animation:            false,
    timeline:             false,
    fullscreenButton:     false,
    infoBox:              false,
    selectionIndicator:   false,
    shadows:              false,
    imageryProvider:      false,
    skyBox: new Cesium.SkyBox({
      sources: {
        positiveX: Cesium.buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_px.jpg'),
        negativeX: Cesium.buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_mx.jpg'),
        positiveY: Cesium.buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_py.jpg'),
        negativeY: Cesium.buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_my.jpg'),
        positiveZ: Cesium.buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_pz.jpg'),
        negativeZ: Cesium.buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_mz.jpg')
      }
    }),
    contextOptions: { webgl: { alpha: false, antialias: true } }
  });

  const scene = viewer.scene;
  scene.backgroundColor = Cesium.Color.BLACK;

  // ── Cesium clock driven exclusively by GPS UTC ──────────────────────
  // SYSTEM_CLOCK makes Cesium track real wall-clock time at 1:1 (no
  // animation-frame multiplier drift). handleSnapshot() overrides
  // currentTime with the GPS UTC timestamp every second, so Sun/Moon/
  // terminator stay locked to GPS time. If SSE drops out the globe
  // gracefully falls back to the system clock.
  viewer.clock.currentTime   = Cesium.JulianDate.fromDate(new Date());
  viewer.clock.clockStep     = Cesium.ClockStep.SYSTEM_CLOCK;
  viewer.clock.shouldAnimate = true;

  // ── Custom GIBS tiling scheme ───────────────────────────────────────
  // GIBS epsg4326 uses 288°/tile at level-0 (not the standard 180°),
  // so we build a custom scheme to get correct tile row/col numbers.
  function makeGibsTilingScheme() {
    const GIBS_BASE = 288.0;
    const ellipsoid = Cesium.Ellipsoid.WGS84;
    return {
      ellipsoid,
      rectangle: Cesium.Rectangle.MAX_VALUE,
      projection: new Cesium.GeographicProjection(ellipsoid),
      getNumberOfXTilesAtLevel(level) { return Math.ceil(360 * Math.pow(2, level) / GIBS_BASE); },
      getNumberOfYTilesAtLevel(level) { return Math.ceil(180 * Math.pow(2, level) / GIBS_BASE); },
      rectangleToNativeRectangle(rect, result) {
        const r = result || new Cesium.Rectangle();
        r.west  = Cesium.Math.toDegrees(rect.west);
        r.south = Cesium.Math.toDegrees(rect.south);
        r.east  = Cesium.Math.toDegrees(rect.east);
        r.north = Cesium.Math.toDegrees(rect.north);
        return r;
      },
      tileXYToNativeRectangle(x, y, level, result) {
        const tw = GIBS_BASE / Math.pow(2, level);
        const r  = result || new Cesium.Rectangle();
        r.west  = x * tw - 180; r.east  = r.west + tw;
        r.north = 90 - y * tw;  r.south = r.north - tw;
        return r;
      },
      tileXYToRectangle(x, y, level, result) {
        const r = this.tileXYToNativeRectangle(x, y, level, result);
        r.west  = Cesium.Math.toRadians(r.west);
        r.south = Cesium.Math.toRadians(r.south);
        r.east  = Cesium.Math.toRadians(r.east);
        r.north = Cesium.Math.toRadians(r.north);
        return r;
      },
      positionToTileXY(position, level, result) {
        const tw = GIBS_BASE / Math.pow(2, level);
        const r  = result || new Cesium.Cartesian2();
        r.x = Math.floor((Cesium.Math.toDegrees(position.longitude) + 180) / tw);
        r.y = Math.floor((90 - Cesium.Math.toDegrees(position.latitude))   / tw);
        return r;
      }
    };
  }
  const gibsScheme = makeGibsTilingScheme();

  // ── Layer 0: NASA Blue Marble (day) ────────────────────────────────
  viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/' +
           'BlueMarble_NextGeneration/default/500m/{z}/{y}/{x}.jpg',
      tilingScheme: gibsScheme,
      maximumLevel: 8, minimumLevel: 0,
      tileWidth: 512, tileHeight: 512,
      credit: new Cesium.Credit('NASA EOSDIS / Blue Marble Next Generation')
    })
  );

  // ── Layer 1: NASA Black Marble (VIIRS SNPP DNB) — city lights on night side
  // VIIRS_Black_Marble is the GIBS WMTS product for the NASA Black Marble
  // VNP46 suite — 500m resolution annual composite of city lights.
  nightLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/' +
           'VIIRS_Black_Marble/default/500m/{z}/{y}/{x}.png',
      tilingScheme: gibsScheme,
      maximumLevel: 8, minimumLevel: 0,
      tileWidth: 512, tileHeight: 512,
      credit: new Cesium.Credit('NASA Black Marble — VIIRS/SNPP Day/Night Band')
    })
  );
  nightLayer.show                    = false;
  nightLayer.alpha                   = 1.0;
  nightLayer.dayAlpha                = 0.0;    // invisible on day side
  nightLayer.nightAlpha              = 1.0;    // fully visible on night side
  nightLayer.brightness              = 3.5;    // boost city lights visibility
  nightLayer.contrast                = 1.5;    // sharpen the light clusters
  nightLayer.colorToAlpha            = Cesium.Color.BLACK;
  nightLayer.colorToAlphaThreshold   = 0.03;  // cut dark ocean, keep faint cities

  // ── Day/night terminator via native globe lighting ──────────────────
  scene.globe.enableLighting            = true;
  scene.globe.dynamicAtmosphereLighting = false;
  scene.globe.lightingFadeOutDistance   = 1.0e8;
  scene.globe.lightingFadeInDistance    = 1.0e7;
  scene.light                           = new Cesium.SunLight({ intensity: 1.6 });
  scene.highDynamicRange                = false;

  // terminatorEnabled and nightLightsEnabled are module-scope
  terminatorEnabled  = true;
  nightLightsEnabled = false;

  // ── Lat/lon graticule ───────────────────────────────────────────────
  function buildGraticule() {
    // Clear any existing graticule entities first
    graticuleEntities.forEach(e => viewer.entities.remove(e));
    graticuleEntities.length = 0;

    const meridianColor = Cesium.Color.fromCssColorString('#2a7a9a').withAlpha(0.75);
    const parallelColor = Cesium.Color.fromCssColorString('#2a7a9a').withAlpha(0.75);
    const equatorColor  = Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.90);
    const tropicColor   = Cesium.Color.fromCssColorString('#ffb300').withAlpha(0.75);
    const poleColor     = Cesium.Color.fromCssColorString('#7c83fd').withAlpha(0.75);
    const STEPS = 180;

    // Meridians every 15°
    for (let lon = -180; lon < 180; lon += 15) {
      const pts = [];
      for (let i = 0; i <= STEPS; i++) {
        pts.push(Cesium.Cartesian3.fromDegrees(lon, -90 + i * 180/STEPS, 10000));
      }
      const e = viewer.entities.add({
        _isGraticule: true,
        show: graticuleVisible,
        polyline: { positions: pts, width: lon === 0 ? 1.2 : 0.8,
          material: lon === 0 ? equatorColor : meridianColor,
          arcType: Cesium.ArcType.NONE, clampToGround: false }
      });
      graticuleEntities.push(e);
    }
    // Parallels every 15°
    for (let lat = -90; lat <= 90; lat += 15) {
      const pts = [];
      for (let i = 0; i <= STEPS*2; i++) {
        pts.push(Cesium.Cartesian3.fromDegrees(-180 + i * 360/(STEPS*2), lat, 10000));
      }
      const col = lat === 0 ? equatorColor
              : (Math.abs(lat) === 23.5) ? tropicColor
              : (Math.abs(lat) === 66.5) ? poleColor
              : parallelColor;
      const w = (lat === 0) ? 1.5 : (Math.abs(lat) === 23.5 || Math.abs(lat) === 66.5) ? 1.0 : 0.8;
      const e = viewer.entities.add({
        _isGraticule: true,
        show: graticuleVisible,
        polyline: { positions: pts, width: w, material: col,
          arcType: Cesium.ArcType.NONE, clampToGround: false }
      });
      graticuleEntities.push(e);
    }
  }
  buildGraticule();

  // ── Equatorial celestial grid (Stellarium-style) ────────────────────
  // RA hour circles and Dec parallels drawn on the celestial sphere (~1 AU).
  // Positions are in ECEF but rotated by GMST each frame so they stay
  // fixed to the stars as the Earth rotates beneath them.
  let eqGridVisible  = false;
  const EQ_RADIUS    = 5.0e8;    // 500,000 km — beyond GEO, no float precision issues
  const EQ_STEPS     = 360;      // more segments = no gaps at any zoom

  // Stellarium equatorial grid colours
  const EQ_LINE_COL  = '#1a4a6e';
  const EQ_EQ_COL    = '#2255a0';
  const EQ_POLE_COL  = '#3a6a9a';

  // Convert RA (hours 0-24) and Dec (degrees -90..90) to ECEF Cartesian3,
  // rotated by GMST (radians) so the grid tracks the stars.
  function raDecToEcef(raHours, decDeg, gmst) {
    const raRad  = raHours * Math.PI / 12.0;   // RA in radians
    const decRad = decDeg  * Math.PI / 180.0;
    // ICRF unit vector
    const x = Math.cos(decRad) * Math.cos(raRad);
    const y = Math.cos(decRad) * Math.sin(raRad);
    const z = Math.sin(decRad);
    // Rotate from ICRF to ECEF by -GMST around Z axis
    const cosG = Math.cos(-gmst), sinG = Math.sin(-gmst);
    return new Cesium.Cartesian3(
      (x * cosG - y * sinG) * EQ_RADIUS,
      (x * sinG + y * cosG) * EQ_RADIUS,
      z * EQ_RADIUS
    );
  }

  // Compute GMST from a Cesium JulianDate
  function computeGmst(jd) {
    // Days since J2000.0
    const d = Cesium.JulianDate.totalDays(jd) - 2451545.0;
    // GMST in radians (IAU 1982 formula)
    const gmstDeg = 280.46061837 + 360.98564736629 * d;
    return (gmstDeg % 360) * Math.PI / 180.0;
  }

  // Pre-built entity arrays for the equatorial grid — repositioned each frame
  const eqGridEntities = [];

  function buildEquatorialGrid() {
    // Remove any existing eq grid entities
    eqGridEntities.forEach(e => viewer.entities.remove(e));
    eqGridEntities.length = 0;

    const gmst = computeGmst(viewer.clock.currentTime);

    // ── RA hour circles every 10° (24 × 1.5 = 36 lines) ───────────────────
    for (let raDeg = 0; raDeg < 360; raDeg += 10) {
      const raH = raDeg / 15.0;
      const pts = [];
      for (let i = 0; i <= EQ_STEPS; i++) {
        const dec = -90 + i * 180 / EQ_STEPS;
        pts.push(raDecToEcef(raH, dec, gmst));
      }
      const isMain6h  = (raDeg % 90 === 0);   // 0h, 6h, 12h, 18h
      const isHour    = (raDeg % 15 === 0);    // whole hours
      const e = viewer.entities.add({
        _isEqGrid: true,
        show: eqGridVisible,
        polyline: {
          positions: pts,
          width: isMain6h ? 1.2 : isHour ? 0.9 : 0.6,
          material: Cesium.Color.fromCssColorString(
            isMain6h ? EQ_POLE_COL : EQ_LINE_COL)
            .withAlpha(isMain6h ? 0.60 : isHour ? 0.40 : 0.25),
          arcType: Cesium.ArcType.NONE,
        }
      });
      eqGridEntities.push(e);
    }

    // ── Dec parallels every 10° ─────────────────────────────────────────
    for (let dec = -80; dec <= 80; dec += 10) {
      const pts = [];
      for (let i = 0; i <= EQ_STEPS; i++) {
        pts.push(raDecToEcef(i * 24 / EQ_STEPS, dec, gmst));
      }
      const isCelEq  = dec === 0;
      const isMain   = Math.abs(dec) % 30 === 0;
      const col  = isCelEq ? EQ_EQ_COL : isMain ? EQ_POLE_COL : EQ_LINE_COL;
      const alph = isCelEq ? 0.75 : isMain ? 0.50 : 0.28;
      const w    = isCelEq ? 1.5  : isMain ? 1.0  : 0.6;
      const e = viewer.entities.add({
        _isEqGrid: true,
        show: eqGridVisible,
        polyline: {
          positions: pts, width: w,
          material: Cesium.Color.fromCssColorString(col).withAlpha(alph),
          arcType: Cesium.ArcType.NONE,
        }
      });
      eqGridEntities.push(e);
    }

    // ── RA labels at 0h, 3h, 6h, 9h, 12h, 15h, 18h, 21h ──────────────
    [0,3,6,9,12,15,18,21].forEach(raH => {
      const cart = raDecToEcef(raH, 3, gmst);
      const e = viewer.entities.add({
        _isEqGrid: true,
        show: eqGridVisible,
        position: new Cesium.ConstantPositionProperty(cart),
        label: {
          text: `${raH}h`,
          font: '9px JetBrains Mono',
          fillColor: Cesium.Color.fromCssColorString(EQ_POLE_COL).withAlpha(0.85),
          outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }
      });
      eqGridEntities.push(e);
    });
  }

  buildEquatorialGrid();

  // Update eq grid positions every second as Earth rotates (GMST changes)
  // Only do the work when the grid is visible to avoid unnecessary computation
  let _eqLastGmst = null;
  viewer.scene.postRender.addEventListener(() => {
    if (!eqGridVisible) return;
    const gmst = computeGmst(viewer.clock.currentTime);
    // Only rebuild if GMST has changed by > 0.001 rad (~3.4 arcmin — 1 update/sec is enough)
    if (_eqLastGmst !== null && Math.abs(gmst - _eqLastGmst) < 0.001) return;
    _eqLastGmst = gmst;
    buildEquatorialGrid();
  });

  document.getElementById('btn-eqgrid').addEventListener('click', () => {
    eqGridVisible = !eqGridVisible;
    document.getElementById('btn-eqgrid').classList.toggle('on', eqGridVisible);
    eqGridEntities.forEach(e => { e.show = eqGridVisible; });
    if (eqGridVisible) { _eqLastGmst = null; buildEquatorialGrid(); }
  });

  // ── Globe overlay button listeners ─────────────────────────────────
  document.getElementById('btn-terminator').addEventListener('click', () => {
    terminatorEnabled = !terminatorEnabled;
    document.getElementById('btn-terminator').classList.toggle('on', terminatorEnabled);
    scene.globe.enableLighting = terminatorEnabled;
    nightLayer.show = nightLightsEnabled && terminatorEnabled;
  });

  document.getElementById('btn-nightlights').addEventListener('click', () => {
    nightLightsEnabled = !nightLightsEnabled;
    document.getElementById('btn-nightlights').classList.toggle('on', nightLightsEnabled);
    nightLayer.show = nightLightsEnabled && terminatorEnabled;
  });

  // graticuleVisible is module-scope
  document.getElementById('btn-graticule').addEventListener('click', () => {
    graticuleVisible = !graticuleVisible;
    document.getElementById('btn-graticule').classList.toggle('on', graticuleVisible);
    viewer.entities.values
      .filter(e => e._isGraticule)
      .forEach(e => { e.show = graticuleVisible; });
  });

  document.getElementById('btn-flyhere').addEventListener('click', () => {
    if (latestPos && latestPos.fixQuality > 0) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          latestPos.longitude, latestPos.latitude, 500000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
        duration: 2
      });
    }
  });

  // ── GPS Display toggle — hides/shows observer marker, trail, GNSS sat entities ──

  document.getElementById('btn-gps-display').addEventListener('click', () => {
    gpsDisplayEnabled = !gpsDisplayEnabled;
    document.getElementById('btn-gps-display').classList.toggle('on', gpsDisplayEnabled);

    // Observer marker + trail
    if (liveMarker)  liveMarker.show  = gpsDisplayEnabled;
    if (trailEntity) trailEntity.show = gpsDisplayEnabled;

    // GNSS constellation satellites, orbits, links, cone
    [...gpsSatEntities, ...orbitEntities, ...linkEntities].forEach(e => {
      if (e) e.show = gpsDisplayEnabled;
    });
    if (coneEntity) coneEntity.show = gpsDisplayEnabled;
  });

  // ── Sky View: Stellarium-style AzEl grid ─────────────────────────────────
  let skyViewActive = false;
  let preSkyCamera  = null;
  let horizonEntity = null;

  function enterSkyView() {
    skyViewActive = true;
    document.getElementById('btn-skyview').classList.add('on');

    preSkyCamera = {
      destination: viewer.camera.position.clone(),
      orientation: { heading: viewer.camera.heading,
                     pitch:   viewer.camera.pitch,
                     roll:    viewer.camera.roll }
    };

    const lat = latestPos && latestPos.fixQuality > 0 ? latestPos.latitude  : 19.1334;
    const lon = latestPos && latestPos.fixQuality > 0 ? latestPos.longitude : 72.9133;
    const alt = latestPos && latestPos.fixQuality > 0 ? latestPos.altitude  : 14.0;

    // ── Black sky background ───────────────────────────────────────────────
    scene.globe.show         = false;
    scene.skyAtmosphere.show = false;
    scene.sun.show           = false;
    scene.moon.show          = false;
    scene.backgroundColor    = Cesium.Color.fromCssColorString('#04080f');

    // ── Stellarium colour palette ─────────────────────────────────────────
    // Grid lines: thin steel-blue, semi-transparent (Stellarium default)
    const GRID_DIST = 100_000;                    // metres to project grid onto
    const GRID_COL  = '#4a8fbb';                  // Stellarium AzEl grid colour
    const HORIZ_COL = '#5bc8f5';                  // brighter horizon ring
    const CARD_COL  = '#5bc8f5';                  // cardinal labels
    const DEG_COL   = '#3a7fa0';                  // degree tick labels
    const SPOKE_COL = '#2e6e96';                  // azimuth spokes (dimmer)
    const STEPS     = 180;                        // segments per ring

    // Helper: add a polyline entity tagged as sky view
    function skyLine(positions, width, colorHex, alpha) {
      if (!positions || positions.length < 2) return;
      const e = viewer.entities.add({
        _isSkyViewLabel: true,
        polyline: {
          positions,
          width,
          material: Cesium.Color.fromCssColorString(colorHex).withAlpha(alpha),
          arcType: Cesium.ArcType.NONE,
          clampToGround: false,
        }
      });
      return e;
    }

    // Helper: add a label entity tagged as sky view
    function skyLabel(cart, text, font, colorHex, alpha, vOrigin, hOrigin) {
      if (!cart) return;
      viewer.entities.add({
        _isSkyViewLabel: true,
        position: cart,
        label: {
          text,
          font,
          fillColor: Cesium.Color.fromCssColorString(colorHex).withAlpha(alpha ?? 1.0),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          verticalOrigin:   vOrigin ?? Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: hOrigin ?? Cesium.HorizontalOrigin.CENTER,
          showBackground: false,
        }
      });
    }

    // ── 1. Elevation circles every 15° (15, 30, 45, 60, 75) ───────────────
    for (let el = 15; el <= 75; el += 15) {
      const pts = [];
      for (let i = 0; i <= STEPS; i++) {
        const c = skyElAzToCart(lat, lon, el, (i / STEPS) * 360, GRID_DIST);
        if (c) pts.push(c);
      }
      const isHalf = (el === 45);
      skyLine(pts, isHalf ? 1.5 : 1.0, GRID_COL, isHalf ? 0.65 : 0.45);

      // Degree label at south (az=180) — same position Stellarium uses
      skyLabel(
        skyElAzToCart(lat, lon, el, 180, GRID_DIST * 1.02),
        `${el}°`,
        '9px JetBrains Mono',
        DEG_COL, 0.85
      );
    }

    // ── 2. Horizon ring (el ≈ 1°) — bright, slightly thicker ──────────────
    const horizPts = [];
    for (let i = 0; i <= STEPS; i++) {
      const c = skyElAzToCart(lat, lon, 1, (i / STEPS) * 360, GRID_DIST);
      if (c) horizPts.push(c);
    }
    horizonEntity = viewer.entities.add({
      _isSkyViewLabel: true,
      polyline: {
        positions: horizPts, width: 2.0,
        material: Cesium.Color.fromCssColorString(HORIZ_COL).withAlpha(0.90),
        arcType: Cesium.ArcType.NONE,
      }
    });

    // ── 3. Azimuth spokes every 15° from horizon to zenith ────────────────
    for (let az = 0; az < 360; az += 15) {
      const pts = [];
      for (let el = 1; el <= 89; el += 2) {
        const c = skyElAzToCart(lat, lon, el, az, GRID_DIST);
        if (c) pts.push(c);
      }
      const isCardinal = (az % 90 === 0);
      const isIntercardinal = (az % 45 === 0 && !isCardinal);
      skyLine(
        pts,
        isCardinal ? 1.8 : isIntercardinal ? 1.2 : 0.8,
        isCardinal ? GRID_COL : SPOKE_COL,
        isCardinal ? 0.70 : isIntercardinal ? 0.50 : 0.30
      );
    }

    // ── 4. Cardinal and intercardinal labels ──────────────────────────────
    const LABELS = [
      {az:   0, label: 'N',  bold: true},
      {az:  45, label: 'NE', bold: false},
      {az:  90, label: 'E',  bold: true},
      {az: 135, label: 'SE', bold: false},
      {az: 180, label: 'S',  bold: true},
      {az: 225, label: 'SW', bold: false},
      {az: 270, label: 'W',  bold: true},
      {az: 315, label: 'NW', bold: false},
    ];
    LABELS.forEach(({az, label, bold}) => {
      // Place label just below the horizon ring
      const cart = skyElAzToCart(lat, lon, -1.5, az, GRID_DIST * 1.03);
      if (!cart) return;
      skyLabel(
        cart, label,
        bold ? 'bold 12px JetBrains Mono' : '10px JetBrains Mono',
        CARD_COL, bold ? 1.0 : 0.80
      );
    });

    // ── 5. Zenith marker ──────────────────────────────────────────────────
    const zenCart = skyElAzToCart(lat, lon, 89.8, 0, GRID_DIST);
    if (zenCart) {
      viewer.entities.add({
        _isSkyViewLabel: true,
        position: zenCart,
        point: {
          pixelSize: 8,
          color: Cesium.Color.fromCssColorString(CARD_COL).withAlpha(0.9),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }
      });
      skyLabel(
        skyElAzToCart(lat, lon, 88, 0, GRID_DIST),
        'Z', 'bold 10px JetBrains Mono', CARD_COL, 0.9
      );
    }

    // ── 6. Camera: straight up, north-up ──────────────────────────────────
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt + 200),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(90), roll: 0 },
      duration: 1.5,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }

  function exitSkyView() {
    skyViewActive = false;
    document.getElementById('btn-skyview').classList.remove('on');

    // ── Restore globe ───────────────────────────────────────────────────────
    scene.globe.show         = true;
    scene.skyAtmosphere.show = true;
    scene.sun.show           = true;
    scene.moon.show          = true;
    scene.backgroundColor    = Cesium.Color.BLACK;
    scene.globe.enableLighting = terminatorEnabled;

    // Remove horizon ring and cardinal labels
    if (horizonEntity) { viewer.entities.remove(horizonEntity); horizonEntity = null; }
    viewer.entities.values
      .filter(e => e._isSkyViewLabel)
      .forEach(e => viewer.entities.remove(e));

    // ── Fly back ────────────────────────────────────────────────────────────
    const dest = preSkyCamera || {
      destination: Cesium.Cartesian3.fromDegrees(72.9133, 19.1334, 8_000_000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 }
    };
    viewer.camera.flyTo({ ...dest, duration: 2,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT });
  }

  document.getElementById('btn-skyview').addEventListener('click', () => {
    if (skyViewActive) exitSkyView(); else enterSkyView();
  });

} // end initGlobe()

// ── Call initGlobe immediately so `viewer` exists before any code below uses it ──
initGlobe();

/* ----------------------------------------------------------------
   GLOBALS
---------------------------------------------------------------- */
const API = '';  // Spring Boot at same origin

// GPS State
let latestPos       = null;
let latestSats      = [];
let latestSatsMap   = {};   // PRN → satellite (Sky-tab lookup for globe labels)
let trackPoints     = [];
let frameData       = null;

// 3D constellation entities
let gpsSatEntities  = [];
let orbitEntities   = [];
let coneEntity      = null;
let linkEntities    = [];
let observerEntity  = null;
let trailEntity     = null;
let liveMarker      = null;

// Playback
let playbackActive  = false;
let playbackIdx     = 0;
let playbackTimer   = null;
let recording       = false;

// GPS globe display toggle
let gpsDisplayEnabled = true;

/* ----------------------------------------------------------------
   GPS CONSTELLATION MATH (client-side Keplerian)
   24 satellites, 6 orbital planes, i=55°, a≈26560km
---------------------------------------------------------------- */
const GPS_A = 26_560_000;     // semi-major axis (m)
const GPS_I = 55 * Math.PI / 180; // inclination rad
const GPS_PLANES = 6;
const GPS_PER_PLANE = 4;
const MU = 3.986004418e14;
const T_GPS = 2 * Math.PI * Math.sqrt(Math.pow(GPS_A, 3) / MU); // ~43080 s

// Each sat: { plane, slot, prn, raan, m0 }
const GPS_SATS = [];
for (let p = 0; p < GPS_PLANES; p++) {
  for (let s = 0; s < GPS_PER_PLANE; s++) {
    GPS_SATS.push({
      plane: p, slot: s,
      prn: p * GPS_PER_PLANE + s + 1,
      raan: (p * 60) * Math.PI / 180,                // 60° apart
      m0:   (s * 90 + p * 15) * Math.PI / 180,       // 90° spacing + phasing
    });
  }
}

/** Compute ECI position of GPS sat at time t (seconds since J2000) */
function gpsSatEci(sat, t) {
  const n = 2 * Math.PI / T_GPS; // mean motion
  const M = (sat.m0 + n * t) % (2 * Math.PI);
  // Solve Kepler (circular approximation – e≈0 for GPS)
  const f = M;  // true anomaly ≈ M for e=0
  const r = GPS_A;

  // Perifocal
  const xOrb = r * Math.cos(f);
  const yOrb = r * Math.sin(f);

  const ci = Math.cos(GPS_I), si = Math.sin(GPS_I);
  const cr = Math.cos(sat.raan), sr = Math.sin(sat.raan);

  const x = cr * xOrb - sr * yOrb * ci;
  const y = sr * xOrb + cr * yOrb * ci;
  const z = yOrb * si;
  return { x, y, z };
}

/** ECI → ECEF rotation (GMST) */
function eciToEcef(eci, epochMs) {
  const J2000_MS = 946728000000;
  const dtSec = (epochMs - J2000_MS) / 1000;
  const gmst = (4.89496121 + 7.292115e-5 * dtSec) % (2 * Math.PI);
  const c = Math.cos(gmst), s = Math.sin(gmst);
  return {
    x: c * eci.x + s * eci.y,
    y: -s * eci.x + c * eci.y,
    z: eci.z
  };
}

/** ECEF (m) → Cesium Cartesian3 */
function ecefToC3(ecef) {
  return new Cesium.Cartesian3(ecef.x, ecef.y, ecef.z);
}

/* ----------------------------------------------------------------
   SSE – LIVE TELEMETRY
---------------------------------------------------------------- */


/* ----------------------------------------------------------------
   POSITION TAB
---------------------------------------------------------------- */
function updatePositionTab(pos) {
  const badge = document.getElementById('fix-badge');
  badge.className = 'fix-badge ' + (['fix-none','fix-gps','fix-dgps'][pos.fixQuality] || 'fix-none');
  badge.textContent = (['NO FIX','GPS FIX','DGPS FIX'][pos.fixQuality] || 'NO FIX');

  set('pos-lat',  Math.abs(pos.latitude).toFixed(7)  + '° ' + (pos.latitude  >= 0 ? 'N' : 'S'));
  set('pos-lon',  Math.abs(pos.longitude).toFixed(7) + '° ' + (pos.longitude >= 0 ? 'E' : 'W'));
  set('pos-alt',  pos.altitude.toFixed(2) + ' m');
  set('pos-hdop', pos.hdop.toFixed(2));
  set('sats-used', pos.satellitesUsed);
  set('gps-utc-detail', pos.utcTime || '--');
  const _nfb = document.getElementById('no-fix-banner'); if(_nfb) _nfb.style.display = (pos.fixQuality === 0) ? 'block' : 'none';
}

function updateSigGrid(sats, ggaUsed) {
  const ALL_CONS = ['G','R','E','B','Q'];
  const META = { G:'GPS', R:'GLO', E:'GAL', B:'BDS', Q:'QZSS', I:'IRNSS', S:'SBAS' };

  // Seed all base constellations at 0/0
  const counts  = {};
  const usedCnt = {};
  ALL_CONS.forEach(p => { counts[p] = 0; usedCnt[p] = 0; });

  // Fill from live data
  (sats || []).forEach(s => {
    const p = (s.prn || '').charAt(0).toUpperCase();
    if (!p) return;
    counts[p]  = (counts[p]  || 0) + 1;
    if (s.used) usedCnt[p] = (usedCnt[p] || 0) + 1;
  });

  // Base constellations always first, any extras (I, S…) appended
  const extra   = Object.keys(counts).filter(p => !ALL_CONS.includes(p))
                        .sort((a,b) => (counts[b]||0) - (counts[a]||0));
  const entries = [...ALL_CONS, ...extra];

  const totalView = entries.reduce((s, p) => s + (counts[p]  || 0), 0);
  const totalUsed = entries.reduce((s, p) => s + (usedCnt[p] || 0), 0);
  // GGA field 7 is the receiver's authoritative used-in-fix count — use it
  // for the TOTAL row so it always matches the "SATS: N" badge.
  const displayUsed = (ggaUsed != null && ggaUsed > 0) ? ggaUsed : totalUsed;

  const cards = entries.map(p => {
    const col   = prnColor(p);
    const total = counts[p]  || 0;
    const used  = usedCnt[p] || 0;
    const label = META[p] || p;
    const pct   = total > 0 ? Math.round(used / total * 100) : 0;
    const dim   = total === 0 ? 'opacity:0.4;' : '';
    return `
      <div style="display:flex;align-items:center;gap:8px;${dim}">
        <span style="font-family:var(--mono);font-size:10px;font-weight:700;color:${col};width:52px;flex-shrink:0;white-space:nowrap;">${p} · ${label}</span>
        <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${col};border-radius:3px;transition:width .4s;"></div>
        </div>
        <span style="font-family:var(--mono);font-size:11px;font-weight:600;white-space:nowrap;min-width:40px;text-align:right;">
          <span style="color:${col};">${used}</span><span style="color:var(--muted);">/${total}</span>
        </span>
      </div>`;
  }).join('');

  const totalRow = `
    <div style="margin-top:4px;padding-top:6px;border-top:1px solid var(--border);
                display:flex;justify-content:space-between;align-items:center;">
      <span style="font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:1px;">TOTAL</span>
      <span style="font-family:var(--mono);font-size:11px;">
        <span style="color:var(--cyan);">${displayUsed}</span>
        <span style="color:var(--muted);">/${totalView} in view</span>
      </span>
    </div>`;

  document.getElementById('sig-grid').innerHTML = cards + totalRow;
}

/* ----------------------------------------------------------------
   SKY PLOT — SIGNATURE ELEMENT
---------------------------------------------------------------- */
const skyCanvas = document.getElementById('skyplot-canvas');
const skyCtx    = skyCanvas.getContext('2d');

// Colour by PRN prefix — single source of truth for the whole app
const PRN_COLOR = {
  G: '#00e5ff',   // GPS       — cyan
  R: '#8899aa',   // GLONASS   — grey  (matches GnssToolKit3)
  E: '#00c896',   // Galileo   — teal
  B: '#ff7a00',   // BeiDou    — orange (matches GnssToolKit3)
  Q: '#cc44ff',   // QZSS      — purple (matches GnssToolKit3)
  I: '#ffee44',   // IRNSS     — yellow
  S: '#aaaaaa',   // SBAS      — light grey
};
function prnColor(prn) { return PRN_COLOR[(prn||'').charAt(0).toUpperCase()] || '#ccd6e0'; }

// Constellation name → PRN prefix (for sig grid labelling)
const CONS_PREFIX = {
  GPS:'G', GLONASS:'R', GALILEO:'E', BEIDOU:'B', QZSS:'Q', IRNSS:'I', SBAS:'S'
};

// Show 0/0 for all constellations immediately on page load (PRN_COLOR now defined)
updateSigGrid([]);

function updateSkyTab(sats, ggaUsed) {
  updateSkyPlot(sats);
  updateSatList(sats);
  updateSigGrid(sats, ggaUsed);
}

function updateSkyPlot(sats) {
  const W = skyCanvas.width, H = skyCanvas.height;
  const cx = W/2, cy = H/2, R = W*0.46;
  skyCtx.clearRect(0, 0, W, H);

  // ---- Background rings ----
  [90, 60, 30, 0].forEach((el, i) => {
    const r = R * (1 - el/90);
    skyCtx.beginPath();
    skyCtx.arc(cx, cy, r, 0, 2*Math.PI);
    skyCtx.strokeStyle = i === 3 ? 'rgba(0,229,255,.4)' : 'rgba(255,255,255,.07)';
    skyCtx.lineWidth = i === 3 ? 1.5 : 1;
    skyCtx.stroke();
    if (i < 3) {
      skyCtx.fillStyle = 'rgba(100,150,180,.5)';
      skyCtx.font = '9px JetBrains Mono';
      skyCtx.fillText(el + '°', cx + 4, cy - r + 11);
    }
  });

  // ---- Cardinal labels ----
  const labels = [['N',0],['E',90],['S',180],['W',270]];
  labels.forEach(([l, az]) => {
    const rad = (az - 90) * Math.PI / 180;
    const lx = cx + (R + 12) * Math.cos(rad);
    const ly = cy + (R + 12) * Math.sin(rad);
    skyCtx.fillStyle = 'rgba(0,229,255,.7)';
    skyCtx.font = '10px JetBrains Mono';
    skyCtx.textAlign = 'center'; skyCtx.textBaseline = 'middle';
    skyCtx.fillText(l, lx, ly);
  });

  // ---- Satellites ----
  sats.forEach(sat => {
    const el  = sat.elevation;
    const az  = sat.azimuth;
    const rad = (az - 90) * Math.PI / 180;
    const r   = R * (1 - el / 90);
    const x   = cx + r * Math.cos(rad);
    const y   = cy + r * Math.sin(rad);
    const col = prnColor(sat.prn);

    // Body
    skyCtx.beginPath();
    skyCtx.arc(x, y, sat.used ? 7 : 5, 0, 2*Math.PI);
    skyCtx.fillStyle = col + (sat.snr < 15 ? '55' : 'cc');
    skyCtx.fill();
    if (sat.used) {
      skyCtx.strokeStyle = '#fff';
      skyCtx.lineWidth = 1.5;
      skyCtx.stroke();
    }

    // PRN tag — drawn in constellation colour for easy identification
    skyCtx.fillStyle = sat.snr < 15 ? 'rgba(255,255,255,0.4)' : '#fff';
    skyCtx.font = sat.used ? 'bold 8px JetBrains Mono' : '8px JetBrains Mono';
    skyCtx.textAlign = 'center'; skyCtx.textBaseline = 'middle';
    skyCtx.fillText(sat.prn, x, y);
  });
}

function updateSatList(sats) {
  const div = document.getElementById('sat-list');
  if (!sats.length) { div.innerHTML = '<div style="color:var(--muted);font-family:var(--mono);font-size:11px;">No satellites</div>'; return; }

  div.innerHTML = sats.slice().sort((a,b) => b.snr - a.snr || b.elevation - a.elevation).map(s => {
    const pct    = Math.min(s.snr / 55 * 100, 100);
    const cls    = s.snr > 35 ? 'snr-hi' : s.snr > 20 ? 'snr-mid' : s.snr > 0 ? 'snr-lo' : 'snr-none';
    const prefix = (s.prn || '').charAt(0).toUpperCase();
    const prnCls = ['G','R','E','C'].includes(prefix) ? `prn-${prefix}` : 'prn-G';
    return `<div class="sat-row">
      <span class="sat-prn ${prnCls}">${s.prn}</span>
      <div class="sat-bar"><div class="sat-bar-fill ${cls}" style="width:${pct}%"></div></div>
      <span class="sat-snr">${s.snr > 0 ? s.snr : '—'}</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--muted);width:26px;text-align:right;">${s.elevation}°</span>
      <div class="sat-used ${s.used?'active':''}"></div>
    </div>`;
  }).join('');
}

/* ----------------------------------------------------------------
   LIVE MARKER + TRAIL ON GLOBE
---------------------------------------------------------------- */
// ── EMA smoother for observer position ──────────────────────────────────────
// α=0.15 means each new fix contributes 15% of the update — filters out the
// 1–3m fix-to-fix noise from the Hiwonder module without adding visible lag.
const POS_ALPHA = 0.15;
let smoothLat = null, smoothLon = null, smoothAlt = null;

function smoothedPos(pos) {
  if (smoothLat === null) {
    // First fix — seed the filter
    smoothLat = pos.latitude;
    smoothLon = pos.longitude;
    smoothAlt = pos.altitude;
  } else {
    smoothLat = smoothLat + POS_ALPHA * (pos.latitude  - smoothLat);
    smoothLon = smoothLon + POS_ALPHA * (pos.longitude - smoothLon);
    smoothAlt = smoothAlt + POS_ALPHA * (pos.altitude  - smoothAlt);
  }
  return { latitude: smoothLat, longitude: smoothLon, altitude: smoothAlt };
}

function updateLiveMarker(pos) {
  if (!pos || pos.fixQuality === 0) return;
  const sp = smoothedPos(pos);

  // In heliocentric modes the observer sits on Earth's surface, but ECEF origin
  // is the Sun — so fromDegrees places the marker at the Sun. Instead, use
  // Earth's rendered heliocentric position as the marker location.
  let cart;
  if (activeFrameMode >= 3 && window._lastBodiesById?.earth) {
    const earthBody = window._lastBodiesById.earth;
    const earthCart = bodyToCart(earthBody);
    // Place the observer marker at Earth's heliocentric position
    // (the tiny lat/lon offset from Earth's centre is negligible at AU scale)
    cart = earthCart || Cesium.Cartesian3.fromDegrees(sp.longitude, sp.latitude, sp.altitude);
  } else {
    cart = Cesium.Cartesian3.fromDegrees(sp.longitude, sp.latitude, sp.altitude);
  }

  if (!liveMarker) {
    liveMarker = viewer.entities.add({
      id: 'live-observer',
      position: cart,
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString('#00e5ff'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.NONE,
        scaleByDistance: new Cesium.NearFarScalar(1e3, 1.5, 1e7, 0.5),
      },
      label: {
        text: '⊕ OBSERVER',
        font: '11px JetBrains Mono',
        fillColor: Cesium.Color.fromCssColorString('#00e5ff'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        heightReference: Cesium.HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      }
    });
  } else {
    liveMarker.position = new Cesium.ConstantPositionProperty(cart);
  }
  // Respect the GPS display toggle
  if (liveMarker) liveMarker.show = gpsDisplayEnabled;
}

function appendTrackPoint(pos) {
  trackPoints.push({ ...pos });
  updateTrailPolyline();
}

function updateTrailPolyline() {
  if (trackPoints.length < 2) return;
  const positions = trackPoints.map(tp =>
    Cesium.Cartesian3.fromDegrees(tp.longitude, tp.latitude, tp.altitude)
  );
  if (!trailEntity) {
    trailEntity = viewer.entities.add({
      id: 'gps-trail',
      polyline: {
        positions: new Cesium.ConstantProperty(positions),
        width: 2.5,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.8),
        }),
        clampToGround: false,
        arcType: Cesium.ArcType.NONE,
      }
    });
  } else {
    trailEntity.polyline.positions = new Cesium.ConstantProperty(positions);
  }
}

/* ----------------------------------------------------------------
   TRACK TAB
---------------------------------------------------------------- */
function updateTrackTab(pts) {
  set('track-pts', pts.length);
  let dist = 0;
  for (let i = 1; i < pts.length; i++) {
    dist += haversine(pts[i-1].latitude, pts[i-1].longitude, pts[i].latitude, pts[i].longitude);
  }
  set('track-dist', dist > 1000 ? (dist/1000).toFixed(2) + ' km' : dist.toFixed(0) + ' m');

  if (pts.length > 1) {
    const dur = pts[pts.length-1].epochMillis - pts[0].epochMillis;
    set('track-dur', formatDuration(dur));
  }

  const scrubber = document.getElementById('play-scrubber');
  scrubber.max = Math.max(1, pts.length - 1);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDuration(ms) {
  const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60);
  return h > 0 ? `${h}h ${m%60}m` : `${m}m ${s%60}s`;
}

/* ---- Playback controls ---- */
document.getElementById('btn-record').addEventListener('click', () => {
  recording = !recording;
  const btn = document.getElementById('btn-record');
  btn.classList.toggle('active', recording);
  if (recording) trackPoints = [];
});

document.getElementById('btn-play').addEventListener('click', () => {
  if (!trackPoints.length) return;
  playbackActive = true;
  playbackIdx = 0;
  document.getElementById('btn-pause').disabled = false;
  document.getElementById('btn-play').classList.add('active');
  runPlayback();
});

document.getElementById('btn-pause').addEventListener('click', () => {
  if (playbackTimer) { clearInterval(playbackTimer); playbackTimer = null; }
  playbackActive = false;
  document.getElementById('btn-play').classList.remove('active');
});

document.getElementById('btn-stop').addEventListener('click', () => {
  if (playbackTimer) clearInterval(playbackTimer);
  playbackActive = false; playbackIdx = 0;
  document.getElementById('play-scrubber').value = 0;
  document.getElementById('btn-pause').disabled = true;
  document.getElementById('btn-play').classList.remove('active');
});

document.getElementById('play-scrubber').addEventListener('input', e => {
  playbackIdx = parseInt(e.target.value);
  if (trackPoints[playbackIdx]) seekTo(playbackIdx);
});

document.getElementById('btn-export').addEventListener('click', async () => {
  const r = await fetch(`${API}/api/gps/track?format=czml`);
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'gps-track.czml'; a.click();
});

function runPlayback() {
  if (playbackTimer) clearInterval(playbackTimer);
  playbackTimer = setInterval(() => {
    if (playbackIdx >= trackPoints.length - 1) {
      clearInterval(playbackTimer); playbackActive = false; return;
    }
    seekTo(playbackIdx++);
    document.getElementById('play-scrubber').value = playbackIdx;
  }, 200);
}

function seekTo(idx) {
  const tp = trackPoints[idx];
  if (!tp) return;
  const cart = Cesium.Cartesian3.fromDegrees(tp.longitude, tp.latitude, tp.altitude);
  if (liveMarker) liveMarker.position = new Cesium.ConstantPositionProperty(cart);
  set('track-pb-time', tp.utcTime ? tp.utcTime.substring(11,19) : '--');
}

/* ----------------------------------------------------------------
   FRAME INSPECTOR TAB
---------------------------------------------------------------- */
function updateFrameTab(fi) {
  set('fi-lat',   fi.latDeg.toFixed(7) + '°');
  set('fi-lon',   fi.lonDeg.toFixed(7) + '°');
  set('fi-alt',   fi.altM.toFixed(3) + ' m');
  set('fi-ex',    fmtSci(fi.ecefX) + ' m');
  set('fi-ey',    fmtSci(fi.ecefY) + ' m');
  set('fi-ez',    fmtSci(fi.ecefZ) + ' m');
  set('fi-range', fi.rangeFromEarthCenterKm.toFixed(3) + ' km');
  set('fi-ix',    fmtSci(fi.eciX) + ' m');
  set('fi-iy',    fmtSci(fi.eciY) + ' m');
  set('fi-iz',    fmtSci(fi.eciZ) + ' m');
  set('fi-epoch', fi.epoch);
}

function fmtSci(v) {
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/* ----------------------------------------------------------------
   GPS 3D CONSTELLATION
   Labels and colours come from the live Sky-tab satellite data
   (latestSatsMap). GPS sats are positioned via Keplerian math;
   GLONASS/Galileo/BeiDou are projected from their NMEA
   elevation+azimuth onto a sphere at their constellation altitude.
---------------------------------------------------------------- */

// Approximate orbital altitudes (m above Earth surface)
const CONS_ALT = {
  GPS:     20_200_000,
  GLONASS: 19_100_000,
  GALILEO: 23_222_000,
  BEIDOU:  21_528_000,
  QZSS:    35_786_000,  // GEO/QZO ~42,164 km from centre → ~35,786 km altitude
  IRNSS:   35_786_000,  // GEO/GSO
  SBAS:    35_786_000,  // GEO
};
const EARTH_R  = 6_371_000;

/**
 * Given an observer geodetic position and a satellite's elevation (deg)
 * and azimuth (deg), return an ECEF Cartesian3 at the constellation altitude.
 * Uses a simple spherical Earth model — good enough for a visualisation.
 */
function skyElAzToCart(obsLat, obsLon, elevDeg, azimDeg, orbAltM) {
  const satRange = orbAltM + EARTH_R;          // distance from Earth centre
  const elR  = elevDeg  * Math.PI / 180;
  const azR  = azimDeg  * Math.PI / 180;

  // Topocentric ENZ unit vector
  const e = Math.cos(elR) * Math.sin(azR);
  const n = Math.cos(elR) * Math.cos(azR);
  const u = Math.sin(elR);

  // Observer ECEF unit normal
  const latR = obsLat * Math.PI / 180;
  const lonR = obsLon * Math.PI / 180;
  const obsR = EARTH_R;                        // observer on surface

  // ENZ → ECEF rotation
  const ux =  -Math.sin(lonR)*e - Math.sin(latR)*Math.cos(lonR)*n + Math.cos(latR)*Math.cos(lonR)*u;
  const uy =   Math.cos(lonR)*e - Math.sin(latR)*Math.sin(lonR)*n + Math.cos(latR)*Math.sin(lonR)*u;
  const uz =   Math.cos(latR)*n + Math.sin(latR)*u;

  // Step along the line of sight until we reach the orbital shell
  // Solve: |obsEcef + λ*(ux,uy,uz)|² = satRange²
  const ox = obsR * Math.cos(latR) * Math.cos(lonR);
  const oy = obsR * Math.cos(latR) * Math.sin(lonR);
  const oz = obsR * Math.sin(latR);

  const b = 2 * (ox*ux + oy*uy + oz*uz);
  const c2 = ox*ox + oy*oy + oz*oz - satRange*satRange;
  const disc = b*b - 4*c2;                     // a=1 (unit vector)
  if (disc < 0) return null;
  const lambda = (-b + Math.sqrt(disc)) / 2;   // positive root (far intersection)

  return new Cesium.Cartesian3(ox + lambda*ux, oy + lambda*uy, oz + lambda*uz);
}

function update3DConstellation(epochMs) {
  // Clear all entities when GPS display is disabled
  if (!gpsDisplayEnabled) {
    gpsSatEntities.forEach(e => viewer.entities.remove(e));
    orbitEntities.forEach(e  => viewer.entities.remove(e));
    linkEntities.forEach(e   => viewer.entities.remove(e));
    if (coneEntity) { viewer.entities.remove(coneEntity); coneEntity = null; }
    gpsSatEntities = []; orbitEntities = []; linkEntities = [];
    return;
  }

  const showOrbits = document.getElementById('opt-orbits').checked;
  const showLabels = document.getElementById('opt-labels').checked;
  const showCone   = document.getElementById('opt-cone').checked;
  const showLinks  = document.getElementById('opt-links').checked;

  const J2000_MS = 946728000000;
  const t = (epochMs - J2000_MS) / 1000;

  // Clear old entities
  gpsSatEntities.forEach(e => viewer.entities.remove(e));
  orbitEntities.forEach(e  => viewer.entities.remove(e));
  linkEntities.forEach(e   => viewer.entities.remove(e));
  if (coneEntity) { viewer.entities.remove(coneEntity); coneEntity = null; }
  gpsSatEntities = []; orbitEntities = []; linkEntities = [];

  // Use smoothed position for all geometry (link lines, cone, elevation calc)
  // so 1-3m GPS noise doesn't cause lines to visibly sweep each tick.
  const rawPos = latestPos;
  const obsPos = (rawPos && smoothLat !== null)
    ? { latitude: smoothLat, longitude: smoothLon, altitude: smoothAlt,
        fixQuality: rawPos.fixQuality }
    : rawPos;
  const obsCart = obsPos
    ? Cesium.Cartesian3.fromDegrees(obsPos.longitude, obsPos.latitude, obsPos.altitude)
    : null;

  let gps3dList = '';

  /* ── Helper: add one satellite entity ─────────────────────────────────── */
  function addSatEntity(cart, skyInfo, prnLabel, consName, elDeg, visible) {
    // Colour driven by PRN prefix — same single source of truth as sky plot / sat list
    const consHex  = prnColor(skyInfo ? skyInfo.prn : prnLabel);

    // Colour: use Sky-tab constellation colour; dim if not in view / low SNR
    let fillCol;
    if (skyInfo) {
      const snrNorm = Math.min(Math.max(skyInfo.snr / 50, 0.2), 1.0);
      fillCol = Cesium.Color.fromCssColorString(consHex).withAlpha(
        skyInfo.used ? 1.0 : snrNorm * 0.7
      );
    } else {
      fillCol = Cesium.Color.fromCssColorString(consHex).withAlpha(visible ? 0.85 : 0.35);
    }

    const isUsed   = skyInfo ? skyInfo.used : visible;
    const ptSize   = isUsed ? 10 : (visible ? 7 : 5);
    const outAlpha = isUsed ? 0.9 : (visible ? 0.5 : 0.2);

    // Label text: PRN tag exactly as shown in Sky tab (e.g. "G05", "R12", "E07", "C03")
    const labelText = skyInfo ? skyInfo.prn : prnLabel;

    // SNR bar suffix shown in the side-panel list
    const snrStr = skyInfo ? ` ${skyInfo.snr}dB` : '';
    const usedMark = isUsed ? ' ✓' : '';

    const satE = viewer.entities.add({
      position: cart,
      point: {
        pixelSize: ptSize,
        color: fillCol,
        outlineColor: Cesium.Color.WHITE.withAlpha(outAlpha),
        outlineWidth: isUsed ? 2 : 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1e6, 1.5, 1e8, 0.4),
      },
      label: showLabels ? {
        text: labelText,
        font: isUsed ? 'bold 10px JetBrains Mono' : '9px JetBrains Mono',
        fillColor: Cesium.Color.fromCssColorString(consHex),   // always fully opaque text
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -10),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        // No distanceDisplayCondition — GPS orbits at 20 Mm, camera often at 30–80 Mm
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#0d1a26').withAlpha(isUsed ? 0.85 : 0.55),
        backgroundPadding: new Cesium.Cartesian2(5, 3),
        scaleByDistance: new Cesium.NearFarScalar(1e6, 1.2, 1e8, 0.6),
      } : undefined,
    });
    gpsSatEntities.push(satE);

    // Observer → sat link
    if (showLinks && visible && obsCart) {
      const link = viewer.entities.add({
        polyline: {
          positions: [obsCart, cart],
          width: isUsed ? 1.5 : 0.8,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString(consHex).withAlpha(isUsed ? 0.5 : 0.2),
            dashLength: 8,
          }),
          arcType: Cesium.ArcType.NONE,
          depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString(consHex).withAlpha(isUsed ? 0.18 : 0.07),
            dashLength: 8,
          }),
        }
      });
      linkEntities.push(link);
    }

    gps3dList += `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid var(--border);">
      <span style="color:${consHex};font-weight:${isUsed?'bold':'normal'};width:36px">${labelText}</span>
      <span>${elDeg.toFixed(1)}°</span>
      <span style="color:${isUsed?'#39ff14':'var(--muted)'}">${isUsed?'✓ USE':visible?'▲ VIS':'—'}${snrStr}</span>
    </div>`;
  }

  /* ── Pass 1: GPS sats via Keplerian orbits ─────────────────────────────── */
  GPS_SATS.forEach(sat => {
    const eci  = gpsSatEci(sat, t);
    const ecef = eciToEcef(eci, epochMs);
    const cart = ecefToC3(ecef);

    // Elevation from observer
    let visible = false, elDeg = 0;
    if (obsPos) {
      const obsEcef = geodeticToEcef(obsPos.latitude, obsPos.longitude, obsPos.altitude);
      const dx = ecef.x - obsEcef.x, dy = ecef.y - obsEcef.y, dz = ecef.z - obsEcef.z;
      const latR = obsPos.latitude * Math.PI / 180, lonR = obsPos.longitude * Math.PI / 180;
      const ux = Math.cos(latR)*Math.cos(lonR), uy = Math.cos(latR)*Math.sin(lonR), uz = Math.sin(latR);
      const range = Math.sqrt(dx*dx+dy*dy+dz*dz);
      elDeg = Math.asin((dx*ux + dy*uy + dz*uz) / range) * 180 / Math.PI;
      visible = elDeg > 5;
    }

    // Look up in Sky tab by GPS PRN tag format "G01" … "G32"
    const skyPrn  = `G${String(sat.prn).padStart(2,'0')}`;
    const skyInfo = latestSatsMap[skyPrn];

    addSatEntity(cart, skyInfo, skyPrn, 'GPS', elDeg, visible);
  });

  /* ── Pass 2: non-GPS constellations from live NMEA ─────────────────────── */
  const passPos = obsPos || { latitude: 19.1334, longitude: 72.9133, altitude: 14.0 };
  const nonGps  = latestSats.filter(s => (s.prn || '').charAt(0) !== 'G');
  if (nonGps.length === 0 && latestSats.length > 0) {
    // All received sats are GPS — module may not support Galileo/BeiDou or
    // sentences haven't arrived yet. Check browser console for details.
    console.debug('[GNSS 3D] No non-GPS sats in latestSats. Total sats:', latestSats.length,
      '| PRNs:', latestSats.map(s => s.prn).join(' '));
  }
  nonGps.forEach(s => {
    const el  = Math.max(s.elevation, 1);
    const az  = s.azimuth || 0;
    const altM = CONS_ALT[s.constellation] || CONS_ALT.GPS;
    const cart = skyElAzToCart(passPos.latitude, passPos.longitude, el, az, altM);
    if (!cart) {
      console.debug('[GNSS 3D] skyElAzToCart returned null for', s.prn, 'el:', el, 'az:', az);
      return;
    }
    const visible = s.elevation > 5;
    addSatEntity(cart, s, s.prn, s.constellation, s.elevation, visible);
  });

  /* ── Orbit paths ───────────────────────────────────────────────────────── */
  if (showOrbits) {
    for (let p = 0; p < GPS_PLANES; p++) {
      const orbitPts = [];
      for (let a = 0; a <= 360; a += 4) {
        const satA = { plane:p, slot:0, prn:1, raan: p*60*Math.PI/180, m0: a*Math.PI/180 };
        orbitPts.push(ecefToC3(eciToEcef(gpsSatEci(satA, t), epochMs)));
      }
      orbitEntities.push(viewer.entities.add({
        polyline: {
          positions: orbitPts, width: 1,
          material: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.15),
          arcType: Cesium.ArcType.NONE,
        }
      }));
    }
  }

  /* ── Visibility cone ───────────────────────────────────────────────────── */
  if (showCone && obsCart && obsPos) {
    const obsR      = EARTH_R + obsPos.altitude;
    const maskAngle = Math.acos(EARTH_R / obsR);
    const coneR     = Math.tan(Math.PI/2 - maskAngle) * GPS_A;
    const normal    = Cesium.Cartesian3.normalize(obsCart, new Cesium.Cartesian3());
    const topPoint  = Cesium.Cartesian3.add(
      obsCart,
      Cesium.Cartesian3.multiplyByScalar(normal, GPS_A, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    coneEntity = viewer.entities.add({
      position: topPoint,
      ellipsoid: {
        radii: new Cesium.Cartesian3(coneR*0.6, coneR*0.6, coneR*0.2),
        material: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.04),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.25),
        outlineWidth: 1, slicePartitions: 24, stackPartitions: 12,
      }
    });
  }

  document.getElementById('gps3d-list').innerHTML =
    gps3dList || '<div style="color:var(--muted);font-size:11px;padding:4px 0">No satellites computed</div>';
}

/* ----------------------------------------------------------------
   ECEF helper (JS mirror of Java service for 3D panel)
---------------------------------------------------------------- */
function geodeticToEcef(latDeg, lonDeg, altM) {
  const A = 6378137, F = 1/298.257223563, E2 = 2*F - F*F;
  const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180;
  const N = A / Math.sqrt(1 - E2 * Math.sin(lat)**2);
  return {
    x: (N + altM) * Math.cos(lat) * Math.cos(lon),
    y: (N + altM) * Math.cos(lat) * Math.sin(lon),
    z: (N * (1 - E2) + altM) * Math.sin(lat)
  };
}

/* ----------------------------------------------------------------
   TAB SWITCHING
---------------------------------------------------------------- */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'sky' && latestSats.length) updateSkyTab(latestSats);
  });
});

/* ----------------------------------------------------------------
   CHECKBOX listeners for 3D options
---------------------------------------------------------------- */
['opt-orbits','opt-labels','opt-cone','opt-links'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    update3DConstellation(Date.now());
  });
});

/* ----------------------------------------------------------------
   RENDER LOOP – update 3D constellation every second
---------------------------------------------------------------- */
let lastConstellationUpdate = 0;
viewer.scene.postRender.addEventListener(() => {
  if (activeFrameMode >= 3 || currentScaleValue > 25) return; // no artificial satellites beyond GNSS scale
  const now = Date.now();
  if (now - lastConstellationUpdate > 1000) {
    lastConstellationUpdate = now;
    update3DConstellation(now);
  }
});

/* ----------------------------------------------------------------
   STATUS BANNER
---------------------------------------------------------------- */
async function checkStatus() {
  try {
    const r = await fetch(`${API}/api/status`);
    const s = await r.json();
    const badge = document.getElementById('source-badge');
    badge.textContent = s.simulating ? '◉ SIMULATED' : '● LIVE GPS';
    badge.className = 'source-badge' + (s.simulating ? ' sim' : '');
  } catch(_) {}
}

/* ----------------------------------------------------------------
   UTILITY
---------------------------------------------------------------- */
function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* ----------------------------------------------------------------
   BOOT
---------------------------------------------------------------- */
// Start GPS data pipeline (viewer already initialised above)
checkStatus();
setInterval(checkStatus, 10000);

// ── Right panel show/hide ─────────────────────────────────────────────────
let panelVisible = true;
function toggleRightPanel() {
  panelVisible = !panelVisible;
  rightPanelVisible = panelVisible;
  const panel  = document.getElementById('right-panel');
  const toggle = document.getElementById('panel-toggle');
  panel.classList.toggle('collapsed', !panelVisible);
  toggle.classList.toggle('collapsed', !panelVisible);
  toggle.textContent = panelVisible ? 'PANEL' : '◧';
  syncGlobeBounds();
}

// ── Active frame coordinate display ──────────────────────────────────────────
// Updates the FRAMES tab with the observer's position in the currently
// selected coordinate frame — switches between WGS-84, ECI, ecliptic,
// and heliocentric automatically as the user changes frame modes.
function updateActiveFrameCoords(snap) {
  const lbl  = document.getElementById('active-frame-label');
  const meta = FRAME_META[activeFrameMode];
  if (!lbl || !meta) return;

  const accent = meta.accent;
  ['af-v1','af-v2','af-v3','af-v4','af-v5','af-v6'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.color = accent;
  });

  function set6(label, k1, v1, k2, v2, k3, v3, k4, v4, k5, v5, k6, v6) {
    // Update FRAMES tab section
    lbl.textContent  = '■ ACTIVE FRAME: ' + label;
    lbl.style.color  = accent;
    const ids = ['af-k1','af-v1','af-k2','af-v2','af-k3','af-v3','af-k4','af-v4','af-k5','af-v5','af-k6','af-v6'];
    const vals = [k1,v1,k2,v2,k3,v3,k4,v4,k5,v5,k6,v6];
    ids.forEach((id,i) => { const el=document.getElementById(id); if(el) el.textContent=vals[i]??'--'; });

    // Mirror to left-panel FRAME tab
    updateLeftFrameTab(label, accent, k1,v1,k2,v2,k3,v3,k4,v4);

    // Update VIEWPOINT card in Position tab — 4 most relevant fields per mode
    const badge = document.getElementById('vp-frame-badge');
    if (badge) { badge.textContent = label; badge.style.color = accent; }
    // Map: [k1,v1,k2,v2] → first 4 key-value pairs (skip k3,v3 and beyond
    // which are GPS-specific like HDOP/altitude not relevant to viewpoint)
    const vpPairs = [[k1,v1],[k2,v2],[k3,v3],[k4,v4]];
    vpPairs.forEach(([k,v], i) => {
      const ki = document.getElementById('vp-k'+(i+1));
      const vi = document.getElementById('vp-v'+(i+1));
      if (ki) ki.textContent = k ?? '';
      if (vi) { vi.textContent = v ?? '--'; vi.style.color = accent; }
    });
  }

  const fi = snap?.frameInspector;
  const fc = snap?.frameContext;
  const pos = snap?.position;

  if (activeFrameMode === 0) {
    // GNSS mode — show WGS-84 from live GPS fix
    set6('GNSS / WGS-84',
      'φ Latitude',  pos ? pos.latitude.toFixed(7)+'°'  : '--',
      'λ Longitude', pos ? pos.longitude.toFixed(7)+'°' : '--',
      'LST',         fc  ? fc.lstDeg?.toFixed(4)+'°'    : '--',
      'GMST',        fc  ? fc.gmstDeg?.toFixed(4)+'°'   : '--',
      'Sats used',   pos ? pos.satellitesUsed             : '--',
      'Fix quality', pos ? ['None','GPS','DGPS'][pos.fixQuality]||pos.fixQuality : '--'
    );
  } else if (activeFrameMode === 1) {
    // GEO·EQ — observer in ECI J2000
    set6('GEO · EQ  (ECI / EME2000)',
      'X (ECI)',  fi ? fmtSci(fi.eciX)+' m' : '--',
      'Y (ECI)',  fi ? fmtSci(fi.eciY)+' m' : '--',
      'Z (ECI)',  fi ? fmtSci(fi.eciZ)+' m' : '--',
      'GMST',     fc ? fc.gmstDeg?.toFixed(4)+'°' : '--',
      'LST',      fc ? fc.lstDeg?.toFixed(4)+'°'  : '--',
      '|r|',      fi ? fi.rangeFromEarthCenterKm?.toFixed(3)+' km' : '--'
    );
  } else if (activeFrameMode === 2) {
    // GEO·ECL — observer in geocentric ecliptic
    set6('GEO · ECL  (Geocentric Ecliptic)',
      'X (ECEF)', fi ? fmtSci(fi.ecefX)+' m' : '--',
      'Y (ECEF)', fi ? fmtSci(fi.ecefY)+' m' : '--',
      'Z (ECEF)', fi ? fmtSci(fi.ecefZ)+' m' : '--',
      'Obliquity ε', fc ? fc.obliquityDeg?.toFixed(4)+'°' : '--',
      'Sun λ',    fc ? fc.sunEclLonDeg?.toFixed(4)+'°'  : '--',
      'Season',   fc ? fc.season : '--'
    );
  } else if (activeFrameMode === 3) {
    // HELIO·EQ — observer (on Earth) in heliocentric equatorial
    set6('HELIO · EQ  (Heliocentric Equatorial)',
      'Earth λ (RA)', fc ? fc.earthHelioLonDeg?.toFixed(4)+'°' : '--',
      'Earth β (Dec)',fc ? fc.earthHelioLatDeg?.toFixed(4)+'°' : '--',
      'Earth dist',   fc ? fc.earthDistAu?.toFixed(6)+' AU'    : '--',
      'Earth vel',    fc ? fc.earthVelKms?.toFixed(3)+' km/s'  : '--',
      'GMST',         fc ? fc.gmstDeg?.toFixed(4)+'°'          : '--',
      '1 AU',         '1.496 × 10¹¹ m'
    );
  } else if (activeFrameMode === 4) {
    // HELIO·ECL — observer (on Earth) in heliocentric ecliptic
    set6('HELIO · ECL  (Heliocentric Ecliptic)',
      'Earth λ',    fc ? fc.earthHelioLonDeg?.toFixed(4)+'°' : '--',
      'Earth β',    fc ? fc.earthHelioLatDeg?.toFixed(4)+'°' : '--',
      'Earth dist', fc ? fc.earthDistAu?.toFixed(6)+' AU'    : '--',
      'Earth vel',  fc ? fc.earthVelKms?.toFixed(3)+' km/s'  : '--',
      'Obliquity',  fc ? fc.obliquityDeg?.toFixed(4)+'°'     : '--',
      'Season',     fc ? fc.season : '--'
    );
  }
}

// ── Recentre view — brings Earth or Sun back to viewport centre ───────────
function recentreView() {
  if (activeFrameMode === 0 || activeFrameMode <= 2) {
    // Geocentric modes: fly to observer position above Earth at 10,000 km
    const obs = window._latestObserver;
    const lon = obs?.lonDeg ?? 72.9133;
    const lat = obs?.latDeg ?? 19.1334;
    const target = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(target, 10_000_000),
      {
        duration: 1.8,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), 0),
        complete: () => viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
      }
    );
  } else {
    // Heliocentric modes: use lookAtTransform to snap Sun to centre
    const offset = MODE_CAMERA_OFFSET[activeFrameMode] ||
                   new Cesium.Cartesian3(0, 0, 8.5e8);
    viewer.camera.flyTo({
      destination: new Cesium.Cartesian3(
        offset.x * 0.6, offset.y * 0.6, offset.z * 0.6),
      duration: 1.5,
      complete: () => viewer.camera.lookAtTransform(
        Cesium.Matrix4.IDENTITY, offset)
    });
  }
}

// ══ LEFT panel ═══════════════════════════════════════════════════════════
let leftPanelVisible  = true;
let rightPanelVisible = true;


// ── Sync globe/topbar bounds whenever either panel is toggled ────────────
function syncGlobeBounds() {
  const lw = leftPanelVisible  ? 320 : 0;
  const rw = rightPanelVisible ? 320 : 0;
  const els = ['cesiumContainer', 'topbar'];
  els.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.left  = lw + 'px';
    el.style.right = rw + 'px';
  });
  // Recentre scale bar in globe area
  const sb = document.getElementById('scale-bar');
  if (sb) sb.style.left = `calc(${lw}px + (100vw - ${lw + rw}px) / 2)`;
  // Recentre left panel toggle button
  const lt = document.getElementById('left-panel-toggle');
  if (lt) lt.style.left = lw + 'px';
}
function toggleLeftPanel() {
  leftPanelVisible = !leftPanelVisible;
  const panel  = document.getElementById('left-panel');
  const toggle = document.getElementById('left-panel-toggle');
  panel.classList.toggle('collapsed', !leftPanelVisible);
  toggle.classList.toggle('collapsed', !leftPanelVisible);
  syncGlobeBounds();
}

function lpTab(name) {
  document.querySelectorAll('.lp-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.lp-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('lpt-' + name)?.classList.add('active');
  document.getElementById('lp-' + name)?.classList.add('active');
}

// Mirror set6() data to left-panel FRAME tab
const _origSet6Keys = ['lp-af-k1','lp-af-v1','lp-af-k2','lp-af-v2','lp-af-k3','lp-af-v3','lp-af-k4','lp-af-v4'];

function updateLeftFrameTab(label, accent, k1,v1,k2,v2,k3,v3,k4,v4) {
  const lbl = document.getElementById('active-frame-label-lp');
  if (lbl) { lbl.textContent = label; lbl.style.color = accent; }
  const vals = [k1,v1,k2,v2,k3,v3,k4,v4];
  _origSet6Keys.forEach((id,i) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = vals[i] ?? '--';
      if (id.startsWith('lp-af-v')) el.style.color = accent;
    }
  });
}

function addSatFromInput() {
  const id = parseInt(document.getElementById('norad-input').value);
  if (!isNaN(id) && id > 0) {
    fetch(`/api/sat/add?noradId=${id}`, {method:'POST'}).catch(console.warn);
    document.getElementById('norad-input').value = '';
  }
}

connectSSE();

// Initial camera set by setInitialCamera() below

/* ================================================================
   SATELLITE TRACKING  (generalised — any NORAD ID)
   snap.trackedSats = List<SatelliteState> propagated by Orekit
================================================================ */

// Per-NORAD entity registry
const satRegistry = {};  // noradId → { entity, trackEntities, footEntity, footOutline }

function handleTrackedSats(sats) {
  if (!sats || !sats.length) return;
  window._lastTrackedSats = sats;

  // Keep the globe selector in sync with all currently tracked satellites
  const sel = document.getElementById('sat-selector');
  if (sel) {
    const currentVal = sel.value;
    sel.innerHTML = sats.map(s =>
      `<option value="${s.noradId}">🛰 ${s.name || 'NORAD '+s.noradId}</option>`
    ).join('');
    // Restore previously selected value if it still exists
    if ([...sel.options].some(o => o.value === currentVal)) sel.value = currentVal;
    // Update globe button label to match selection
    syncFlyBtnLabel();
  }

  sats.forEach(s => {
    updateSatPanel(s);
    updateSatGlobe(s);
  });
}

function syncFlyBtnLabel() {
  const sel = document.getElementById('sat-selector');
  const btn = document.getElementById('btn-issfly');
  if (!sel || !btn) return;
  const opt = sel.options[sel.selectedIndex];
  const name = opt ? opt.text.replace('🛰 ', '').split(' ')[0] : 'ISS';
  btn.textContent = issChaseActive ? `✕ EXIT ${name}` : `🛰 FLY WITH ${name}`;
}

// Update button label when selector changes
document.getElementById('sat-selector')?.addEventListener('change', syncFlyBtnLabel);

// ── Panel rendering ────────────────────────────────────────────────────────

function updateSatPanel(s) {
  const container = document.getElementById('sat-cards-container');
  const cardId    = `sat-card-${s.noradId}`;
  let card = document.getElementById(cardId);
  const col = s.color || '#00e5ff';

  if (!card) {
    card = document.createElement('div');
    card.id        = cardId;
    card.className = 'card';
    card.innerHTML = buildSatCardHtml(s, col);
    container.appendChild(card);
  } else {
    // Update live fields only
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set(`sat-lat-${s.noradId}`,  s.latitudeDeg   != null ? s.latitudeDeg.toFixed(4)  + '°' : '--');
    set(`sat-lon-${s.noradId}`,  s.longitudeDeg  != null ? s.longitudeDeg.toFixed(4) + '°' : '--');
    set(`sat-alt-${s.noradId}`,  s.altitudeKm    != null ? s.altitudeKm.toFixed(1)   + ' km' : '--');
    set(`sat-vel-${s.noradId}`,  s.velocityKms   != null ? s.velocityKms.toFixed(3)  + ' km/s' : '--');
    set(`sat-inc-${s.noradId}`,  s.inclinationDeg!= null ? s.inclinationDeg.toFixed(2) + '°' : '--');
    set(`sat-per-${s.noradId}`,  s.periodMin     != null ? s.periodMin.toFixed(2)    + ' min' : '--');
    set(`sat-age-${s.noradId}`,  s.ommAge ? 'OMM: ' + s.ommAge : '');
    // Pass list
    const passDiv = document.getElementById(`sat-passes-${s.noradId}`);
    if (passDiv && s.nextPasses) passDiv.innerHTML = buildPassHtml(s.nextPasses);
    // TLE lines
    const tleDiv = document.getElementById(`sat-tle-${s.noradId}`);
    if (tleDiv && s.ommJson) tleDiv.innerHTML = formatOmmJson(s.ommJson, col);
  }
}

function buildSatCardHtml(s, col) {
  const name = s.name || `NORAD ${s.noradId}`;
  return `
  <div style="border-left:3px solid ${col};padding-left:8px;margin-bottom:8px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-family:var(--mono);font-size:11px;font-weight:700;color:${col};">🛰 ${name}</span>
      <button onclick="satRemove(${s.noradId})" title="Stop tracking"
        style="font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--border);
               color:var(--muted);padding:2px 6px;border-radius:2px;cursor:pointer;">✕</button>
    </div>
    <div style="font-family:var(--mono);font-size:9px;color:var(--muted);display:flex;justify-content:space-between;margin-bottom:6px;">
      <span>NORAD ${s.noradId}</span>
      <span id="sat-age-${s.noradId}">${s.ommAge ? 'OMM: '+s.ommAge : ''}</span>
    </div>
  </div>
  <div class="kv" style="margin-bottom:8px;">
    <div class="kv-item"><span class="kv-label">Latitude</span><span id="sat-lat-${s.noradId}" style="color:${col}">${s.latitudeDeg != null ? s.latitudeDeg.toFixed(4)+'°' : '--'}</span></div>
    <div class="kv-item"><span class="kv-label">Longitude</span><span id="sat-lon-${s.noradId}" style="color:${col}">${s.longitudeDeg != null ? s.longitudeDeg.toFixed(4)+'°' : '--'}</span></div>
    <div class="kv-item"><span class="kv-label">Altitude</span><span id="sat-alt-${s.noradId}">${s.altitudeKm != null ? s.altitudeKm.toFixed(1)+' km' : '--'}</span></div>
    <div class="kv-item"><span class="kv-label">Velocity</span><span id="sat-vel-${s.noradId}">${s.velocityKms != null ? s.velocityKms.toFixed(3)+' km/s' : '--'}</span></div>
    <div class="kv-item"><span class="kv-label">Inclination</span><span id="sat-inc-${s.noradId}">${s.inclinationDeg != null ? s.inclinationDeg.toFixed(2)+'°' : '--'}</span></div>
    <div class="kv-item"><span class="kv-label">Period</span><span id="sat-per-${s.noradId}">${s.periodMin != null ? s.periodMin.toFixed(2)+' min' : '--'}</span></div>
  </div>
  <div style="font-family:var(--mono);font-size:10px;font-weight:700;color:var(--muted);letter-spacing:1px;margin-bottom:4px;">NEXT PASS</div>
  <div id="sat-passes-${s.noradId}" style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-bottom:8px;">
    ${s.nextPasses ? buildPassHtml(s.nextPasses) : 'Waiting for GPS fix…'}
  </div>
  <div style="font-family:var(--mono);font-size:9px;font-weight:700;color:var(--muted);letter-spacing:1px;margin-bottom:4px;">OMM DATA</div>
  <div id="sat-tle-${s.noradId}" style="font-family:var(--mono);font-size:8px;color:var(--muted);line-height:1.7;max-height:120px;overflow-y:auto;">
    ${s.ommJson ? formatOmmJson(s.ommJson, col) : 'Loading…'}
  </div>
  <div style="display:flex;gap:6px;margin-top:8px;">
    <button onclick="satFlyWith(${s.noradId})"
      style="font-family:var(--mono);font-size:9px;background:transparent;border:1px solid ${col};
             color:${col};padding:4px 8px;border-radius:3px;cursor:pointer;letter-spacing:1px;">
      🛰 FLY WITH</button>
    <button onclick="satRefresh(${s.noradId})"
      style="font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--border);
             color:var(--muted);padding:4px 8px;border-radius:3px;cursor:pointer;letter-spacing:1px;">
      ↻ REFRESH OMM</button>
  </div>`;
}

function buildPassHtml(passes) {
  if (!passes || !passes.length) return '<span style="color:var(--muted)">No passes in next 24 h</span>';
  return passes.slice(0, 3).map((p, i) => {
    const rise = p.riseTime ? new Date(p.riseTime).toLocaleTimeString() : '--';
    const date = p.riseTime ? new Date(p.riseTime).toLocaleDateString() : '';
    const col  = p.maxElevationDeg > 45 ? '#39ff14' : p.maxElevationDeg > 20 ? '#ff6b35' : 'var(--muted)';
    return `<div style="margin-bottom:6px;${i>0?'border-top:1px solid var(--border);padding-top:6px':''}">
      <div style="display:flex;justify-content:space-between;">
        <span>Pass ${i+1} · ${date} ${rise}</span>
        <span style="color:${col};font-weight:700;">${p.maxElevationDeg.toFixed(1)}°</span>
      </div>
      <div style="color:var(--muted);font-size:9px;">↑${p.riseAzDeg!=null?p.riseAzDeg.toFixed(0)+'°':'--'} · ↓${p.setAzDeg!=null?p.setAzDeg.toFixed(0)+'°':'--'} · ${p.durationStr||'--'}</div>
    </div>`;
  }).join('');
}

// ── Globe rendering ────────────────────────────────────────────────────────

function updateSatGlobe(s) {
  const col  = s.color || '#00e5ff';
  const cart = Cesium.Cartesian3.fromDegrees(s.longitudeDeg, s.latitudeDeg, s.altitudeKm * 1000);
  const cCol = Cesium.Color.fromCssColorString(col);
  let reg = satRegistry[s.noradId];

  // ── Satellite entity ───────────────────────────────────────────────────
  if (!reg) {
    // CallbackProperty always returns the latest Cartesian3 on every render frame —
    // no time-domain interpolation, so trackedEntity centres the satellite correctly
    // regardless of GPS UTC vs wall-clock divergence (leap seconds, NTP skew).
    const posHolder = { cart };
    const posProp   = new Cesium.CallbackProperty(() => posHolder.cart, false);

    const entity = viewer.entities.add({
      id: `sat-${s.noradId}`,
      position: posProp,
      point: {
        pixelSize: 12,
        color: cCol,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1.4, 1e8, 0.5),
      },
      label: {
        text: `🛰 ${s.name || 'NORAD '+s.noradId}`,
        font: 'bold 10px JetBrains Mono',
        fillColor: cCol,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
        backgroundPadding: new Cesium.Cartesian2(5, 3),
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1.2, 1e8, 0.6),
      }
    });
    reg = { entity, posHolder, trackEntities: [], footEntity: null, footOutline: null };
    satRegistry[s.noradId] = reg;

    if (s.noradId === 25544) issEntity = entity;
  } else {
    // Just update the holder — CallbackProperty picks it up on the next render frame
    reg.posHolder.cart = cart;
  }

  // ── Ground track ───────────────────────────────────────────────────────
  reg.trackEntities.forEach(e => viewer.entities.remove(e));
  reg.trackEntities = [];
  if (s.groundTrack && s.groundTrack.length > 1) {
    const segs = []; let cur = [];
    s.groundTrack.forEach(([lon, lat]) => {
      if (isNaN(lon) || isNaN(lat)) { if (cur.length>1) segs.push(cur); cur=[]; }
      else cur.push(Cesium.Cartesian3.fromDegrees(lon, lat, 10000));
    });
    if (cur.length > 1) segs.push(cur);
    segs.forEach(pts => {
      reg.trackEntities.push(viewer.entities.add({
        polyline: {
          positions: pts, width: 1.5,
          material: new Cesium.PolylineDashMaterialProperty({
            color: cCol.withAlpha(0.55), dashLength: 12 }),
          arcType: Cesium.ArcType.GEODESIC,
        }
      }));
    });
  }

  // ── Visibility footprint ───────────────────────────────────────────────
  if (reg.footEntity)  { viewer.entities.remove(reg.footEntity);  reg.footEntity  = null; }
  if (reg.footOutline) { viewer.entities.remove(reg.footOutline); reg.footOutline = null; }
  const R     = 6371.0, h = s.altitudeKm;
  const footR = Math.sqrt(h * (2*R + h)) * 1000;
  reg.footEntity = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(s.longitudeDeg, s.latitudeDeg, 0),
    ellipse: { semiMajorAxis: footR, semiMinorAxis: footR, height: 0,
               material: cCol.withAlpha(0.06), outline: false }
  });
  const D2R=Math.PI/180, R2D=180/Math.PI, STEPS=128;
  const pts=[]; const angR=footR/(R*1000);
  const lat0=s.latitudeDeg*D2R, lon0=s.longitudeDeg*D2R;
  for (let i=0;i<=STEPS;i++) {
    const az=(i/STEPS)*2*Math.PI;
    const lat1=Math.asin(Math.sin(lat0)*Math.cos(angR)+Math.cos(lat0)*Math.sin(angR)*Math.cos(az));
    const lon1=lon0+Math.atan2(Math.sin(az)*Math.sin(angR)*Math.cos(lat0),Math.cos(angR)-Math.sin(lat0)*Math.sin(lat1));
    pts.push(Cesium.Cartesian3.fromDegrees(lon1*R2D, lat1*R2D, 5000));
  }
  reg.footOutline = viewer.entities.add({
    polyline: { positions: pts, width: 1.5,
                material: cCol.withAlpha(0.4), arcType: Cesium.ArcType.GEODESIC }
  });
}

// ── FLY WITH ──────────────────────────────────────────────────────────────

let issEntity      = null;   // kept for chase-cam compat
let issChaseActive = false;
let preIssCamera   = null;
let chasedNoradId  = null;

function satFlyWith(noradId) {
  const reg = satRegistry[noradId];
  if (!reg) { console.warn('Satellite not yet received.'); return; }
  if (issChaseActive && chasedNoradId === noradId) { exitIssChase(); return; }
  if (issChaseActive) exitIssChase();

  chasedNoradId = noradId;
  issChaseActive = true;
  document.getElementById('btn-issfly').classList.add('on');
  syncFlyBtnLabel();

  preIssCamera = {
    destination: viewer.camera.position.clone(),
    orientation: { heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: viewer.camera.roll }
  };

  // trackedEntity locks the satellite to screen centre.
  // The user can freely zoom (scroll wheel) and drag (right-click drag) around it.
  // CallbackProperty guarantees the entity is always at its latest SSE position.
  viewer.trackedEntity = reg.entity;

  // Offset camera 2,000 km back at -30° pitch so Earth fills bottom of frame.
  // After flyTo completes the user can zoom/drag freely — trackedEntity stays centred.
  viewer.zoomTo(
    reg.entity,
    new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(0),
      Cesium.Math.toRadians(-30),
      2_000_000
    )
  );
}

function exitIssChase() {
  issChaseActive = false;
  chasedNoradId  = null;
  viewer.trackedEntity = undefined;
  if (preIssCamera) viewer.camera.flyTo({ ...preIssCamera, duration: 2 });
  syncFlyBtnLabel();
}

document.getElementById('btn-issfly').addEventListener('click', () => {
  if (issChaseActive) { exitIssChase(); return; }
  // Read selected NORAD ID from the dropdown
  const sel = document.getElementById('sat-selector');
  const noradId = sel ? parseInt(sel.value) : 25544;
  const sats = window._lastTrackedSats;
  if (!sats || !sats.length) {
    // Silently wait — data not arrived yet; button will work after first SSE tick
    console.log('[SAT TRACK] Waiting for first SSE tick...');
    return;
  }
  satFlyWith(noradId);
});

// ── Add / Remove ──────────────────────────────────────────────────────────

function satAddFromInput() {
  const val = parseInt(document.getElementById('sat-norad-input').value);
  if (!val || val < 1) { alert('Enter a valid NORAD ID.'); return; }
  fetch(`/api/sat/add?noradId=${val}`, { method: 'POST' })
    .then(r => r.json())
    .then(d => { console.log('Added satellite:', d); })
    .catch(e => alert('Error adding satellite: ' + e));
}

function satRemove(noradId) {
  // Remove from globe
  const reg = satRegistry[noradId];
  if (reg) {
    viewer.entities.remove(reg.entity);
    reg.trackEntities.forEach(e => viewer.entities.remove(e));
    if (reg.footEntity)  viewer.entities.remove(reg.footEntity);
    if (reg.footOutline) viewer.entities.remove(reg.footOutline);
    delete satRegistry[noradId];
  }
  // Remove card
  const card = document.getElementById(`sat-card-${noradId}`);
  if (card) card.remove();
  // Tell backend
  fetch(`/api/sat/remove?noradId=${noradId}`, { method: 'DELETE' }).catch(() => {});
  if (issChaseActive && chasedNoradId === noradId) exitIssChase();
}

function satRefresh(noradId) {
  fetch(`/api/sat/refresh?noradId=${noradId}`, { method: 'POST' })
    .then(() => console.log('OMM refresh requested for NORAD', noradId))
    .catch(e => console.warn('Refresh failed:', e));
}

// ── OMM display formatter ─────────────────────────────────────────────────
// Renders the raw CelesTrak OMM JSON as a clean key:value grid in the panel.
// Shows only the orbital mechanics fields most useful for display.
const OMM_DISPLAY_KEYS = [
  'OBJECT_NAME','NORAD_CAT_ID','OBJECT_ID','EPOCH',
  'MEAN_MOTION','ECCENTRICITY','INCLINATION','RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER','MEAN_ANOMALY','BSTAR',
  'MEAN_MOTION_DOT','ELEMENT_SET_NO','REV_AT_EPOCH',
  'CLASSIFICATION_TYPE','EPHEMERIS_TYPE',
];

function formatOmmJson(rawJson, col) {
  try {
    const arr  = JSON.parse(rawJson);
    const obj  = Array.isArray(arr) ? arr[0] : arr;
    const rows = OMM_DISPLAY_KEYS
      .filter(k => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
      .map(k => `<div style="display:flex;gap:4px;margin-bottom:1px;">
        <span style="color:var(--muted);min-width:140px;flex-shrink:0">${k}</span>
        <span style="color:${col}">${obj[k]}</span>
      </div>`).join('');
    return rows || '<span style="color:var(--muted)">No OMM fields</span>';
  } catch (e) {
    return `<span style="color:var(--muted)">Parse error: ${e.message}</span>`;
  }
}


/* ================================================================
   SOLAR SYSTEM PLANET RENDERING
   Positions computed server-side by Orekit DE430 ephemeris.
   Rendered as labelled points at "infinite" distance on the globe.
================================================================ */

let planetEntities = {};
let planetsVisible  = true;

function updatePlanets(planets) {
  if (!planetsVisible) return;
  const DIST = 1.0e11;   // metres — well beyond skybox, appears on celestial sphere

  planets.forEach(p => {
    const cart    = new Cesium.Cartesian3(p.x * DIST, p.y * DIST, p.z * DIST);
    const mag     = p.magnitude ?? 0;
    const ptSize  = mag < -10 ? 22 : mag < -5 ? 14 : mag < 0 ? 8 : mag < 4 ? 5 : 3;
    const col     = Cesium.Color.fromCssColorString(p.color || '#ffffff');

    if (!planetEntities[p.name]) {
      planetEntities[p.name] = viewer.entities.add({
        id: `planet-${p.name}`,
        position: new Cesium.ConstantPositionProperty(cart),
        point: {
          pixelSize: ptSize,
          color: col,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.3),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `${p.symbol} ${p.name}`,
          font: '9px JetBrains Mono',
          fillColor: col,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -8),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }
      });
    } else {
      planetEntities[p.name].position = new Cesium.ConstantPositionProperty(cart);
    }
  });
}

console.log('%cGNSS TRACKER READY — Hiwonder GPS + NASA globe', 'color:#00e5ff;font-weight:bold;font-size:14px');


// ════ COSMOFRAME rendering ═══════════════════════════════════════════════


'use strict';




// ═══════════════════════════════════════════════════════════════════════
// CONSTANTS & STATE
// ═══════════════════════════════════════════════════════════════════════
const AU = 1.495978707e11;        // metres per AU

const MODE_META = {
  1: { name:'Geocentric · Equatorial',  accentVar:'--m1', accent:'#00e5ff',
       origin:'Earth', refPlane:'Equatorial', frame:'ECI / EME2000',
       coords:'RA / Dec', posKey:'eciM' },
  2: { name:'Geocentric · Ecliptic',    accentVar:'--m2', accent:'#ffc040',
       origin:'Earth', refPlane:'Ecliptic',   frame:'Geocentric Ecliptic',
       coords:'λ / β',  posKey:'geoEclM' },
  3: { name:'Heliocentric · Equatorial',accentVar:'--m3', accent:'#40c0ff',
       origin:'Sun',   refPlane:'Equatorial', frame:'Heliocentric Equatorial',
       coords:'RA / Dec', posKey:'helioEqM' },
  4: { name:'Heliocentric · Ecliptic',  accentVar:'--m4', accent:'#c040ff',
       origin:'Sun',   refPlane:'Ecliptic',   frame:'Heliocentric Ecliptic',
       coords:'λ / β',  posKey:'helioEclM' },
};

let activeMode     = 1;
let latestSnap     = null;
let bodyEntities   = {};    // id → Cesium entity
let gridEntities   = [];
let refPlaneEntity = null;
let orbitPlanetEntities = {};
let transitioning  = false;

// Toggles
let showGrid     = true;
let showLabels   = true;
let showOrbits   = false;
let showRefPlane = true;

// Scale factors for rendering
const SCALE_GEO   = 1.0;          // geocentric modes — bodies at real distances
const SCALE_HELIO = 1.0;          // heliocentric modes — actual AU positions
const RENDER_SCALE = 5e8;         // compress distances: 1 AU → 5e8 m for rendering

// ═══════════════════════════════════════════════════════════════════════
// CESIUM INIT
// ═══════════════════════════════════════════════════════════════════════
Cesium.Ion.defaultAccessToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjOWRiZWFiNS04MjA2LTQyMTYtODk2NC1lNmZkMjI1MDYwMjMiLCJpZCI6MjAwOTE1LCJpYXQiOjE3MTAxMjUxOTh9.rn-mJGC8AVINKYd6pRCT2KScL3knDF6HG1fsLkQMdFE';

// viewer already created in initGlobe()


const scene = viewer.scene;
scene.backgroundColor      = Cesium.Color.BLACK;
scene.globe.show           = true;   // shown in geocentric modes, hidden in heliocentric
scene.skyAtmosphere.show   = true;
scene.globe.enableLighting = true;
scene.globe.dynamicAtmosphereLighting = false;
scene.globe.lightingFadeOutDistance   = 1.0e8;
scene.globe.lightingFadeInDistance    = 1.0e7;
scene.light                = new Cesium.SunLight({ intensity: 1.6 });
scene.highDynamicRange     = false;

// Disable Cesium's built-in Sun and Moon primitives entirely. Our own
// DE430-driven flare billboard (sunOriginEntity/sunHaloEntity) replaces
// the native Sun in ALL modes — geocentric and heliocentric alike — for
// full visual consistency. The native Moon is similarly replaced by the
// catalogue Moon entity.
scene.moon.show = false;
scene.sun.show  = false;

// ── Custom GIBS tiling scheme (same as GNSS Tracker) ──────────────────────
// GIBS uses a non-standard 288°/tile at level-0, requiring a custom scheme.
function makeGibsTilingScheme() {
  const GIBS_BASE = 288.0;
  const ellipsoid = Cesium.Ellipsoid.WGS84;
  return {
    ellipsoid,
    rectangle: Cesium.Rectangle.MAX_VALUE,
    projection: new Cesium.GeographicProjection(ellipsoid),
    getNumberOfXTilesAtLevel(level) { return Math.ceil(360 * Math.pow(2,level) / GIBS_BASE); },
    getNumberOfYTilesAtLevel(level) { return Math.ceil(180 * Math.pow(2,level) / GIBS_BASE); },
    rectangleToNativeRectangle(rect, result) {
      const r = result || new Cesium.Rectangle();
      r.west  = Cesium.Math.toDegrees(rect.west);
      r.south = Cesium.Math.toDegrees(rect.south);
      r.east  = Cesium.Math.toDegrees(rect.east);
      r.north = Cesium.Math.toDegrees(rect.north);
      return r;
    },
    tileXYToNativeRectangle(x, y, level, result) {
      const tw = GIBS_BASE / Math.pow(2,level);
      const r  = result || new Cesium.Rectangle();
      r.west  = x * tw - 180; r.east  = r.west + tw;
      r.north = 90 - y * tw;  r.south = r.north - tw;
      return r;
    },
    tileXYToRectangle(x, y, level, result) {
      const r = this.tileXYToNativeRectangle(x, y, level, result);
      r.west  = Cesium.Math.toRadians(r.west);
      r.south = Cesium.Math.toRadians(r.south);
      r.east  = Cesium.Math.toRadians(r.east);
      r.north = Cesium.Math.toRadians(r.north);
      return r;
    },
    positionToTileXY(position, level, result) {
      const tw = GIBS_BASE / Math.pow(2,level);
      const r  = result || new Cesium.Cartesian2();
      r.x = Math.floor((Cesium.Math.toDegrees(position.longitude) + 180) / tw);
      r.y = Math.floor((90 - Cesium.Math.toDegrees(position.latitude)) / tw);
      return r;
    }
  };
}
const gibsScheme = makeGibsTilingScheme();

// ── NASA Blue Marble (day) ─────────────────────────────────────────────────
viewer.imageryLayers.addImageryProvider(
  new Cesium.UrlTemplateImageryProvider({
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/' +
         'BlueMarble_NextGeneration/default/500m/{z}/{y}/{x}.jpg',
    tilingScheme: gibsScheme,
    maximumLevel: 8, minimumLevel: 0,
    tileWidth: 512, tileHeight: 512,
    credit: new Cesium.Credit('NASA EOSDIS / Blue Marble Next Generation'),
  })
);

// ── VIIRS Black Marble night lights ────────────────────────────────────────
// nightLayer created inside initGlobe

// ── Geographic graticule on globe surface ──────────────────────────────────
// graticuleVisible and graticuleEntities declared at module scope (top of file)


// buildGraticule() called inside initGlobe()

// ═══════════════════════════════════════════════════════════════════════
// OBSERVER SKY VIEW
// Places the camera at the observer's geodetic position looking straight
// up at the zenith, with a Stellarium-style AzEl grid. Only meaningful in
// geocentric modes (you need to be standing on Earth's surface); switches
// back automatically if the user changes to a heliocentric mode while active.
// ═══════════════════════════════════════════════════════════════════════
let skyViewActive   = false;
let preSkyCamera     = null;
let skyViewEntities  = [];

// Convert observer-relative elevation/azimuth to an ECEF Cartesian3 at a
// given distance — same topocentric math used in GNSS Tracker.
function skyElAzToCart(latDeg, lonDeg, elevDeg, azimDeg, distM) {
  const D2R = Math.PI / 180;
  const elR = elevDeg * D2R, azR = azimDeg * D2R;
  const e = Math.cos(elR) * Math.sin(azR);
  const n = Math.cos(elR) * Math.cos(azR);
  const u = Math.sin(elR);

  const latR = latDeg * D2R, lonR = lonDeg * D2R;
  const EARTH_R = 6371000;

  const ux = -Math.sin(lonR)*e - Math.sin(latR)*Math.cos(lonR)*n + Math.cos(latR)*Math.cos(lonR)*u;
  const uy =  Math.cos(lonR)*e - Math.sin(latR)*Math.sin(lonR)*n + Math.cos(latR)*Math.sin(lonR)*u;
  const uz =  Math.cos(latR)*n + Math.sin(latR)*u;

  const ox = EARTH_R * Math.cos(latR) * Math.cos(lonR);
  const oy = EARTH_R * Math.cos(latR) * Math.sin(lonR);
  const oz = EARTH_R * Math.sin(latR);

  return new Cesium.Cartesian3(ox + ux*distM, oy + uy*distM, oz + uz*distM);
}

function enterSkyView() {
  const obs = window._latestObserver;
  const lat = obs?.latDeg ?? 19.1334;
  const lon = obs?.lonDeg ?? 72.9133;
  const alt = obs?.altM   ?? 14.0;

  skyViewActive = true;
  document.getElementById('btn-observer').classList.add('on');

  // Save current camera offset so we can restore it on exit
  preSkyCamera = { mode: activeMode };

  // Force geocentric equatorial mode if currently heliocentric — you can't
  // stand on the Sun's surface, so sky view only makes sense Earth-side.
  if (activeMode >= 3) {
    activeMode = 1;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-m1').classList.add('active');
    scene.globe.show = true;
    scene.skyAtmosphere.show = true;

    // Re-render all bodies immediately at the new (geocentric) mode's
    // coordinate frame before anything else runs. Without this, body
    // entities still hold positions computed for the old heliocentric
    // posKey for one frame, which can feed invalid/mismatched Cartesian3
    // values into Cesium's projection pipeline and crash the renderer.
    clearBodyEntities();
    if (window._bodies) renderBodies(window._bodies);
  }

  // Hide globe + atmosphere for a clean dark sky, keep grid/planes hidden too
  scene.globe.show         = false;
  scene.skyAtmosphere.show = false;
  scene.backgroundColor    = Cesium.Color.fromCssColorString('#04080f');

  // Release lookAt — sky view uses a direct camera position, not orbit-around-origin
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

  // Defensive guard: never call fromDegrees with invalid numbers — this is
  // exactly the kind of input that causes Cesium's geographic projection
  // to throw "Cannot read properties of undefined (reading 'longitude')".
  const safeLat = Number.isFinite(lat) ? lat : 19.1334;
  const safeLon = Number.isFinite(lon) ? lon : 72.9133;
  const safeAlt = Number.isFinite(alt) ? alt : 14.0;

  const obsPos = Cesium.Cartesian3.fromDegrees(safeLon, safeLat, safeAlt + 30);
  viewer.camera.flyTo({
    destination: obsPos,
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(90), roll: 0 },
    duration: 1.5,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    complete: () => buildSkyViewGrid(safeLat, safeLon),
  });
}

function exitSkyView() {
  skyViewActive = false;
  document.getElementById('btn-observer').classList.remove('on');

  skyViewEntities.forEach(e => viewer.entities.remove(e));
  skyViewEntities = [];

  scene.globe.show         = activeMode <= 2;
  scene.skyAtmosphere.show = activeMode <= 2;
  scene.backgroundColor    = Cesium.Color.BLACK;

  // Restore lookAt-based orbit camera for the active mode
  const offset = MODE_CAMERA_OFFSET[activeMode];
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY, offset);
}

function toggleSkyView() {
  if (skyViewActive) exitSkyView();
  else enterSkyView();
}

// ── Stellarium-style AzEl grid at the observer's location ────────────────
function buildSkyViewGrid(latDeg, lonDeg) {
  skyViewEntities.forEach(e => viewer.entities.remove(e));
  skyViewEntities = [];

  const GRID_DIST = 100_000;
  const GRID_COL  = '#4a8fbb';
  const HORIZ_COL = '#5bc8f5';
  const SPOKE_COL = '#2e6e96';
  const STEPS     = 180;

  function skyLine(positions, width, colorHex, alpha) {
    const e = viewer.entities.add({
      _isSkyView: true,
      polyline: { positions, width,
        material: Cesium.Color.fromCssColorString(colorHex).withAlpha(alpha),
        arcType: Cesium.ArcType.NONE, clampToGround: false }
    });
    skyViewEntities.push(e);
  }
  function skyLabel(cart, text, font, colorHex, alpha) {
    const e = viewer.entities.add({
      _isSkyView: true,
      position: cart,
      label: {
        text, font,
        fillColor: Cesium.Color.fromCssColorString(colorHex).withAlpha(alpha ?? 1.0),
        outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      }
    });
    skyViewEntities.push(e);
  }

  // Elevation circles every 15°
  for (let el = 15; el <= 75; el += 15) {
    const pts = [];
    for (let i = 0; i <= STEPS; i++)
      pts.push(skyElAzToCart(latDeg, lonDeg, el, (i/STEPS)*360, GRID_DIST));
    const isHalf = el === 45;
    skyLine(pts, isHalf ? 1.5 : 1.0, GRID_COL, isHalf ? 0.65 : 0.45);
    skyLabel(skyElAzToCart(latDeg, lonDeg, el, 180, GRID_DIST*1.02),
      `${el}°`, '9px JetBrains Mono', '#3a7fa0', 0.85);
  }

  // Horizon ring
  const horizPts = [];
  for (let i = 0; i <= STEPS; i++)
    horizPts.push(skyElAzToCart(latDeg, lonDeg, 1, (i/STEPS)*360, GRID_DIST));
  skyLine(horizPts, 2.0, HORIZ_COL, 0.90);

  // Azimuth spokes every 15°
  for (let az = 0; az < 360; az += 15) {
    const pts = [];
    for (let el = 1; el <= 89; el += 2)
      pts.push(skyElAzToCart(latDeg, lonDeg, el, az, GRID_DIST));
    const isCardinal = az % 90 === 0;
    const isInterCard = az % 45 === 0 && !isCardinal;
    skyLine(pts,
      isCardinal ? 1.8 : isInterCard ? 1.2 : 0.8,
      isCardinal ? GRID_COL : SPOKE_COL,
      isCardinal ? 0.70 : isInterCard ? 0.50 : 0.30);
  }

  // Cardinal/intercardinal labels
  [{az:0,l:'N',b:true},{az:45,l:'NE',b:false},{az:90,l:'E',b:true},
   {az:135,l:'SE',b:false},{az:180,l:'S',b:true},{az:225,l:'SW',b:false},
   {az:270,l:'W',b:true},{az:315,l:'NW',b:false}].forEach(({az,l,b}) => {
    skyLabel(skyElAzToCart(latDeg, lonDeg, -1.5, az, GRID_DIST*1.03),
      l, b ? 'bold 12px JetBrains Mono' : '10px JetBrains Mono', HORIZ_COL, b?1.0:0.8);
  });

  // Zenith marker
  const zenCart = skyElAzToCart(latDeg, lonDeg, 89.8, 0, GRID_DIST);
  skyViewEntities.push(viewer.entities.add({
    _isSkyView: true,
    position: zenCart,
    point: { pixelSize: 8, color: Cesium.Color.fromCssColorString(HORIZ_COL).withAlpha(0.9),
      outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY }
  }));
  skyLabel(skyElAzToCart(latDeg, lonDeg, 88, 0, GRID_DIST), 'Z',
    'bold 10px JetBrains Mono', HORIZ_COL, 0.9);
}

// Initial camera — lookAt guarantees the origin (Earth in geocentric modes,
// Sun in heliocentric modes) is always perfectly centred in the viewport,
// regardless of camera distance or pitch.
// Initial camera: position over observer (updated to GPS fix on first SSE tick)
// COSMOFRAME's lookAtTransform is only used when switching to frame modes 1-4.
// In GNSS mode (0), the camera flies to the observer position on first data.
// Initial camera: full-globe nadir view centred on observer.
// 22,000 km places Earth fully in frame with the star background visible —
// the ideal overview for the hackathon demo. Observer is pixel-centred.
// Stays at this scale until the first GPS fix animates to the real position.
(function setInitialCamera() {
  const obs = window._latestObserver;
  const lon = obs?.lonDeg ?? 72.9133;
  const lat = obs?.latDeg ?? 19.1334;
  const target = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  viewer.camera.lookAt(target,
    new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), 10_000_000));
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
})();

viewer.clock.clockStep     = Cesium.ClockStep.SYSTEM_CLOCK;
viewer.clock.shouldAnimate = true;

// ═══════════════════════════════════════════════════════════════════════
// SSE CONNECTION
// ═══════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════
// BODY RENDERING
// ═══════════════════════════════════════════════════════════════════════

// Convert a body's position vector to a Cesium Cartesian3 for the active mode.
// Geocentric modes: use the geocentric vector directly (scaled down for rendering).
// Heliocentric modes: vector is from Sun — same rendering but globe is offset.
function bodyToCart(body) {
  // Use activeFrameMode (unified, always current) not activeMode (COSMO-internal, may lag)
  const meta = FRAME_META[activeFrameMode] || FRAME_META[1];
  const pos  = meta.posKey ? body[meta.posKey] : null;   // [X, Y, Z] in metres
  if (!pos) return null;
  // Scale down so the solar system fits in CesiumJS's precision range
  // 1 AU ≈ 1.5e11 m → render at 1.5e8 m (divide by 1000)
  const S = 1.0 / 1000.0;

  // ── Moon visual exaggeration in heliocentric modes ──────────────────────
  // The Moon's true distance from Earth (384,400 km) is only ~0.26% of
  // Earth's distance from the Sun (1 AU) — at heliocentric render scale
  // this collapses to a fraction of a pixel, making the Moon's glow
  // billboard sit exactly on top of Earth's. We exaggerate the Moon's
  // offset FROM Earth by a fixed multiplier here (visual-only, does not
  // affect any computed quantity, HUD value, or geocentric-mode position)
  // so it remains a small but clearly separate dot near Earth — the same
  // technique used by NASA's Eyes on the Solar System.
  if (body.id === 'moon' && activeFrameMode >= 3) {
    const earthBody = window._lastBodiesById?.earth;
    if (earthBody) {
      const earthPos = earthBody[FRAME_META[activeFrameMode]?.posKey];
      if (earthPos) {
        const MOON_EXAGGERATION = 80; // visually separates Moon from Earth's disc
        const dx = (pos[0] - earthPos[0]) * MOON_EXAGGERATION;
        const dy = (pos[1] - earthPos[1]) * MOON_EXAGGERATION;
        const dz = (pos[2] - earthPos[2]) * MOON_EXAGGERATION;
        return new Cesium.Cartesian3(
          (earthPos[0] + dx) * S,
          (earthPos[1] + dy) * S,
          (earthPos[2] + dz) * S
        );
      }
    }
  }

  return new Cesium.Cartesian3(pos[0]*S, pos[1]*S, pos[2]*S);
}

function bodyPixelSize(body) {
  const mag = body.magnitude ?? 0;
  // Sun
  if (body.id === 'sun')  return activeFrameMode <= 2 ? 30 : 40;
  if (body.id === 'earth' && activeFrameMode >= 3) return 18;
  // Moon is rendered via the dedicated glow billboard system, not bodyPixelSize
  // Planets by magnitude
  if (mag < -3) return 14;
  if (mag <  0) return 10;
  if (mag <  4) return 7;
  if (mag <  8) return 5;
  return 3;
}

let sunOriginEntity   = null;
let sunHaloEntity     = null;
let _sunFlareTexture  = null;
let _sunHaloTexture   = null;
const _sunCartHolder  = { cart: Cesium.Cartesian3.ZERO };

let moonOriginEntity  = null;
let moonHaloEntity    = null;
let _moonFlareTexture = null;
let _moonHaloTexture  = null;
const _moonCartHolder = { cart: Cesium.Cartesian3.ZERO };

// ── Generate a radial-gradient "lens flare" texture on a canvas ──────────
// Mimics Cesium's native scene.sun billboard: bright white-yellow core,
// soft orange falloff, fully transparent edge. Built once and cached.
function buildSunFlareTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2;

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  grad.addColorStop(0.00, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.12, 'rgba(255,250,220,0.95)');
  grad.addColorStop(0.28, 'rgba(255,225,140,0.55)');
  grad.addColorStop(0.50, 'rgba(255,180,60,0.18)');
  grad.addColorStop(0.75, 'rgba(255,140,30,0.05)');
  grad.addColorStop(1.00, 'rgba(255,120,0,0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas.toDataURL();
}

// ── Wider, fainter outer halo for the atmospheric glow ring effect ───────
function buildSunHaloTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2;

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  grad.addColorStop(0.00, 'rgba(255,235,180,0.35)');
  grad.addColorStop(0.40, 'rgba(255,210,120,0.12)');
  grad.addColorStop(0.70, 'rgba(255,180,80,0.04)');
  grad.addColorStop(1.00, 'rgba(255,160,60,0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas.toDataURL();
}

// ── Moon flare — cooler, pale silver-blue, much fainter than the Sun ─────
// (the Moon shines by reflected sunlight, so it has no fiery corona —
// just a soft, dim, slightly blue-white glow against the night sky).
function buildMoonFlareTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2;

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  grad.addColorStop(0.00, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.18, 'rgba(232,232,240,0.85)');
  grad.addColorStop(0.38, 'rgba(200,210,230,0.40)');
  grad.addColorStop(0.65, 'rgba(180,195,225,0.12)');
  grad.addColorStop(1.00, 'rgba(170,190,225,0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas.toDataURL();
}

function buildMoonHaloTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2;

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  grad.addColorStop(0.00, 'rgba(210,220,240,0.18)');
  grad.addColorStop(0.45, 'rgba(190,205,235,0.06)');
  grad.addColorStop(0.75, 'rgba(180,195,230,0.02)');
  grad.addColorStop(1.00, 'rgba(170,190,225,0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas.toDataURL();
}

_sunFlareTexture  = buildSunFlareTexture();
_sunHaloTexture   = buildSunHaloTexture();
_moonFlareTexture = buildMoonFlareTexture();
_moonHaloTexture  = buildMoonHaloTexture();

function renderBodies(bodies) {
  const meta = FRAME_META[activeFrameMode] || FRAME_META[1];

  // Build id → body lookup BEFORE any bodyToCart() calls below — needed
  // so the Moon's heliocentric-mode exaggeration can find Earth's position.
  window._lastBodiesById = {};
  bodies.forEach(b => { window._lastBodiesById[b.id] = b; });

  // ── Sun lens-flare billboard — used in ALL modes, replacing the native
  // Cesium scene.sun entirely. Position tracks the Sun's true location:
  // world origin in heliocentric modes, the real geocentric/ecliptic
  // vector in geocentric modes (so it appears correctly relative to Earth).
  const sunBody = bodies.find(b => b.id === 'sun');
  const sunCart = activeFrameMode >= 3
    ? Cesium.Cartesian3.ZERO
    : (sunBody ? bodyToCart(sunBody) : null);

  if (sunCart) {
    if (!sunOriginEntity) {
      sunHaloEntity = viewer.entities.add({
        id: 'sun-halo',
        position: new Cesium.CallbackProperty(() => _sunCartHolder.cart, false),
        billboard: {
          image: _sunHaloTexture,
          width: 340, height: 340,
          color: Cesium.Color.WHITE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(1e6, 1.4, 1e10, 0.5),
          sizeInMeters: false,
        }
      });
      sunOriginEntity = viewer.entities.add({
        id: 'sun-origin',
        position: new Cesium.CallbackProperty(() => _sunCartHolder.cart, false),
        billboard: {
          image: _sunFlareTexture,
          width: 130, height: 130,
          color: Cesium.Color.WHITE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(1e6, 1.6, 1e10, 0.55),
        },
        label: {
          text: '☀ Sun',
          font: 'bold 12px JetBrains Mono',
          fillColor: Cesium.Color.fromCssColorString('#fff5b0'),
          outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -34),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
          backgroundPadding: new Cesium.Cartesian2(4, 2),
        }
      });
      sunOriginEntity._bodyId = 'sun';
    }
    _sunCartHolder.cart = sunCart;
    sunOriginEntity.show = true;
    sunHaloEntity.show   = true;
  } else {
    if (sunOriginEntity) sunOriginEntity.show = false;
    if (sunHaloEntity)   sunHaloEntity.show   = false;
  }

  // ── Moon glow billboard — same technique, cooler/fainter palette ───────
  // Tracks the Moon's true position in every mode via its catalogue posKey
  // (geocentric in modes 1/2, heliocentric in modes 3/4 — orbiting Earth
  // in all cases, since bodyToCart always reads the correct frame vector).
  const moonBody = bodies.find(b => b.id === 'moon');
  const moonCart = moonBody ? bodyToCart(moonBody) : null;

  if (moonCart) {
    if (!moonOriginEntity) {
      moonHaloEntity = viewer.entities.add({
        id: 'moon-halo',
        position: new Cesium.CallbackProperty(() => _moonCartHolder.cart, false),
        billboard: {
          image: _moonHaloTexture,
          width: 90, height: 90,
          color: Cesium.Color.WHITE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(1e5, 1.2, 1e11, 0.8),
          sizeInMeters: false,
        }
      });
      moonOriginEntity = viewer.entities.add({
        id: 'moon-origin',
        position: new Cesium.CallbackProperty(() => _moonCartHolder.cart, false),
        point: {
          pixelSize: 14,
          color: Cesium.Color.fromCssColorString('#e0e8ff'),
          outlineColor: Cesium.Color.fromCssColorString('#c0d0ff').withAlpha(0.6),
          outlineWidth: 4,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(1e5, 1.5, 1e11, 0.8),
        },
        label: {
          text: new Cesium.CallbackProperty(
            () => activeFrameMode >= 3 ? '☽ Moon (offset exaggerated 80×)' : '☽ Moon',
            false
          ),
          font: 'bold 10px JetBrains Mono',
          fillColor: Cesium.Color.fromCssColorString('#e8e8f0'),
          outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
          backgroundPadding: new Cesium.Cartesian2(3, 2),
        }
      });
      moonOriginEntity._bodyId = 'moon';
    }
    _moonCartHolder.cart = moonCart;
    moonOriginEntity.show = true;
    moonHaloEntity.show   = true;
  } else {
    if (moonOriginEntity) moonOriginEntity.show = false;
    if (moonHaloEntity)   moonHaloEntity.show   = false;
  }

  // ── Earth as a small tilted sphere (heliocentric modes) ─────────────────
  // Rather than a flat dot like other planets, Earth gets a real 3D
  // ellipsoid entity with a visible rotation-axis tick — both tilted at
  // the true 23.44° obliquity relative to the ecliptic normal, so Earth's
  // axial tilt is visually obvious even at solar-system scale.
  let earthHelioEntity = null, earthHelioAxisEntity = null;
  const earthBodyForHelio = bodies.find(b => b.id === 'earth');
  if (activeFrameMode >= 3 && earthBodyForHelio) {
    const earthCart = bodyToCart(earthBodyForHelio);
    if (earthCart) {
      if (!bodyEntities['earth-sphere']) {
        const posHolder = { cart: earthCart };
        const EARTH_TILT_RAD = 23.4393 * Math.PI / 180;

        // Tilted ellipsoid — small sphere with a slight axial lean baked
        // into its orientation quaternion (rotation about the X axis).
        const tiltQuat = Cesium.Quaternion.fromAxisAngle(
          Cesium.Cartesian3.UNIT_X, EARTH_TILT_RAD);
        const orientation = new Cesium.CallbackProperty(
          () => tiltQuat, false);

        // Earth rendered as a prominent glowing point with a blue halo glow
        // The ellipsoid approach renders at sub-pixel size at AU scale —
        // a large pixel point is far more visible at solar-system distances.
        const sphereEntity = viewer.entities.add({
          id: 'earth-sphere',
          position: new Cesium.CallbackProperty(() => posHolder.cart, false),
          point: {
            pixelSize: 16,
            color: Cesium.Color.fromCssColorString('#4a9eff'),
            outlineColor: Cesium.Color.fromCssColorString('#aad4ff').withAlpha(0.7),
            outlineWidth: 5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(1e7, 1.5, 1e12, 0.5),
          },
          label: {
            text: '⊕ Earth',
            font: 'bold 11px JetBrains Mono',
            fillColor: Cesium.Color.fromCssColorString('#4a9eff'),
            outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -14),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
            backgroundPadding: new Cesium.Cartesian2(5, 3),
          },
        });
        sphereEntity._bodyId = 'earth';
        bodyEntities['earth-sphere'] = { posHolder, entity: sphereEntity };

        // Small axis tick through the tilted sphere — same red dashed
        // style as the geocentric-mode axis indicator, scaled down.
        const AXIS_HALF = 1.6e6;
        const tiltedNorth = new Cesium.Cartesian3(
          0, -AXIS_HALF * Math.sin(EARTH_TILT_RAD), AXIS_HALF * Math.cos(EARTH_TILT_RAD));
        const tiltedSouth = Cesium.Cartesian3.negate(tiltedNorth, new Cesium.Cartesian3());
        const axisPosHolder = { cart: earthCart };
        const axisEntity = viewer.entities.add({
          id: 'earth-helio-axis',
          polyline: {
            positions: new Cesium.CallbackProperty(() => [
              Cesium.Cartesian3.add(axisPosHolder.cart, tiltedSouth, new Cesium.Cartesian3()),
              Cesium.Cartesian3.add(axisPosHolder.cart, tiltedNorth, new Cesium.Cartesian3()),
            ], false),
            width: 1.2,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#ff6b6b').withAlpha(0.5),
              dashLength: 8,
            }),
            arcType: Cesium.ArcType.NONE,
          }
        });
        bodyEntities['earth-helio-axis'] = { posHolder: axisPosHolder, entity: axisEntity };
      } else {
        bodyEntities['earth-sphere'].posHolder.cart = earthCart;
        bodyEntities['earth-helio-axis'].posHolder.cart = earthCart;
      }
    }
  } else {
    // Clean up if we leave heliocentric mode
    if (bodyEntities['earth-sphere']) {
      viewer.entities.remove(bodyEntities['earth-sphere'].entity);
      delete bodyEntities['earth-sphere'];
    }
    if (bodyEntities['earth-helio-axis']) {
      viewer.entities.remove(bodyEntities['earth-helio-axis'].entity);
      delete bodyEntities['earth-helio-axis'];
    }
  }

  bodies.forEach(body => {
    // Earth: skip in geocentric modes (it's the actual CesiumJS globe there)
    // and skip in heliocentric modes too (it's the tilted sphere above).
    if (body.id === 'earth') return;
    // Sun and Moon: always skip as regular catalogue points — the glow
    // billboards above (sunOriginEntity / moonOriginEntity) render them
    // in every mode now.
    if (body.id === 'sun' || body.id === 'moon') return;

    const cart = bodyToCart(body);
    if (!cart) return;

    const col = Cesium.Color.fromCssColorString(body.color || '#ffffff');

    if (!bodyEntities[body.id]) {
      // Create entity
      const posHolder = { cart };
      bodyEntities[body.id] = {
        posHolder,
        entity: viewer.entities.add({
          id: `body-${body.id}`,
          position: new Cesium.CallbackProperty(() => posHolder.cart, false),
          point: {
            pixelSize: bodyPixelSize(body),
            color: col,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.3),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(1e6, 1.5, 1e12, 0.4),
          },
          label: showLabels ? {
            text: `${body.name}`,
            font: '10px JetBrains Mono',
            fillColor: col,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
            backgroundPadding: new Cesium.Cartesian2(4, 2),
            scaleByDistance: new Cesium.NearFarScalar(1e6, 1.2, 1e12, 0.5),
          } : undefined,
        }),
      };

      // Click handler → show body info
      bodyEntities[body.id].entity._bodyId = body.id;
    } else {
      bodyEntities[body.id].posHolder.cart = cart;
    }
  });

  // Store for click inspection
  window._bodies = bodies;
}

// ── Click on body to show info panel ──────────────────────────────────
viewer.screenSpaceEventHandler.setInputAction(movement => {
  const picked = viewer.scene.pick(movement.position);
  if (Cesium.defined(picked) && picked.id?._bodyId) {
    showBodyPanel(picked.id._bodyId);
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

function showBodyPanel(id) {
  const bodies = window._bodies || [];
  const body   = bodies.find(b => b.id === id);
  if (!body) return;
  const meta   = MODE_META[activeMode];
  const panel  = document.getElementById('body-panel');
  const nameEl = document.getElementById('body-name');
  const rowsEl = document.getElementById('body-rows');

  nameEl.textContent = body.name;
  nameEl.style.color = body.color;

  const rows = [
    ['Category',    body.category],
    ['Dist (AU)',   body.distAuGeo?.toFixed(6)  ?? body.distAuHelio?.toFixed(6)],
    ['RA',          body.raDeg  != null ? body.raDeg.toFixed(4)  + '°' : '—'],
    ['Dec',         body.decDeg != null ? body.decDeg.toFixed(4) + '°' : '—'],
    ['Ecl λ',       body.eclLonGeo != null ? body.eclLonGeo.toFixed(4) + '°' : body.helioLon?.toFixed(4)+'°'],
    ['Ecl β',       body.eclLatGeo != null ? body.eclLatGeo.toFixed(4) + '°' : body.helioLat?.toFixed(4)+'°'],
    ['Elongation',  body.elongationDeg?.toFixed(2) + '°'],
    ['Phase angle', body.phaseAngleDeg?.toFixed(2) + '°'],
    ['Light time',  body.lightTimeMin?.toFixed(3)  + ' min'],
    ['Magnitude',   body.magnitude?.toFixed(1)],
    ['Radius',      body.radiusKm?.toLocaleString() + ' km'],
  ];

  rowsEl.innerHTML = rows.map(([k, v]) =>
    `<div class="body-row"><span class="body-key">${k}</span><span>${v ?? '—'}</span></div>`
  ).join('');

  panel.classList.add('visible');
}

function closeBodyPanel() {
  document.getElementById('body-panel').classList.remove('visible');
}

// ═══════════════════════════════════════════════════════════════════════
// MODE SWITCHING
// ═══════════════════════════════════════════════════════════════════════
function switchMode(newMode) {
  if (newMode === activeMode || transitioning) return;
  if (skyViewActive) exitSkyView();   // mode bar always exits sky view first

  const oldMode = activeMode;
  activeMode    = newMode;
  transitioning = true;

  // Update button styles
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-m${newMode}`).classList.add('active');

  // Update HUD accent colour
  const meta = MODE_META[newMode];
  const _hud = document.getElementById('cosmo-hud'); if(_hud) _hud.style.setProperty('--accent-color', meta.accent);
  document.getElementById('cosmo-hud-title').textContent = `FRAME: ${meta.name.toUpperCase()}`;

  // Show/hide globe, graticule, and native Sun based on mode.
  const geoMode = newMode <= 2;
  scene.globe.show         = geoMode;
  scene.skyAtmosphere.show = geoMode;

  // Geographic graticule: meaningful on the globe surface → geocentric only
  // Celestial grid (COSMOFRAME RA/Dec lines): meaningful in all frame modes
  graticuleEntities.forEach(e => { e.show = geoMode && graticuleVisible; });
  document.getElementById('btn-graticule')?.classList.toggle('on', geoMode && graticuleVisible);

  if (!geoMode) {
    // Entering heliocentric: remove celestial grid sphere (wraps Sun) and
    // hide graticule (ECEF-based, would sit at Sun's position not Earth's).
    showGrid = true;
    gridEntities.forEach(e => viewer.entities.remove(e));
    gridEntities = [];
    document.getElementById('btn-grid')?.classList.add('on');
    // Hard-hide graticule — ECEF graticule at origin = at the Sun
    graticuleEntities.forEach(e => { e.show = false; });
    document.getElementById('btn-graticule')?.classList.remove('on');
  } else {
    // Returning to geocentric: restore geographic graticule, keep celestial grid on
    graticuleEntities.forEach(e => { e.show = graticuleVisible; });
    document.getElementById('btn-graticule')?.classList.toggle('on', graticuleVisible);
    // Celestial grid stays ON in geocentric modes — it shows the coordinate frame
    // the satellites orbit in (RA/Dec for GEO·EQ, ecliptic for GEO·ECL)
    showGrid = true;
    document.getElementById('btn-grid')?.classList.add('on');
    gridEntities.forEach(e => { e.show = true; });
    if (showGrid) buildGrid();
  }

  // Animate camera transition
  animateModeTransition(oldMode, newMode, () => {
    transitioning = false;
    buildGrid();
    buildRefPlane();
    buildEarthAxis();
    if (showOrbits) buildOrbits();
  });

  // Clear entities — they'll be rebuilt on next snapshot
  clearBodyEntities();
}

// Camera offset (from origin) for each mode — defines distance/angle, NOT position.
// lookAtTransform always keeps (0,0,0) — Earth or Sun — exactly centred.
const MODE_CAMERA_OFFSET = {
  1: new Cesium.Cartesian3(0, -3.5e6, 1.0e7),   // Earth, equatorial — same 10,000 km as GNSS
  2: new Cesium.Cartesian3(0, -3.5e6, 1.0e7),   // Earth, ecliptic — same 10,000 km as GNSS
  3: new Cesium.Cartesian3(0, 0, 8.5e8),         // Sun, pure top-down — ecliptic as flat disc
  4: new Cesium.Cartesian3(0, 0, 8.5e8),         // Sun, pure top-down — ecliptic as flat disc
};

function animateModeTransition(oldMode, newMode, onComplete) {
  // For geocentric modes (1, 2): fly to observer position at the target altitude,
  // same view as GNSS — Earth centred on observer, consistent scale across modes.
  // For heliocentric modes (3, 4): lookAtTransform around Sun at origin, top-down.
  if (newMode >= 1 && newMode <= 2) {
    const obs  = window._latestObserver;
    const lon  = obs?.lonDeg ?? 72.9133;
    const lat  = obs?.latDeg ?? 19.1334;
    const dist = 10_000_000; // 10,000 km — same as GNSS default
    const target = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(target, dist),
      {
        duration: 1.8,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-55), 0),
        complete: () => {
          viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
          onComplete();
        }
      }
    );
    return;
  }

  const fromOffset = MODE_CAMERA_OFFSET[oldMode] || MODE_CAMERA_OFFSET[3];
  const toOffset    = MODE_CAMERA_OFFSET[newMode];
  const duration    = 2000; // ms
  const startTime   = performance.now();

  function step() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1.0);
    const eased = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;

    const cur = new Cesium.Cartesian3(
      Cesium.Math.lerp(fromOffset.x, toOffset.x, eased),
      Cesium.Math.lerp(fromOffset.y, toOffset.y, eased),
      Cesium.Math.lerp(fromOffset.z, toOffset.z, eased)
    );
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY, cur);

    if (t < 1.0) {
      requestAnimationFrame(step);
    } else {
      // Heliocentric: lock to clean top-down with North up
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      viewer.camera.setView({
        destination: new Cesium.Cartesian3(toOffset.x, toOffset.y, toOffset.z),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch:   Cesium.Math.toRadians(-90),
          roll:    0
        }
      });
      onComplete();
    }
  }
  requestAnimationFrame(step);
}

let earthAxisEntities = [];

// ── Earth's rotational axis — visible tilt indicator ──────────────────────
// Cesium's globe primitive cannot be given a custom model matrix, and a
// featureless sphere looks identical at any spin angle — so the only way
// to make the 23.44° obliquity visually obvious is to draw the axis itself
// as a line through the globe, from geographic south pole to north pole
// extended into space, tilted at the true angle relative to the ecliptic
// normal. This is genuinely Earth's real rotational axis (the WGS84 Z-axis
// IS Earth's spin axis) — we're just making it visible rather than implied.
function buildEarthAxis() {
  earthAxisEntities.forEach(e => viewer.entities.remove(e));
  earthAxisEntities = [];
  if (activeMode > 2) return; // only meaningful with the globe visible

  const AXIS_LEN = 1.2e7; // extends ~2x Earth's radius above each pole
  const northPt = new Cesium.Cartesian3(0, 0,  AXIS_LEN);
  const southPt = new Cesium.Cartesian3(0, 0, -AXIS_LEN);

  earthAxisEntities.push(viewer.entities.add({
    _isEarthAxis: true,
    polyline: {
      positions: [southPt, northPt],
      width: 1.5,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString('#ff6b6b').withAlpha(0.55),
        dashLength: 10,
      }),
      arcType: Cesium.ArcType.NONE,
    }
  }));

  // North pole label
  earthAxisEntities.push(viewer.entities.add({
    _isEarthAxis: true,
    position: new Cesium.Cartesian3(0, 0, AXIS_LEN * 1.05),
    label: {
      text: 'N (rotation axis)',
      font: '9px JetBrains Mono',
      fillColor: Cesium.Color.fromCssColorString('#ff6b6b').withAlpha(0.8),
      outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    }
  }));
}

function clearBodyEntities() {
  Object.values(bodyEntities).forEach(b => viewer.entities.remove(b.entity));
  bodyEntities = {};
  if (sunOriginEntity)  { viewer.entities.remove(sunOriginEntity);  sunOriginEntity  = null; }
  if (sunHaloEntity)    { viewer.entities.remove(sunHaloEntity);    sunHaloEntity    = null; }
  if (moonOriginEntity) { viewer.entities.remove(moonOriginEntity); moonOriginEntity = null; }
  if (moonHaloEntity)   { viewer.entities.remove(moonHaloEntity);   moonHaloEntity   = null; }
}

// ═══════════════════════════════════════════════════════════════════════
// EQUATORIAL / ECLIPTIC GRID
// ═══════════════════════════════════════════════════════════════════════
// Grid radius scales with the active mode's scene scale.
// Geocentric: ~200,000 km (just beyond GEO) — appropriate for Earth-centred view.
// Heliocentric: ~3 AU rendered (at our 1/1000 render scale, 1 AU = 1.496e8 m)
//   so we use enough radius to be clearly visible at the heliocentric camera distance.
function currentGridRadius() {
  return activeMode <= 2 ? 2.0e8 : 5.0e8;
}

function buildGrid() {
  gridEntities.forEach(e => viewer.entities.remove(e));
  gridEntities = [];
  if (!showGrid) return;
  // Celestial RA/Dec grid only meaningful in geocentric modes where
  // you're viewing the celestial sphere from Earth. In heliocentric
  // modes planets are already at correct positions — the grid sphere
  // around the Sun adds no information and obscures the solar system.
  if (activeFrameMode >= 3) return;

  const meta   = MODE_META[activeMode];
  const isEcl  = activeMode === 2 || activeMode === 4;
  const STEPS  = 180;
  const isHelio = activeMode >= 3;

  // Grid colour based on mode
  const lineCol = isEcl ? '#4a3800' : '#1a3a5a';
  const mainCol = isEcl ? '#806000' : '#2a5a8a';
  const eqCol   = isEcl ? '#ffc040' : '#00e5ff';  // equator/ecliptic highlight

  const gmst = latestSnap?.frameContext?.gmstDeg
    ? latestSnap.frameContext.gmstDeg * Math.PI / 180 : 0;

  // Build RA or ecliptic longitude circles (meridians)
  for (let deg = 0; deg < 360; deg += 10) {
    const angleRad = deg * Math.PI / 180;
    const pts = [];
    for (let i = 0; i <= STEPS; i++) {
      const dec = -90 + i * 180 / STEPS;
      pts.push(gridPoint(angleRad / (Math.PI / 12), dec, gmst, isEcl, currentGridRadius()));
    }
    const isMain = deg % 90 === 0;
    gridEntities.push(viewer.entities.add({
      _isGrid: true,
      show: showGrid,
      polyline: {
        positions: pts.filter(Boolean),
        width: isMain ? 1.2 : 0.6,
        material: Cesium.Color.fromCssColorString(isMain ? mainCol : lineCol)
          .withAlpha(isMain ? 0.60 : 0.25),
        arcType: Cesium.ArcType.NONE,
      }
    }));
  }

  // Dec or ecliptic latitude parallels
  for (let dec = -80; dec <= 80; dec += 10) {
    const pts = [];
    for (let i = 0; i <= STEPS * 2; i++) {
      const ra = i * 24 / (STEPS * 2);
      pts.push(gridPoint(ra, dec, gmst, isEcl, currentGridRadius()));
    }
    const isEq   = dec === 0;
    const isMain = Math.abs(dec) % 30 === 0;
    const col    = isEq ? eqCol : isMain ? mainCol : lineCol;
    const alph   = isEq ? 0.85  : isMain ? 0.50   : 0.22;
    const w      = isEq ? 2.0   : isMain ? 1.0    : 0.6;
    gridEntities.push(viewer.entities.add({
      _isGrid: true,
      show: showGrid,
      polyline: {
        positions: pts.filter(Boolean),
        width: w,
        material: Cesium.Color.fromCssColorString(col).withAlpha(alph),
        arcType: Cesium.ArcType.NONE,
      }
    }));
  }
}

// Convert RA hours (or ecliptic lon/15) + Dec to a Cartesian3 position
function gridPoint(raHours, decDeg, gmst, isEcliptic, radius) {
  const raRad  = raHours * Math.PI / 12;
  const decRad = decDeg  * Math.PI / 180;
  const x = Math.cos(decRad) * Math.cos(raRad);
  const y = Math.cos(decRad) * Math.sin(raRad);
  const z = Math.sin(decRad);
  // Rotate by -GMST to convert from ICRF to ECEF (Earth-fixed)
  const cosG = Math.cos(-gmst), sinG = Math.sin(-gmst);
  // For ecliptic, apply obliquity tilt (~23.44°)
  let xr = x, yr = y, zr = z;
  if (isEcliptic) {
    const eps = 23.4393 * Math.PI / 180;
    xr =  x;
    yr =  y * Math.cos(eps) - z * Math.sin(eps);
    zr =  y * Math.sin(eps) + z * Math.cos(eps);
  }
  return new Cesium.Cartesian3(
    (xr * cosG - yr * sinG) * radius,
    (xr * sinG + yr * cosG) * radius,
    zr * radius
  );
}

// ── Equatorial + Ecliptic Plane Display ───────────────────────────────
// Shows both planes simultaneously as translucent filled discs with:
//  • Equatorial plane — cyan disc in Earth's equatorial plane
//  • Ecliptic plane   — gold disc tilted 23.44° (the obliquity)
//  • Line of nodes    — intersection of the two planes (equinox line)
//  • ♈ Vernal equinox and ♎ Autumnal equinox labels

let planeEntities = [];   // replaces refPlaneEntity

function buildRefPlane() {
  planeEntities.forEach(e => viewer.entities.remove(e));
  planeEntities = [];
  if (!showRefPlane) return;

  const gmstRad = latestSnap?.frameContext?.gmstDeg
    ? latestSnap.frameContext.gmstDeg * Math.PI / 180 : 0;

  const OBLIQUITY = 23.4393 * Math.PI / 180;   // true obliquity, radians
  const STEPS     = 180;                         // polygon segments
  const DISC_R    = currentGridRadius() * 0.92;          // disc radius matches grid sphere
  const RIM_R     = currentGridRadius() * 0.93;          // rim circle slightly larger
  const isGeoModeNow = activeMode <= 2;

  // ── Helper: rotate an ICRF unit vector to ECEF via GMST ───────────────
  function icrfToEcef(x, y, z) {
    const cosG = Math.cos(-gmstRad), sinG = Math.sin(-gmstRad);
    return new Cesium.Cartesian3(
      (x * cosG - y * sinG) * DISC_R,
      (x * sinG + y * cosG) * DISC_R,
      z * DISC_R
    );
  }

  // ── Equatorial plane disc — use a dense polyline fan from centre ──────────
  // Cesium polygon requires geographic coords; we use polyline loops instead.
  // Inner fill: many thin polylines from centre to rim create a translucent disc.
  const eqPts = [];
  for (let i = 0; i <= STEPS; i++) {
    const ra = (i / STEPS) * 2 * Math.PI;
    eqPts.push(icrfToEcef(Math.cos(ra), Math.sin(ra), 0));
  }
  const ORIGIN = new Cesium.Cartesian3(1, 1, 1); // tiny offset avoids Cesium origin projection error
  // Disc fill: spokes every 10°
  for (let deg = 0; deg < 360; deg += 10) {
    const ra  = deg * Math.PI / 180;
    const tip = icrfToEcef(Math.cos(ra), Math.sin(ra), 0);
    planeEntities.push(viewer.entities.add({
      _isRefPlane: true,
      polyline: {
        positions: [ORIGIN, tip],
        width: 1,
        material: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.04),
        arcType: Cesium.ArcType.NONE,
      }
    }));
  }
  // Bright rim
  planeEntities.push(viewer.entities.add({
    _isRefPlane: true,
    polyline: {
      positions: eqPts,
      width: 2.0,
      material: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(isGeoModeNow ? 0.85 : 0.45),
      arcType: Cesium.ArcType.NONE,
    }
  }));

  // ── Ecliptic plane disc ───────────────────────────────────────────────────
  const eclPts = [];
  for (let i = 0; i <= STEPS; i++) {
    const lon = (i / STEPS) * 2 * Math.PI;
    const xe = Math.cos(lon);
    const ye = Math.sin(lon);
    const xq = xe;
    const yq = ye * Math.cos(OBLIQUITY);
    const zq = ye * Math.sin(OBLIQUITY);
    eclPts.push(icrfToEcef(xq, yq, zq));
  }
  // Disc fill via spokes
  for (let deg = 0; deg < 360; deg += 10) {
    const lon = deg * Math.PI / 180;
    const tip = icrfToEcef(
      Math.cos(lon),
      Math.sin(lon) * Math.cos(OBLIQUITY),
      Math.sin(lon) * Math.sin(OBLIQUITY)
    );
    planeEntities.push(viewer.entities.add({
      _isRefPlane: true,
      polyline: {
        positions: [ORIGIN, tip],
        width: 1,
        material: Cesium.Color.fromCssColorString('#ffc040').withAlpha(0.04),
        arcType: Cesium.ArcType.NONE,
      }
    }));
  }
  // Bright rim — ecliptic stays strong in heliocentric mode since it IS
  // that view's natural reference plane; only dim slightly less than equatorial
  planeEntities.push(viewer.entities.add({
    _isRefPlane: true,
    polyline: {
      positions: eclPts,
      width: 2.0,
      material: Cesium.Color.fromCssColorString('#ffc040').withAlpha(isGeoModeNow ? 0.85 : 0.75),
      arcType: Cesium.ArcType.NONE,
    }
  }));

  // ── Line of nodes (intersection of equatorial and ecliptic planes) ─────
  // This is the line where the two reference planes cross — it marks the
  // equinox directions (RA 0h / RA 12h), NOT a pointer to any planet.
  // Dimmed in heliocentric mode since it has no fixed relation to any
  // visible body there and can otherwise look like it's indicating one.
  const nodeStart = icrfToEcef(-1, 0, 0);
  const nodeEnd   = icrfToEcef( 1, 0, 0);
  const nodeAlpha = isGeoModeNow ? 0.70 : 0.35;
  planeEntities.push(viewer.entities.add({
    _isRefPlane: true,
    polyline: {
      positions: [nodeStart, ORIGIN, nodeEnd],
      width: isGeoModeNow ? 2.5 : 1.5,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString('#ffffff').withAlpha(nodeAlpha),
        dashLength: 16,
      }),
      arcType: Cesium.ArcType.NONE,
    }
  }));
  // Small label at the midpoint clarifying what this line is
  const nodeLabelCart = icrfToEcef(0.06, 0.06, 0);
  planeEntities.push(viewer.entities.add({
    _isRefPlane: true,
    position: new Cesium.ConstantPositionProperty(nodeLabelCart),
    label: {
      text: 'Line of Nodes',
      font: '8px JetBrains Mono',
      fillColor: Cesium.Color.WHITE.withAlpha(isGeoModeNow ? 0.65 : 0.40),
      outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      pixelOffset: new Cesium.Cartesian2(0, 14),
    }
  }));

  // ── Obliquity arc — shows the 23.44° angle between the two planes ──────
  // Only meaningful close to Earth (the angle belongs to Earth's axial tilt
  // relative to its orbital plane). At heliocentric scale it has no fixed
  // position relative to any body and just reads as a stray line near the Sun.

  if (isGeoModeNow) {
    const ARC_R   = DISC_R * 0.35;
    const arcPts  = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * OBLIQUITY;
      arcPts.push(icrfToEcef(
        Math.cos(Math.PI / 2 - a) * ARC_R / DISC_R,
        0,
        Math.sin(a) * ARC_R / DISC_R
      ));
    }
    planeEntities.push(viewer.entities.add({
      _isRefPlane: true,
      polyline: {
        positions: arcPts,
        width: 1.5,
        material: Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.55),
        arcType: Cesium.ArcType.NONE,
      }
    }));

    const oblMid = OBLIQUITY / 2;
    const oblCart = icrfToEcef(
      Math.cos(Math.PI / 2 - oblMid) * 0.40,
      0.04,
      Math.sin(oblMid) * 0.40
    );
    planeEntities.push(viewer.entities.add({
      _isRefPlane: true,
      position: new Cesium.ConstantPositionProperty(oblCart),
      label: {
        text: 'ε = 23.44° (Earth axial tilt)',
        font: 'bold 10px JetBrains Mono',
        fillColor: Cesium.Color.WHITE.withAlpha(0.85),
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
        backgroundPadding: new Cesium.Cartesian2(4, 2),
      }
    }));
  }

  // ── Equinox labels ────────────────────────────────────────────────────────
  const vernal    = icrfToEcef(1.05, 0, 0);   // RA=0h, Dec=0
  const autumnal  = icrfToEcef(-1.05, 0, 0);  // RA=12h, Dec=0

  [
    { cart: vernal,   text: '♈ Vernal Equinox\nRA 0h / λ 0°',   col: '#00e5ff' },
    { cart: autumnal, text: '♎ Autumnal Equinox\nRA 12h / λ 180°', col: '#00e5ff' },
  ].forEach(({ cart, text, col }) => {
    planeEntities.push(viewer.entities.add({
      _isRefPlane: true,
      position: new Cesium.ConstantPositionProperty(cart),
      label: {
        text,
        font: '9px JetBrains Mono',
        fillColor: Cesium.Color.fromCssColorString(col).withAlpha(0.90),
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
        backgroundPadding: new Cesium.Cartesian2(5, 3),
      }
    }));
  });

  // ── Plane legend labels on rims ───────────────────────────────────────────
  // Label equatorial rim at RA=3h (upper right when N is up)
  const eqLabelCart = icrfToEcef(
    Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), 0
  );
  planeEntities.push(viewer.entities.add({
    _isRefPlane: true,
    position: new Cesium.ConstantPositionProperty(eqLabelCart),
    label: {
      text: 'CELESTIAL\nEQUATOR',
      font: 'bold 9px JetBrains Mono',
      fillColor: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.90),
      outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#001a26').withAlpha(0.80),
      backgroundPadding: new Cesium.Cartesian2(5, 3),
    }
  }));

  // Label ecliptic rim at ecliptic lon=135° (tilted)
  const eclAngle  = 135 * Math.PI / 180;
  const eclLabelCart = icrfToEcef(
    Math.cos(eclAngle),
    Math.sin(eclAngle) * Math.cos(OBLIQUITY),
    Math.sin(eclAngle) * Math.sin(OBLIQUITY)
  );
  planeEntities.push(viewer.entities.add({
    _isRefPlane: true,
    position: new Cesium.ConstantPositionProperty(eclLabelCart),
    label: {
      text: 'ECLIPTIC\nPLANE',
      font: 'bold 9px JetBrains Mono',
      fillColor: Cesium.Color.fromCssColorString('#ffc040').withAlpha(0.90),
      outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#1a0e00').withAlpha(0.80),
      backgroundPadding: new Cesium.Cartesian2(5, 3),
    }
  }));
}

// planeEntities replaces the old refPlaneEntity single-entity pattern

// ── Orbital rings ──────────────────────────────────────────────────────
const ORBIT_RADII_AU = {
  mercury: 0.387, venus: 0.723, earth: 1.000, mars: 1.524,
  jupiter: 5.203, saturn: 9.537, uranus: 19.19, neptune: 30.07, pluto: 39.48,
};
const ORBIT_COLOURS = {
  mercury: '#b0a080', venus: '#ffe090', earth: '#4a8fd0', mars: '#c06040',
  jupiter: '#c8a870', saturn: '#e0c870', uranus: '#a0e0f0', neptune: '#6080f0',
  pluto:   '#c0b090',
};

function buildOrbits() {
  Object.values(orbitPlanetEntities).forEach(e => viewer.entities.remove(e));
  orbitPlanetEntities = {};
  if (!showOrbits) return;

  const STEPS = 180;
  const S = 1.0 / 1000.0;  // same scale as body rendering

  Object.entries(ORBIT_RADII_AU).forEach(([id, auR]) => {
    const rM  = auR * AU * S;
    const pts = [];
    for (let i = 0; i <= STEPS; i++) {
      const theta = (i / STEPS) * 2 * Math.PI;
      pts.push(new Cesium.Cartesian3(rM * Math.cos(theta), rM * Math.sin(theta), 0));
    }
    orbitPlanetEntities[id] = viewer.entities.add({
      polyline: {
        positions: pts,
        width: 0.8,
        material: Cesium.Color.fromCssColorString(ORBIT_COLOURS[id] || '#444').withAlpha(0.35),
        arcType: Cesium.ArcType.NONE,
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
// HUD
// ═══════════════════════════════════════════════════════════════════════
function updateHUD(fc) {
  const meta  = MODE_META[activeMode];
  const rows  = document.getElementById('cosmo-hud-rows');
  let html = '';

  const row = (k, v, accent = false) =>
    `<div class="hud-row">
      <span class="hud-key">${k}</span>
      <span class="hud-val${accent?' accent':''}">${v ?? '—'}</span>
    </div>`;

  html += row('UTC',  fc.epochUtc?.substring(0,19).replace('T',' '), true);
  html += row('JD',   fc.jd?.toFixed(5));
  html += `<div class="hud-row" style="border-bottom:1px solid rgba(255,255,255,.1);margin:4px 0;"></div>`;

  if (activeMode === 1) {
    html += row('Frame',  meta.frame, true);
    html += row('Coords', meta.coords);
    html += row('GMST',   fc.gmstDeg?.toFixed(4) + '°');
    html += row('GAST',   fc.gastDeg?.toFixed(4) + '°');
    html += row('LST',    fc.lstDeg?.toFixed(4)  + '°');
    html += row('ERA',    ((fc.eraRad ?? 0) * 180 / Math.PI).toFixed(4) + '°');
  } else if (activeMode === 2) {
    html += row('Frame',     meta.frame, true);
    html += row('Coords',    'λ  β (ecliptic)');
    html += row('Obliquity', fc.obliquityDeg?.toFixed(4) + '°');
    html += row('Sun λ',     fc.sunEclLonDeg?.toFixed(4) + '°');
    html += row('Season',    fc.season, true);
    html += row('Earth→Sun', fc.earthDistAu?.toFixed(6) + ' AU');
  } else if (activeMode === 3) {
    html += row('Frame',     meta.frame, true);
    html += row('Coords',    'RA / Dec (from Sun)');
    html += row('Earth λ',   fc.earthHelioLonDeg?.toFixed(4) + '°');
    html += row('Earth β',   fc.earthHelioLatDeg?.toFixed(4) + '°');
    html += row('Earth v',   fc.earthVelKms?.toFixed(3) + ' km/s');
    html += row('1 AU =',    '1.496 × 10¹¹ m');
  } else if (activeMode === 4) {
    html += row('Frame',     meta.frame, true);
    html += row('Coords',    'λ  β (heliocentric)');
    html += row('Earth λ',   fc.earthHelioLonDeg?.toFixed(4) + '°');
    html += row('Earth dist',fc.earthDistAu?.toFixed(6) + ' AU');
    html += row('Season',    fc.season);
    html += row('Obliquity', fc.obliquityDeg?.toFixed(4) + '°');
  }

  rows.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════
// ORIENTATION WIDGET
// ═══════════════════════════════════════════════════════════════════════
const owCanvas  = document.getElementById('orient-canvas');
const owCtx     = owCanvas.getContext('2d');
const owCanvas2 = document.getElementById('orient-canvas-lp');
const owCtx2    = owCanvas2 ? owCanvas2.getContext('2d') : null;
const W = 100, H = 100, cx = 50, cy = 50;

function updateOrientWidget(fc) {
  const meta = MODE_META[activeMode];
  owCtx.clearRect(0, 0, W, H);

  // Background
  owCtx.fillStyle = 'rgba(4,8,15,0)';
  owCtx.fillRect(0, 0, W, H);

  // Draw XYZ axes
  const axes = [
    { dir: [1, 0, 0], col: '#ff4040', label: 'X' },
    { dir: [0, 1, 0], col: '#40ff40', label: 'Y' },
    { dir: [0, 0, 1], col: '#4040ff', label: 'Z' },
  ];

  // Apply a simple isometric projection
  const angle = Date.now() / 6000;
  axes.forEach(ax => {
    const [dx, dy, dz] = ax.dir;
    const px = dx * Math.cos(angle) - dy * Math.sin(angle);
    const py = dx * Math.sin(angle) * 0.5 + dy * Math.cos(angle) * 0.5 - dz * 0.7;
    const len = 30;
    owCtx.strokeStyle = ax.col;
    owCtx.lineWidth = 2;
    owCtx.beginPath();
    owCtx.moveTo(cx, cy);
    owCtx.lineTo(cx + px * len, cy + py * len);
    owCtx.stroke();
    owCtx.fillStyle = ax.col;
    owCtx.font = 'bold 9px JetBrains Mono';
    owCtx.fillText(ax.label, cx + px * (len + 5) - 3, cy + py * (len + 5) + 3);
  });

  // Centre dot
  owCtx.beginPath();
  owCtx.arc(cx, cy, 3, 0, 2 * Math.PI);
  owCtx.fillStyle = meta.accent;
  owCtx.fill();

  // Animate continuously
  requestAnimationFrame(() => { if (latestSnap) updateOrientWidget(latestSnap?.frameContext); });

  // Update text
  document.getElementById('ow-frame').textContent  = `Frame: ${meta.frame}`;
  // Update the panel badge to match active mode
  const rfBadge = document.getElementById('rf-mode-badge');
  if (rfBadge) { rfBadge.textContent = meta.name || 'GNSS'; rfBadge.style.color = meta.accent || '#00e5ff'; }
  document.getElementById('ow-origin').textContent = `Origin: ${meta.origin}`;
  document.getElementById('ow-epoch').textContent  =
    fc?.epochUtc?.substring(0, 10) ?? '—';

  // ── Mirror axes to left panel FRAME tab ──────────────────────────────
  // Draw independently (don't rely on drawImage from hidden canvas)
  if (owCtx2 && owCanvas2) {
    const W2 = owCanvas2.width, H2 = owCanvas2.height;
    const cx2 = W2/2, cy2 = H2/2;
    owCtx2.clearRect(0, 0, W2, H2);
    const angle2 = Date.now() / 6000;
    const axes2 = [
      { v:[1,0,0], col:'#ff4444', label:'X' },
      { v:[0,1,0], col:'#44ff44', label:'Y' },
      { v:[0,0,1], col:'#4488ff', label:'Z' },
    ];
    const len2 = 32;
    axes2.forEach(ax => {
      const cosA = Math.cos(angle2), sinA = Math.sin(angle2);
      const cosB = Math.cos(angle2*0.7), sinB = Math.sin(angle2*0.7);
      const [vx,vy,vz] = ax.v;
      const rx = vx*cosA - vy*sinA;
      const ry = vx*sinA + vy*cosA;
      const rz = vz;
      const rx2= rx*cosB + rz*sinB;
      const rz2=-rx*sinB + rz*cosB;
      const px = rx2, py = ry - rz2*0.5;
      owCtx2.strokeStyle = ax.col;
      owCtx2.lineWidth = 2.5;
      owCtx2.beginPath();
      owCtx2.moveTo(cx2, cy2);
      owCtx2.lineTo(cx2 + px*len2, cy2 + py*len2);
      owCtx2.stroke();
      owCtx2.fillStyle = ax.col;
      owCtx2.font = 'bold 9px JetBrains Mono';
      owCtx2.fillText(ax.label, cx2 + px*(len2+5)-3, cy2 + py*(len2+5)+3);
    });
    // Update text labels in FRAME tab
    const lpFrame  = document.getElementById('ow-frame-lp');
    const lpOrigin = document.getElementById('ow-origin-lp');
    const lpEpoch  = document.getElementById('ow-epoch-lp');
    if (lpFrame)  lpFrame.textContent  = `Frame: ${meta.frame}`;
    if (lpOrigin) lpOrigin.textContent = `Origin: ${meta.origin}`;
    if (lpEpoch)  lpEpoch.textContent  = fc?.epochUtc?.substring(0,10) ?? '—';
  }

  // ── Camera viewpoint in FRAME tab ────────────────────────────────────
  // Show current camera position in the active coordinate system
  updateFrameTabCamera(meta, fc);
}

function updateFrameTabCamera(meta, fc) {
  const cam = viewer.camera;
  const pos = cam.positionWC; // world-space Cartesian3
  const container = document.getElementById('frame-camera-coords');
  if (!container) return;
  const accent = meta.accent || '#00e5ff';
  const fmt = v => (v >= 0 ? '+' : '') + (v/1000).toFixed(0) + ' km';
  const fmtAU = v => (v/1.496e11).toFixed(6) + ' AU';
  const alt = (cam.positionCartographic?.height/1000)?.toFixed(1) ?? '--';
  let rows = '';
  if (activeFrameMode === 0 || activeFrameMode <= 2) {
    rows = `
      <div class="frame-row"><span class="frame-key">Camera X</span><span class="frame-val" style="color:${accent}">${fmt(pos.x)}</span></div>
      <div class="frame-row"><span class="frame-key">Camera Y</span><span class="frame-val" style="color:${accent}">${fmt(pos.y)}</span></div>
      <div class="frame-row"><span class="frame-key">Camera Z</span><span class="frame-val" style="color:${accent}">${fmt(pos.z)}</span></div>
      <div class="frame-row"><span class="frame-key">Alt MSL</span><span class="frame-val" style="color:${accent}">${alt} km</span></div>
    `;
  } else {
    // Heliocentric — camera is offset from Sun at rendered scale (÷1000 from real)
    const S = 1000; // reverse the 1/1000 render scale
    rows = `
      <div class="frame-row"><span class="frame-key">Camera X</span><span class="frame-val" style="color:${accent}">${fmtAU(pos.x*S)}</span></div>
      <div class="frame-row"><span class="frame-key">Camera Y</span><span class="frame-val" style="color:${accent}">${fmtAU(pos.y*S)}</span></div>
      <div class="frame-row"><span class="frame-key">Camera Z</span><span class="frame-val" style="color:${accent}">${fmtAU(pos.z*S)}</span></div>
      <div class="frame-row"><span class="frame-key">Dist Sun</span><span class="frame-val" style="color:${accent}">${fmtAU(Math.sqrt(pos.x*pos.x+pos.y*pos.y+pos.z*pos.z)*S)}</span></div>
    `;
  }
  container.innerHTML = rows;
}

// Self-animating widget
(function animateWidget() {
  if (latestSnap?.frameContext) updateOrientWidget(latestSnap.frameContext);
  else { owCtx.clearRect(0,0,W,H); setTimeout(animateWidget, 200); }
})();

// ═══════════════════════════════════════════════════════════════════════
// TOGGLE HANDLERS
// ═══════════════════════════════════════════════════════════════════════
function toggleGrid() {
  showGrid = !showGrid;
  document.getElementById('btn-grid').classList.toggle('on', showGrid);
  gridEntities.forEach(e => { e.show = showGrid; });
  if (showGrid) buildGrid();
}

function toggleGraticule() {
  graticuleVisible = !graticuleVisible;
  document.getElementById('btn-graticule').classList.toggle('on', graticuleVisible);
  const geoMode = activeMode <= 2;
  graticuleEntities.forEach(e => { e.show = graticuleVisible && geoMode; });
}


function toggleLabels() {
  showLabels = !showLabels;
  document.getElementById('btn-labels').classList.toggle('on', showLabels);
  Object.values(bodyEntities).forEach(b => {
    if (b.entity.label) b.entity.label.show = showLabels;
  });
}

function toggleOrbits() {
  showOrbits = !showOrbits;
  document.getElementById('btn-orbits').classList.toggle('on', showOrbits);
  if (showOrbits) buildOrbits();
  else { Object.values(orbitPlanetEntities).forEach(e => viewer.entities.remove(e)); orbitPlanetEntities = {}; }
}

function toggleEcliptic() {
  showRefPlane = !showRefPlane;
  document.getElementById('btn-ecliptic').classList.toggle('on', showRefPlane);
  if (showRefPlane) {
    buildRefPlane();
  } else {
    planeEntities.forEach(e => viewer.entities.remove(e));
    planeEntities = [];
  }
}

function toggleObsPanel() {
  document.getElementById('obs-panel').classList.toggle('visible');
}

function applyObserver() {
  const lat  = parseFloat(document.getElementById('obs-lat').value);
  const lon  = parseFloat(document.getElementById('obs-lon').value);
  const alt  = parseFloat(document.getElementById('obs-alt').value) || 0;
  const city = document.getElementById('obs-city').value;
  fetch(`/api/observer?lat=${lat}&lon=${lon}&alt=${alt}&city=${encodeURIComponent(city)}`,
    { method: 'PUT' }).catch(console.warn);
  document.getElementById('obs-panel').classList.remove('visible');
}

function requestBrowserGeo() {
  if (!navigator.geolocation) { alert('Geolocation not supported'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lon, altitude: alt } = pos.coords;
    fetch(`/api/observer/geo?lat=${lat}&lon=${lon}&alt=${alt||0}`, { method: 'POST' })
      .catch(console.warn);
    // Update observer inputs if panel exists
    const _ol = document.getElementById('obs-lat');
    const _on = document.getElementById('obs-lon');
    const _oa = document.getElementById('obs-alt');
    if (_ol) _ol.value = lat.toFixed(6);
    if (_on) _on.value = lon.toFixed(6);
    if (alt && _oa) _oa.value = Math.round(alt);
  }, err => alert('Geolocation failed: ' + err.message));
}

// ═══════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════
// Rebuild grid on GMST change (every ~4 seconds grid drifts noticeably)
let _lastGmst = null;
viewer.scene.postRender.addEventListener(() => {
  if (!latestSnap?.frameContext) return;
  if (activeFrameMode === 0) return;  // GNSS mode — no celestial grid rebuild needed
  const gmst = latestSnap.frameContext.gmstDeg;
  if (_lastGmst === null || Math.abs(gmst - _lastGmst) > 0.05) {
    _lastGmst = gmst;
    buildGrid();
    if (showRefPlane) {
      planeEntities.forEach(e => viewer.entities.remove(e));
      planeEntities = [];
      buildRefPlane();
    }
  }
});

// Set initial HUD accent
// accent set after MODE_META is defined

// COSMO grid/plane/axis only built when switching to frame modes 1-4
// (not at startup in GNSS mode 0)
// buildGrid(); buildRefPlane(); buildEarthAxis(); — called by switchFrameMode()

// Request browser geolocation on load (silent if denied)
setTimeout(requestBrowserGeo, 1500);

// Start SSE
connectSSE();

console.log('%cCOSMOFRAME READY', 'color:#00e5ff;font-weight:bold;font-size:16px;letter-spacing:4px');


// ════════════════════════════════════════════════════════════════════════════
// UNIFIED SSE + SCALE SYSTEM
// ════════════════════════════════════════════════════════════════════════════


function connectSSE() {
  const es = new EventSource('/api/stream');
  es.addEventListener('starmap', e => {
    try {
      const snap = JSON.parse(e.data);
      latestStarmapSnap = snap;
      handleStarmapSnapshot(snap);
    } catch(err) { console.warn('SSE parse error', err); }
  });
  es.onerror = () => setTimeout(connectSSE, 3000);
}

function handleStarmapSnapshot(snap) {
  if (!snap) return;

  // GNSS layer — uses GNSS Tracker's existing handleSnapshot internals
  if (snap.position) {
    latestPos = snap.position;
    updatePositionTab(snap.position);
    updateLiveMarker(snap.position);
    if (recording) appendTrackPoint(snap.position);
    // On first valid GPS fix, smoothly centre observer at viewport centre
    if (snap.position.fixQuality > 0 && !window._initialFlyDone && activeFrameMode === 0) {
      window._initialFlyDone = true;
      const target = Cesium.Cartesian3.fromDegrees(
        snap.position.longitude, snap.position.latitude, 0);
      // flyToBoundingSphere gives a smooth animated zoom-in to nadir view
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(target, 10_000_000),
        {
          duration: 2.0,
          offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), 0),
          complete: () => {
            viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
          }
        }
      );
    }
  }
  if (snap.gpsUtc) {
    try { viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(snap.gpsUtc); } catch(_) {}
    document.getElementById('utc-clock').textContent = snap.gpsUtc.substring(11,19) + ' UTC';
  }
  if (snap.satellites) {
    latestSats = snap.satellites;
    latestSatsMap = {};
    snap.satellites.forEach(s => { latestSatsMap[s.prn] = s; });
    const ggaUsed = snap.position ? snap.position.satellitesUsed : null;
    updateSkyTab(snap.satellites, ggaUsed);
  }
  if (snap.recentTrack) updateTrackTab(snap.recentTrack);
  if (snap.frameInspector) { frameData = snap.frameInspector; updateFrameTab(snap.frameInspector); }
  if (snap.trackedSats && snap.trackedSats.length) {
    window._lastTrackedSats = snap.trackedSats;
    // Only render artificial satellites in GNSS/geocentric modes —
    // in heliocentric modes they are indistinguishably close to Earth
    // and are scientifically meaningless at solar-system scale.
    if (activeFrameMode <= 2) {
      handleTrackedSats(snap.trackedSats);
    }
  }

  // GPS status badge
  const online = snap.position && snap.position.fixQuality > 0;
  const badge = document.getElementById('live-badge');
  if (badge) {
    badge.textContent = online ? '● LIVE GPS' : '● NO FIX';
    badge.className   = online ? 'badge-live' : 'badge-nofix';
  }

  // Cosmic layer
  if (snap.bodies) {
    window._bodies = snap.bodies;
    window._lastBodiesById = {};
    snap.bodies.forEach(b => { window._lastBodiesById[b.id] = b; });
    if (activeFrameMode > 0) renderBodies(snap.bodies);
    else hideCelestialBodies();
  }
  if (snap.frameContext) {
    window._lastFrameContext = snap.frameContext;
    updateCosmoHUD(snap.frameContext);
    updateOrientWidget(snap.frameContext);
    updateActiveFrameCoords(snap);
  } else {
    // GNSS mode: update orient widget with static WGS-84 frame info
    updateOrientWidget(null);
  }
  if (snap.observer) {
    window._latestObserver = snap.observer;
    const od = document.getElementById('observer-display');
    if (od) od.textContent = `⊕ ${snap.observer.city||''}  ${snap.observer.latDeg?.toFixed(3)}°N  ${snap.observer.lonDeg?.toFixed(3)}°E`;
  }
  if (snap.position && snap.position.fixQuality > 0) {
    window._latestObserver = window._latestObserver || {};
    window._latestObserver.latDeg = snap.position.latitude;
    window._latestObserver.lonDeg = snap.position.longitude;
    window._latestObserver.altM   = snap.position.altitude;
  }
}

function switchFrameMode(newMode) {
  const old = activeFrameMode;
  activeFrameMode = newMode;
  document.querySelectorAll('.frame-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-fm${newMode}`).classList.add('active');

  const meta = FRAME_META[newMode];
  const hud  = document.getElementById('cosmo-hud');
  const ow   = document.getElementById('orient-widget');
  if (hud) {
    hud.style.setProperty('--frame-accent-color', meta.accent);
    document.getElementById('cosmo-hud-title').textContent = `FRAME: ${meta.name.toUpperCase()}`;
  }

  const isGnss = newMode === 0;
  const isGeo  = newMode <= 2;

  const rp = document.getElementById('right-panel');
  if (rp) rp.style.display = '';  // always visible in all modes
  if (hud) hud.classList.toggle('visible', !isGnss);
  // orient-widget is now in the right panel — always visible

  scene.globe.show         = isGeo;
  scene.skyAtmosphere.show = isGeo;

  clearBodyEntities && clearBodyEntities();
  if (typeof gridEntities !== 'undefined') { gridEntities.forEach(e => viewer.entities.remove(e)); gridEntities = []; }

  if (!isGnss) {
    activeMode = newMode;
    // Heliocentric modes: remove all artificial satellite entities entirely.
    // GPS constellation, ISS, ground tracks are within metres of Earth at AU
    // scale — scientifically meaningless and visually cluttering.
    if (newMode >= 3) {
      // Clear GPS 3D constellation entities by triggering the disable path
      gpsSatEntities.forEach(e => viewer.entities.remove(e));
      orbitEntities.forEach(e  => viewer.entities.remove(e));
      linkEntities.forEach(e   => viewer.entities.remove(e));
      if (typeof coneEntity !== 'undefined' && coneEntity) {
        viewer.entities.remove(coneEntity); coneEntity = null;
      }
      gpsSatEntities = []; orbitEntities = []; linkEntities = [];
      // Hide observer marker and trail
      [liveMarker, trailEntity].forEach(e => { if(e) e.show = false; });
      // Hide all tracked satellite entities (ISS etc.) and their ground tracks
      Object.values(satRegistry || {}).forEach(reg => {
        if (reg.entity)        reg.entity.show = false;
        if (reg.trackEntities) reg.trackEntities.forEach(e => { if(e) e.show = false; });
        if (reg.footEntity)    reg.footEntity.show = false;
        if (reg.footOutline)   reg.footOutline.show = false;
      });
      if (typeof issEntity !== 'undefined' && issEntity) issEntity.show = false;
    } else if (newMode < 3) {
      // Returning to geocentric/GNSS: restore artificial satellites
      if (liveMarker) liveMarker.show = gpsDisplayEnabled;
      if (trailEntity) trailEntity.show = gpsDisplayEnabled;
      Object.values(satRegistry || {}).forEach(reg => {
        if (reg.entity) reg.entity.show = true;
        if (reg.trackEntities) reg.trackEntities.forEach(e => { if(e) e.show = true; });
        if (reg.footEntity)    reg.footEntity.show = true;
        if (reg.footOutline)   reg.footOutline.show = true;
      });
      if (typeof issEntity !== 'undefined' && issEntity) issEntity.show = true;
      // Rebuild 3D constellation for the new geocentric view
      update3DConstellation(Date.now());
    }
    animateModeTransition(old > 0 ? old : 1, newMode, () => {
      buildGrid && buildGrid();
      buildRefPlane && buildRefPlane();
      buildEarthAxis && buildEarthAxis();
      if (latestStarmapSnap?.bodies) renderBodies(latestStarmapSnap.bodies);
    });
  } else {
    activeMode = 1;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    const obs = window._latestObserver;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(obs?.lonDeg||72.9133, obs?.latDeg||19.1334, 2.5e7),
      orientation: { heading:0, pitch: Cesium.Math.toRadians(-60), roll:0 }
    });
  }
}

function hideCelestialBodies() {
  if (typeof bodyEntities === 'undefined') return;
  Object.values(bodyEntities).forEach(b => { if (b.entity) b.entity.show = false; });
  ['sunOriginEntity','sunHaloEntity','moonOriginEntity','moonHaloEntity'].forEach(v => {
    if (typeof window[v] !== 'undefined' && window[v]) window[v].show = false;
  });
}

function onScaleSlider(value) {
  const v = parseFloat(value);
  currentScaleValue = v;
  const zone = SCALE_ZONES.find(z => v >= z.min && v <= z.max) || SCALE_ZONES[0];
  document.getElementById('scale-label').textContent = zone.label;

  if (v <= 25 && activeFrameMode !== 0) { switchFrameMode(0); return; }
  if (v > 25 && zone.frame > 0 && activeFrameMode !== zone.frame) switchFrameMode(zone.frame);

  // Hide artificial satellites beyond GNSS zone — meaningless at Earth-Moon scale and beyond
  const showSats = v <= 25;
  gpsSatEntities.forEach(e => viewer.entities.remove(e));
  orbitEntities.forEach(e  => viewer.entities.remove(e));
  linkEntities.forEach(e   => viewer.entities.remove(e));
  gpsSatEntities = []; orbitEntities = []; linkEntities = [];
  if (showSats) {
    update3DConstellation(Date.now());
  }
  Object.values(satRegistry || {}).forEach(reg => {
    if (reg.entity)        reg.entity.show        = showSats;
    if (reg.trackEntities) reg.trackEntities.forEach(e => { if(e) e.show = showSats; });
    if (reg.footEntity)    reg.footEntity.show    = showSats;
    if (reg.footOutline)   reg.footOutline.show   = showSats;
  });
  if (typeof issEntity !== 'undefined' && issEntity) issEntity.show = showSats;
  if (liveMarker)  liveMarker.show  = showSats && gpsDisplayEnabled;

  const obs  = window._latestObserver;
  const lon  = obs?.lonDeg || 72.9133;
  const lat  = obs?.latDeg || 19.1334;

  if (activeFrameMode >= 3) {
    const offset = new Cesium.Cartesian3(0, -zone.dist, zone.dist * 0.4);
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY, offset);
  } else {
    viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, zone.dist), duration: 0.6 });
  }
}

function updateCosmoHUD(fc) {
  const mode = activeFrameMode;
  if (mode === 0) return;
  const rows = document.getElementById('cosmo-hud-rows');
  if (!rows) return;
  const row = (k,v,a=false) =>
    `<div class="hud-row"><span class="hud-key">${k}</span><span class="hud-val${a?' accent':''}">${v??'—'}</span></div>`;
  let html = row('UTC', fc.epochUtc?.substring(0,19).replace('T',' '), true);
  html += row('JD', fc.jd?.toFixed(5));
  if (mode===1) {
    html += row('GMST', fc.gmstDeg?.toFixed(4)+'°');
    html += row('GAST', fc.gastDeg?.toFixed(4)+'°');
    html += row('LST',  fc.lstDeg?.toFixed(4)+'°');
  } else if (mode===2) {
    html += row('Obliquity', fc.obliquityDeg?.toFixed(4)+'°');
    html += row('Sun λ', fc.sunEclLonDeg?.toFixed(4)+'°');
    html += row('Season', fc.season, true);
    html += row('Earth dist', fc.earthDistAu?.toFixed(6)+' AU');
  } else {
    html += row('Earth λ', fc.earthHelioLonDeg?.toFixed(4)+'°');
    html += row('Earth dist', fc.earthDistAu?.toFixed(6)+' AU');
    html += row('Earth v', fc.earthVelKms?.toFixed(3)+' km/s');
    html += row('Season', fc.season);
  }
  rows.innerHTML = html;
}

// Initial setup
document.getElementById('btn-fm0').classList.add('active');
syncGlobeBounds(); // set initial cesiumContainer/topbar bounds
viewer.clock.clockStep     = Cesium.ClockStep.SYSTEM_CLOCK;
viewer.clock.shouldAnimate = true;
// Build celestial grid immediately — visible in all modes from the very first frame
buildGrid();
document.getElementById('btn-grid')?.classList.add('on');
connectSSE();
updateSigGrid([]);
console.log('%cSTARMAP READY', 'color:#00e5ff;font-weight:bold;font-size:18px;letter-spacing:4px');

