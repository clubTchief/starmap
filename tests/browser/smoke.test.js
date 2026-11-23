'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const puppeteer = require('puppeteer');

const appUrl = process.env.STARMAP_BASE_URL || 'http://127.0.0.1:8080';
let browser;

before(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
});

after(async () => {
  await browser?.close();
});

async function openPage(path = '/') {
  const page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  const response = await page.goto(new URL(path, appUrl), {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  return { page, response };
}

test('serves reference-frame, star, and satellite controls', async () => {
  const { page, response } = await openPage();
  try {
    assert.equal(response.status(), 200);
    const html = await response.text();
    for (let mode = 0; mode <= 4; mode++) {
      assert.ok(html.includes(`id="btn-fm${mode}"`), `reference-frame control ${mode} should be present`);
    }
    assert.ok(html.includes('id="btn-stars"'), 'star display control should be present');
    assert.ok(html.includes('id="sat-selector"'), 'satellite selector should be present');
    assert.ok(html.includes('value="25544"'), 'ISS should be selected by default');
    assert.ok(html.includes('id="auth-widget"'), 'browser sign-in controls should be present');
    assert.ok(
      await page.$eval('#mode-bar', modeBar => !!modeBar.querySelector('#auth-widget')),
      'sign-in controls should be in the visible top bar layer',
    );

    const scriptResponse = await page.goto(new URL('/js/starmap.js', appUrl), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    assert.equal(scriptResponse.status(), 200);
    const script = await scriptResponse.text();
    assert.ok(script.includes('function switchFrameMode(newMode)'), 'frame-switch handler should be served');
    assert.ok(script.includes("document.getElementById('btn-stars')?.addEventListener('click'"), 'star toggle handler should be served');
    assert.ok(script.includes("headers.set('Authorization'"), 'write requests should send the signed-in bearer token');
    assert.ok(!script.includes('X-API-Key'), 'the shared API key must never be embedded in browser code');
  } finally {
    await page.close();
  }
});

test('serves public authentication configuration without exposing the email allowlist', async () => {
  const { page, response } = await openPage('/api/auth/config');
  try {
    assert.equal(response.status(), 200);
    const config = JSON.parse(await response.text());
    assert.equal(typeof config.googleClientId, 'string');
    assert.ok(!('allowedEmails' in config), 'authorized account emails must remain server-side');
  } finally {
    await page.close();
  }
});

test('sign-in widget is visible above the mode bar when enabled', async () => {
  const { page } = await openPage();
  try {
    const layout = await page.$eval('#auth-widget', widget => {
      widget.hidden = false;
      document.getElementById('auth-status').textContent = 'Sign in with an approved Google account.';
      const googleButton = document.getElementById('google-signin-button');
      googleButton.style.width = '136px';
      googleButton.style.height = '20px';

      const bounds = widget.getBoundingClientRect();
      const topElement = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return {
        display: getComputedStyle(widget).display,
        width: bounds.width,
        height: bounds.height,
        topmost: widget.contains(topElement),
      };
    });

    assert.equal(layout.display, 'flex');
    assert.ok(layout.width > 0 && layout.height > 0, 'enabled sign-in widget should occupy visible space');
    assert.ok(layout.topmost, 'the mode bar should not cover the sign-in widget');
  } finally {
    await page.close();
  }
});

test('serves live satellite status and the star catalogue', async () => {
  const { page, response } = await openPage('/api/status');
  try {
    assert.equal(response.status(), 200);
    const status = JSON.parse(await response.text());
    assert.ok(Array.isArray(status.trackedSats), 'satellite status should be an array');
    assert.ok(status.trackedSats.includes(25544), 'default ISS satellite should be tracked');
    assert.equal(status.ephemerisReady, true, 'ephemeris should be ready');

    const starsResponse = await page.goto(new URL('/api/stars', appUrl), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    assert.equal(starsResponse.status(), 200);
    const stars = JSON.parse(await starsResponse.text());
    assert.ok(stars.length > 0, 'star catalogue should contain entries');
    assert.ok('raRad' in stars[0] && 'decRad' in stars[0], 'star entries should include coordinates');
  } finally {
    await page.close();
  }
});
