/**
 * STARMAP Live Demo Recorder
 * Drives localhost:8080, captures 30fps screenshots, pipes to ffmpeg → MP4
 *
 * Prerequisites:
 *   npm install puppeteer
 *   winget install Gyan.FFmpeg   (then open a NEW terminal)
 *   STARMAP running: mvn spring-boot:run
 *
 * Run: node starmap-puppeteer.js
 */

'use strict';

const puppeteer  = require('puppeteer');
const { spawn }  = require('child_process');
const { execSync } = require('child_process');
const http       = require('http');
const path       = require('path');
const fs         = require('fs');

// ── Config ────────────────────────────────────────────────────────────────
const URL      = 'http://localhost:8080';
const WIDTH    = 1920;
const HEIGHT   = 1080;
const FPS      = 30;
const OUT_DIR  = path.join(__dirname, 'out');
const OUT_FILE = path.join(OUT_DIR, 'starmap-live-demo.mp4');

const SEG = {
  GNSS:         { s: 30, label: 'GNSS Mode — live GPS + ISS' },
  NIGHT_LIGHTS: { s: 20, label: 'Night Lights — NASA Black Marble' },
  ISS_FLY:      { s: 20, label: 'Fly With ISS' },
  GEO_EQ:       { s: 30, label: 'Geocentric Equatorial frame' },
  GEO_ECL:      { s: 20, label: 'Geocentric Ecliptic frame' },
  HELIO_EQ:     { s: 40, label: 'Heliocentric Solar System' },
  SCALE_SLIDE:  { s: 20, label: 'Scale Slider zoom-out' },
  SKY_VIEW:     { s: 20, label: 'Sky View — first-person horizon' },
  RETURN_GNSS:  { s: 20, label: 'Return to GNSS' },
};
const TOTAL_S = Object.values(SEG).reduce((a, b) => a + b.s, 0);

// ── Helpers ───────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── ffmpeg detection ──────────────────────────────────────────────────────
function findFfmpeg() {
  const candidates = [
    'ffmpeg',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft', 'WinGet', 'Packages',
      'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
      'ffmpeg-7.1-full_build', 'bin', 'ffmpeg.exe'
    ),
    path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft', 'WinGet', 'Packages',
      'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
      'ffmpeg-7.0.2-full_build', 'bin', 'ffmpeg.exe'
    ),
  ];
  for (const c of candidates) {
    try { execSync(`"${c}" -version`, { stdio: 'ignore' }); return c; }
    catch (_) {}
  }
  return null;
}

// ── ffmpeg process ─────────────────────────────────────────────────────────
let ffmpegProc = null;
let frameCount = 0;

function startFfmpeg(ffmpegPath) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`🎬  Output: ${OUT_FILE}`);
  ffmpegProc = spawn(ffmpegPath, [
    '-y',
    '-f',        'image2pipe',
    '-framerate', String(FPS),
    '-i',        'pipe:0',
    '-vcodec',   'libx264',
    '-preset',   'fast',
    '-crf',      '18',
    '-pix_fmt',  'yuv420p',
    '-movflags', '+faststart',
    OUT_FILE,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  ffmpegProc.on('error', err => console.error('\n❌  ffmpeg error:', err.message));
  ffmpegProc.on('close', code =>
    console.log(code === 0
      ? `\n✅  Render complete → ${OUT_FILE}`
      : `\n❌  ffmpeg exited ${code}`));
}

async function captureFrames(page, durationSecs, label) {
  const count    = Math.round(durationSecs * FPS);
  const interval = 1000 / FPS;
  console.log(`  📸  ${count} frames @ ${FPS}fps — ${label}`);
  for (let i = 0; i < count; i++) {
    const t0 = Date.now();
    try {
      const buf = await Promise.race([
        page.screenshot({ type: 'jpeg', quality: 90 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('shot timeout')), 5000)),
      ]);
      ffmpegProc.stdin.write(buf);
      frameCount++;
    } catch (e) {
      // On timeout, duplicate the last frame by writing a blank wait
      // so ffmpeg doesn't get an unexpected gap — just log and continue
      console.warn(`\n  ⚠  Frame ${i} timeout in "${label}" — skipping`);
    }
    if (frameCount % (FPS * 5) === 0)
      process.stdout.write(`\r  ⏱  ${Math.round(frameCount/FPS)}s / ${TOTAL_S}s`);
    const wait = Math.max(0, interval - (Date.now() - t0));
    if (wait > 0) await sleep(wait);
  }
}

// ── Page interaction ──────────────────────────────────────────────────────
async function click(page, selector, label) {
  // Direct DOM click — bypasses Puppeteer visibility checks for panel buttons
  const ok = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  console.log(ok ? `  🖱  ${label}` : `  ⚠  Not found: ${label}`);
  await sleep(700);
}

async function openTab(page, tabId, label) {
  await page.evaluate(id => {
    const el = document.getElementById(id);
    if (el) el.click();
  }, tabId);
  console.log(`  📂  Tab: ${label}`);
  await sleep(500);
}

async function ensureLeftPanel(page) {
  await page.evaluate(() => {
    const p = document.getElementById('left-panel');
    if (p && p.classList.contains('collapsed')) {
      const t = document.getElementById('left-panel-toggle');
      if (t) t.click();
    }
  });
  await sleep(350);
}

async function recentre(page, waitMs = 3000) {
  await page.evaluate(() => {
    if (typeof recentreView === 'function') recentreView();
  });
  console.log('  📍  Recentred');
  await sleep(waitMs);
}

async function waitForGpsFix(page, timeoutMs = 90000) {
  console.log('⏳  Waiting for GPS FIX...');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => {
      const b = document.getElementById('fix-badge');
      return b && b.textContent.includes('FIX');
    });
    if (ok) { console.log('✅  GPS FIX acquired'); return true; }
    await sleep(1000);
  }
  console.warn('⚠  GPS FIX timeout — continuing (simulate mode?)');
  return false;
}

async function dragScaleSlider(page) {
  const slider = await page.$('#scale-slider');
  if (!slider) { console.warn('  ⚠  Scale slider not found'); return; }
  const box  = await slider.boundingBox();
  const cy   = box.y + box.height / 2;
  const left = box.x + 4;
  const right= box.x + box.width - 4;
  await page.mouse.move((left + right) / 2, cy);
  await page.mouse.down();
  for (let i = 0; i <= 40; i++) {
    await page.mouse.move(left + (right - left) * (i / 40), cy);
    await sleep(200);
  }
  await sleep(1500);
  for (let i = 40; i >= 0; i--) {
    await page.mouse.move(left + (right - left) * (i / 40), cy);
    await sleep(150);
  }
  await page.mouse.up();
  console.log('  🎚  Scale slider dragged');
  await sleep(800);
}

// ── Main ──────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n🚀  STARMAP Live Demo Recorder');
  console.log(`    ${TOTAL_S}s · ${TOTAL_S * FPS} frames · ${FPS}fps · ${WIDTH}×${HEIGHT}\n`);

  // 1. Check STARMAP is running
  await new Promise((resolve, reject) => {
    const req = http.get(URL, res => {
      console.log(`✅  STARMAP running (HTTP ${res.statusCode})`);
      resolve();
    });
    req.on('error', () => reject(new Error(
      `\n❌  Cannot reach ${URL}\n    Start STARMAP first: mvn spring-boot:run\n`
    )));
    req.setTimeout(5000, () => reject(new Error('Connection timed out')));
  });

  // 2. Check ffmpeg
  const ffmpegPath = findFfmpeg();
  if (!ffmpegPath) {
    console.error(`
❌  ffmpeg not found. Install with:
    winget install Gyan.FFmpeg
    (then open a NEW terminal and re-run)
`);
    process.exit(1);
  }
  console.log(`✅  ffmpeg: ${ffmpegPath}`);

  // 3. Launch browser
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: WIDTH, height: HEIGHT },
    protocolTimeout: 120000,   // 2 min — prevents screenshot timeout in heavy scenes
    args: [
      `--window-size=${WIDTH},${HEIGHT}`,
      '--window-position=0,0',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--force-device-scale-factor=1',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  // Force exact window bounds via CDP
  try {
    const session = await page.target().createCDPSession();
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: 0, top: 0, width: WIDTH, height: HEIGHT, windowState: 'normal' },
    });
  } catch (_) { /* CDP window sizing optional */ }

  // 4. Navigate
  console.log(`🌐  Navigating to ${URL}...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('⏳  Waiting for Cesium canvas...');
  try {
    await page.waitForSelector('#cesiumContainer canvas', { timeout: 60000 });
    console.log('✅  Cesium canvas ready');
  } catch (_) { console.warn('⚠  Cesium canvas timeout — continuing'); }
  await sleep(5000);

  // 5. Wait for GPS fix then set up clean initial state
  await waitForGpsFix(page);
  await sleep(2000);
  await page.evaluate(() => { if (typeof switchFrameMode === 'function') switchFrameMode(0); });
  await sleep(800);
  await recentre(page, 4000);
  await ensureLeftPanel(page);

  // 6. Start ffmpeg
  startFfmpeg(ffmpegPath);

  // ── SEGMENT 1: GNSS (30s) ─────────────────────────────────────────────
  console.log('\n🛰  SEGMENT 1: GNSS Mode');
  await click(page, '#btn-fm0', 'GNSS mode');
  await ensureLeftPanel(page);
  await openTab(page, 'lpt-view', 'VIEW tab');
  await recentre(page, 3000);
  await captureFrames(page, SEG.GNSS.s, SEG.GNSS.label);

  // ── SEGMENT 2: Night Lights (20s) ─────────────────────────────────────
  console.log('\n🌃  SEGMENT 2: Night Lights');
  await ensureLeftPanel(page);
  await openTab(page, 'lpt-display', 'DISPLAY tab');
  await click(page, '#btn-terminator', 'Terminator');
  await sleep(600);
  await click(page, '#btn-nightlights', 'Night Lights');
  await recentre(page, 2500);
  await captureFrames(page, SEG.NIGHT_LIGHTS.s, SEG.NIGHT_LIGHTS.label);

  // ── SEGMENT 3: ISS Fly-To (20s) ───────────────────────────────────────
  console.log('\n🛸  SEGMENT 3: ISS Fly-To');
  await ensureLeftPanel(page);
  await openTab(page, 'lpt-track', 'TRACK tab');
  await click(page, '#btn-issfly', 'Fly With ISS');
  await sleep(2000);
  await captureFrames(page, SEG.ISS_FLY.s, SEG.ISS_FLY.label);
  // Turn Night Lights off before frame mode switch
  await openTab(page, 'lpt-display', 'DISPLAY tab');
  await click(page, '#btn-nightlights', 'Night Lights off');
  await click(page, '#btn-terminator', 'Terminator off');

  // ── SEGMENT 4: GEO·EQ (30s) ───────────────────────────────────────────
  console.log('\n🌍  SEGMENT 4: GEO·EQ');
  await click(page, '#btn-fm1', 'GEO·EQ mode');
  await recentre(page, 3500);
  await captureFrames(page, SEG.GEO_EQ.s, SEG.GEO_EQ.label);

  // ── SEGMENT 5: GEO·ECL (20s) ──────────────────────────────────────────
  console.log('\n🌒  SEGMENT 5: GEO·ECL');
  await click(page, '#btn-fm2', 'GEO·ECL mode');
  await recentre(page, 3000);
  await captureFrames(page, SEG.GEO_ECL.s, SEG.GEO_ECL.label);

  // ── SEGMENT 6: HELIO·EQ (40s) ─────────────────────────────────────────
  console.log('\n☀  SEGMENT 6: Heliocentric');
  await click(page, '#btn-fm3', 'HELIO·EQ mode');
  await recentre(page, 4000);
  await captureFrames(page, SEG.HELIO_EQ.s, SEG.HELIO_EQ.label);

  // ── SEGMENT 7: Scale Slider (20s) ─────────────────────────────────────
  console.log('\n🎚  SEGMENT 7: Scale Slider');
  await click(page, '#btn-fm0', 'GNSS mode');
  await recentre(page, 3000);
  dragScaleSlider(page); // start drag async while we capture
  await captureFrames(page, SEG.SCALE_SLIDE.s, SEG.SCALE_SLIDE.label);

  // ── SEGMENT 8: Sky View (20s) ─────────────────────────────────────────
  console.log('\n🔭  SEGMENT 8: Sky View');
  await click(page, '#btn-fm0', 'GNSS mode');
  await recentre(page, 2000);
  await ensureLeftPanel(page);
  await openTab(page, 'lpt-view', 'VIEW tab');
  await click(page, '#btn-skyview', 'Sky View');
  await sleep(2500);
  await captureFrames(page, SEG.SKY_VIEW.s, SEG.SKY_VIEW.label);
  await click(page, '#btn-skyview', 'Exit Sky View');
  await sleep(800);

  // ── SEGMENT 9: Return to GNSS (20s) ───────────────────────────────────
  console.log('\n🌐  SEGMENT 9: Return GNSS');
  await click(page, '#btn-fm0', 'GNSS mode');
  await recentre(page, 3000);
  await captureFrames(page, SEG.RETURN_GNSS.s, SEG.RETURN_GNSS.label);

  // ── Finish ────────────────────────────────────────────────────────────
  console.log(`\n\n📦  Frames captured: ${frameCount} (${Math.round(frameCount/FPS)}s)`);
  ffmpegProc.stdin.end();
  await sleep(8000); // let ffmpeg finalise
  await browser.close();
  console.log(`\n🎬  Done → ${OUT_FILE}\n`);
})().catch(async err => {
  console.error('\n💥  Fatal error:', err.message);
  console.log('💾  Saving partial video captured so far...');
  if (ffmpegProc) {
    ffmpegProc.stdin.end();
    await sleep(6000); // let ffmpeg write the partial file
  }
  console.log(`📦  Partial video (${Math.round(frameCount/FPS)}s) saved to:\n    ${OUT_FILE}`);
  process.exit(1);
});
