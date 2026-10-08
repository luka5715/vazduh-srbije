#!/usr/bin/env node
/**
 * Snimci ekrana demo aplikacije:
 *   1. `npm run build:demo`  (VITE_SERVICE_MODE=demo → dist-demo)
 *   2. mali statički server sa SPA fallback-om na slobodnom portu
 *   3. Playwright/Chromium: <view>-<variant>.jpg (ili .png) za svaku stranicu i varijantu
 *
 * Bez --views/--variants pravi se SKUP ZA DOKUMENTACIJU (12 snimaka, docs/screenshots):
 *   pregled × {phone-light, phone-dark, desktop-light, desktop-dark}
 *   {mapa, stanice, trendovi, sinhronizacija} × {desktop-dark, phone-dark}
 * Sa --views i/ili --variants pravi se svaka kombinacija (nedostajuća lista = sve).
 *
 * Opcije:
 *   --views pregled,mapa,…     stranice (`?view=`): pregled | mapa | stanice | trendovi | sinhronizacija
 *   --variants phone-dark,…    phone-light | phone-dark | desktop-light | desktop-dark
 *   --scenario smog            demo scenario (`?demo=`, vidi src/services/demoScenario.ts): empty | late |
 *                              smog | beograd. Bez opcije: podrazumevani demo, nazivi datoteka kao do sada;
 *                              sa opcijom: adresa `?demo=<scenario>#/?view=…`, datoteke <view>-<variant>-<scenario>
 *   --format jpeg|png          podrazumevano jpeg (kvalitet 88, .jpg); png za proveru piksela
 *   --out <dir>                izlazni folder, podrazumevano docs/screenshots
 *   --no-build                 preskače build i koristi postojeći dist-demo (isto što i SKIP_BUILD=1)
 *
 * Pada ako aplikacija ispiše grešku u konzolu ili baci izuzetak; za svaki snimak
 * ispisuje da li postoji horizontalno prelivanje (scrollWidth > clientWidth).
 * Snimak cele strane se pravi tako što se viewport produži na visinu dokumenta, da
 * lepljive i fiksne trake (bočna traka, donja navigacija) stoje gde i u pravom prikazu.
 *
 * Promenljive okruženja: SKIP_BUILD=1, SCREENSHOTS_DIST (gotov demo build van dist-demo, uz
 * --no-build), PLAYWRIGHT_PATH, CHROME_PATH.
 */
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// SCREENSHOTS_DIST: drugi folder sa demo build-om (npr. paralelne provere); podrazumevano dist-demo.
const distDir = process.env.SCREENSHOTS_DIST ? resolve(process.env.SCREENSHOTS_DIST) : join(root, 'dist-demo');
const defaultOutDir = join(root, 'docs', 'screenshots');

const PLAYWRIGHT_PATH = process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules/playwright';
const CHROME_PATH = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false },
};
const ALL_VARIANTS = ['phone-light', 'phone-dark', 'desktop-light', 'desktop-dark'];
const ALL_VIEWS = ['pregled', 'mapa', 'stanice', 'trendovi', 'sinhronizacija'];
/** Demo scenariji iz `src/services/demoScenario.ts` (`DEMO_SCENARIOS` bez `default`). */
const ALL_SCENARIOS = ['empty', 'late', 'smog', 'beograd'];
const FORMATS = { jpeg: { ext: 'jpg', options: { type: 'jpeg', quality: 88 } }, png: { ext: 'png', options: { type: 'png' } } };

/** Skup za dokumentaciju (README): Pregled u sve četiri varijante, ostale stranice tamne. */
const DOCS_SET = [
  ...ALL_VARIANTS.map((variant) => ['pregled', variant]),
  ...['mapa', 'stanice', 'trendovi', 'sinhronizacija'].flatMap((view) => [
    [view, 'desktop-dark'],
    [view, 'phone-dark'],
  ]),
];

/**
 * Selektori koje svaka stranica mora da prikaže pre snimka (pored `data-ready` i korena stranice).
 * Namerno samo stabilni `data-testid` atributi koji moraju ostati dostupni.
 */
const VIEW_SELECTORS = {
  pregled: [],
  mapa: ['[data-testid="serbia-map"] svg path', '[data-testid="hourly-chart"] svg path', '[data-testid="daily-chart"] svg path'],
  stanice: [],
  trendovi: ['[data-testid="network-trend"] svg path'],
  sinhronizacija: [],
};

/** Čekanje posle `data-ready` (prstenovi i sparkline ≤ 0,7 s, čestice Košave). */
const SETTLE_MS = 800;

function parseArgs(argv) {
  const options = { views: null, variants: null, scenario: null, format: 'jpeg', outDir: defaultOutDir, build: !process.env.SKIP_BUILD };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const value = () => {
      const next = inline ?? argv[++i];
      if (next === undefined) {
        console.error(`[screenshots] ${flag} traži vrednost.`);
        process.exit(2);
      }
      return next;
    };
    switch (flag) {
      case '--views':
        options.views = value().split(',').map((v) => v.trim()).filter(Boolean);
        break;
      case '--variants':
        options.variants = value().split(',').map((v) => v.trim()).filter(Boolean);
        break;
      case '--scenario': {
        const scenario = value().trim();
        if (!ALL_SCENARIOS.includes(scenario)) {
          console.error(`[screenshots] Nepoznat scenario „${scenario}“. Dozvoljeno: ${ALL_SCENARIOS.join(', ')}`);
          process.exit(2);
        }
        options.scenario = scenario;
        break;
      }
      case '--format': {
        const format = value().toLowerCase();
        options.format = format === 'jpg' ? 'jpeg' : format;
        if (!FORMATS[options.format]) {
          console.error(`[screenshots] Nepoznat format „${format}“. Dozvoljeno: jpeg, png`);
          process.exit(2);
        }
        break;
      }
      case '--out': {
        const dir = value();
        options.outDir = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
        break;
      }
      case '--no-build':
        options.build = false;
        break;
      case '--help':
      case '-h':
        console.log(
          'node scripts/screenshots.mjs [--views pregled,mapa] [--variants phone-dark,desktop-light] [--scenario empty|late|smog|beograd] [--format jpeg|png] [--out dir] [--no-build]',
        );
        process.exit(0);
        break;
      default:
        console.error(`[screenshots] Nepoznata opcija: ${arg}`);
        process.exit(2);
    }
  }
  const badView = (options.views ?? []).find((v) => !ALL_VIEWS.includes(v));
  if (badView) {
    console.error(`[screenshots] Nepoznata stranica „${badView}“. Dozvoljeno: ${ALL_VIEWS.join(', ')}`);
    process.exit(2);
  }
  const badVariant = (options.variants ?? []).find((v) => !ALL_VARIANTS.includes(v));
  if (badVariant) {
    console.error(`[screenshots] Nepoznata varijanta „${badVariant}“. Dozvoljeno: ${ALL_VARIANTS.join(', ')}`);
    process.exit(2);
  }
  // Bez izbora: skup za dokumentaciju; sa izborom: svaka kombinacija (nedostajuća lista = sve).
  options.shots =
    options.views === null && options.variants === null
      ? DOCS_SET
      : (options.views ?? ALL_VIEWS).flatMap((view) => (options.variants ?? ALL_VARIANTS).map((variant) => [view, variant]));
  return options;
}

/** Greške iz konzole koje ne dolaze iz aplikacije (mrežni resursi, fontovi bez interneta). */
function isIgnorableConsoleError(text) {
  return /Failed to load resource|fonts\.googleapis|fonts\.gstatic|net::ERR_/i.test(text);
}

function build(enabled) {
  if (!enabled) {
    console.log(`[screenshots] bez build-a – koristim postojeći build: ${distDir}`);
    return;
  }
  console.log('[screenshots] npm run build:demo …');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['--prefix', root, 'run', 'build:demo'], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.error('[screenshots] build:demo nije uspeo.');
    process.exit(result.status ?? 1);
  }
}

function startServer() {
  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    console.error(`[screenshots] Nema ${indexPath}. Pokrenite build:demo.`);
    process.exit(1);
  }
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(distDir, safePath);
    if (!filePath.startsWith(distDir + sep) && filePath !== distDir) filePath = indexPath;
    let stats = null;
    try {
      stats = statSync(filePath);
    } catch {
      stats = null;
    }
    if (!stats || stats.isDirectory()) filePath = indexPath; // SPA fallback
    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolvePort) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolvePort({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

/** Produžava viewport do pune visine dokumenta (najviše 3 pokušaja – visina može da se menja). */
async function expandToFullHeight(page, width) {
  let height = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    if (Math.abs(next - height) < 2) break;
    height = next;
    await page.setViewportSize({ width, height: Math.min(height, 16_000) });
    await page.waitForTimeout(250);
  }
}

async function capture(browser, url, view, variant, outDir, format, scenario = null) {
  const [device, theme] = variant.split('-');
  const shot = DEVICES[device];
  const name = scenario ? `${view}-${variant}-${scenario}` : `${view}-${variant}`;
  const context = await browser.newContext({
    viewport: shot.viewport,
    deviceScaleFactor: 1,
    isMobile: shot.isMobile,
    hasTouch: shot.hasTouch,
    colorScheme: theme,
    locale: 'sr-Latn-RS',
    timezoneId: 'Europe/Belgrade',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!isIgnorableConsoleError(text)) errors.push(`console.error: ${text}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  // Tema pre učitavanja: aplikacija čita `vazduh-theme` iz localStorage u inline skripti.
  await page.addInitScript((value) => {
    try {
      localStorage.setItem('vazduh-theme', value);
    } catch {
      /* ignorisano */
    }
  }, theme);

  // Scenario ide pre `#` (`?demo=smog#/?view=…`) – isto što i `#/?demo=smog`, vidi demoScenario().
  await page.goto(`${url}${scenario ? `?demo=${scenario}` : ''}#/?view=${view}`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForSelector('[data-ready="true"]', { timeout: 60_000 });
  await page.waitForSelector(`[data-testid="view-${view}"]`, { timeout: 30_000 });
  // Prazna baza nema grafikone – ne čekamo njihove `path` elemente.
  for (const selector of scenario === 'empty' ? [] : (VIEW_SELECTORS[view] ?? [])) {
    await page.waitForSelector(selector, { timeout: 60_000 });
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SETTLE_MS);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    isDark: document.documentElement.classList.contains('dark'),
  }));
  const horizontalOverflow = overflow.scrollWidth > overflow.clientWidth;
  console.log(
    `[screenshots] ${name}: dark=${overflow.isDark} horizontalOverflow=${horizontalOverflow} (scrollWidth ${overflow.scrollWidth}, clientWidth ${overflow.clientWidth})`,
  );

  await expandToFullHeight(page, shot.viewport.width);
  // Canvas se posle promene veličine ponovo raspoređuje – kratko sačekamo tragove čestica.
  await page.waitForTimeout(SETTLE_MS);

  const { ext, options: shotOptions } = FORMATS[format];
  const file = join(outDir, `${name}.${ext}`);
  await page.screenshot({ path: file, fullPage: true, ...shotOptions });
  console.log(`[screenshots] sačuvano ${file}`);
  await context.close();
  return { name, errors, horizontalOverflow };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  build(options.build);
  mkdirSync(options.outDir, { recursive: true });
  const { server, url } = await startServer();
  console.log(`[screenshots] server: ${url}`);

  let playwright;
  try {
    playwright = require(PLAYWRIGHT_PATH);
  } catch (error) {
    console.error(`[screenshots] Playwright nije pronađen na ${PLAYWRIGHT_PATH}: ${error.message}`);
    server.close();
    process.exit(1);
  }
  const executablePath = existsSync(CHROME_PATH) ? CHROME_PATH : undefined;
  const browser = await playwright.chromium.launch({ executablePath, args: ['--no-sandbox'] });

  const results = [];
  try {
    for (const [view, variant] of options.shots) {
      results.push(await capture(browser, url, view, variant, options.outDir, options.format, options.scenario));
    }
  } finally {
    await browser.close();
    server.close();
  }

  let failed = false;
  for (const result of results) {
    if (result.errors.length) {
      failed = true;
      console.error(`[screenshots] ${result.name}: greške aplikacije u konzoli:`);
      for (const error of result.errors) console.error(`  - ${error}`);
    }
    if (result.horizontalOverflow) console.warn(`[screenshots] ${result.name}: UPOZORENJE – horizontalno prelivanje.`);
  }
  if (failed) process.exit(1);
  console.log('[screenshots] gotovo.');
}

main().catch((error) => {
  console.error('[screenshots] neuspeh:', error);
  process.exit(1);
});
