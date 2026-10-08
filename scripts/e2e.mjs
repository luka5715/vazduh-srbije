#!/usr/bin/env node
/**
 * E2E provere demo build-a (Playwright/Chromium, bez mreže): navigacija, paleta, sočivo, okrug,
 * tema, ponovno učitavanje, prelivanje na 390 px, smanjeno kretanje; stanje Stanica posle „Nazad“,
 * neispravan link, moja stanica, „Kako čitati“, pokrivenost istorije, ?demo=late; traka izabrane
 * stanice iznad donje navigacije (390×664), kartice „+N stanica“ na telefonu, naslov heroja sa dva
 * stanja na dvomodalan dan, prvi prikaz KPI brojeva bez odbrojavanja, traka „Uživo“ kao jedan
 * tab-stop, plutajuće obaveštenje iznad trake izabrane stanice; ?demo=beograd: grupa stanica
 * „Grad Beograd · 33“ na celoj mapi, dodir/Enter je otvara kao uvećan okrug (33 tačke, mreža na
 * 0,5°, razmernik 20 km), „Ukloni filter“ vraća grupu, kompaktna mapa Pregleda ima istu grupu, na
 * telefonu 390×664 dodir na grupu pa na tačku i dalje daje traku izabrane stanice iznad navigacije.
 *
 * Upotreba:  node scripts/e2e.mjs <distDir> <outDir>
 *   distDir – gotov demo build (npr. dist-demo posle `npm run build:demo`)
 *   outDir  – folder za snimke ekrana koje provere ostavljaju (pravi se ako ne postoji)
 * Ispisuje OK/FAIL po proveri i „N/M provera prošlo“; izlazni kod 1 ako je bar jedna pala.
 *
 * Promenljive okruženja (kao scripts/screenshots.mjs): PLAYWRIGHT_PATH, CHROME_PATH.
 * Napomena: stanje greške pokrivenosti istorije („Pokušaj ponovo“) demo servis ne proizvodi –
 * pokriveno je jediničnim testom (src/components/sync/HistoryStrip.test.tsx).
 */
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';

const require = createRequire(import.meta.url);
const PLAYWRIGHT_PATH = process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules/playwright';
const CHROME_PATH = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const [distArg, outArg] = process.argv.slice(2);
if (!distArg || !outArg) {
  console.error('Upotreba: node scripts/e2e.mjs <distDir> <outDir>');
  process.exit(2);
}
const distDir = isAbsolute(distArg) ? distArg : resolve(process.cwd(), distArg);
const outDir = isAbsolute(outArg) ? outArg : resolve(process.cwd(), outArg);
if (!existsSync(join(distDir, 'index.html'))) {
  console.error(`Nema ${join(distDir, 'index.html')}. Pokrenite \`npm run build:demo\` (ili zadajte drugi distDir).`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

let playwright;
try {
  playwright = require(PLAYWRIGHT_PATH);
} catch (error) {
  console.error(`Playwright nije pronađen na ${PLAYWRIGHT_PATH}: ${error.message}`);
  process.exit(1);
}
const { chromium } = playwright;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json' };
const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let filePath = join(distDir, normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(distDir + sep)) filePath = join(distDir, 'index.html');
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(distDir, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(filePath).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ executablePath: existsSync(CHROME_PATH) ? CHROME_PATH : undefined, args: ['--no-sandbox'] });
const errors = [];
function watch(page, tag) {
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|fonts\.g|net::ERR_/.test(m.text())) errors.push(`${tag}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
}
async function ready(page, view) {
  await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
  await page.waitForSelector(`[data-testid="view-${view}"]`, { timeout: 30000 });
}
const hashParams = (page) => new URLSearchParams(new URL(page.url()).hash.split('?')[1] ?? '');

// ---------------------------------------------------------------- desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', locale: 'sr-Latn-RS', timezoneId: 'Europe/Belgrade' });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await page.goto(`${base}#/`);
  await ready(page, 'pregled');
  const sidebar = page.locator('aside[aria-label="Glavna navigacija"]');

  for (const [name, title] of [['mapa', 'Mapa'], ['stanice', 'Stanice'], ['trendovi', 'Trendovi'], ['sinhronizacija', 'Sinhronizacija'], ['pregled', 'Pregled']]) {
    await sidebar.getByRole('button', { name: new RegExp(`^${title}`) }).click();
    await ready(page, name);
    const current = await sidebar.locator('[aria-current="page"]').innerText();
    const urlView = hashParams(page).get('view') ?? 'pregled';
    check(`sidebar → ${name}`, urlView === name && current.startsWith(title), `url view=${urlView}, aria-current="${current.split('\n')[0]}"`);
  }

  // Paleta: Ctrl+K, „Niš“, Enter → Mapa sa stanicom
  await page.keyboard.press('Control+k');
  await page.waitForSelector('dialog[open] input[role="combobox"]', { timeout: 10000 });
  await page.keyboard.type('Niš');
  await page.waitForTimeout(150);
  const firstOption = await page.locator('dialog[open] [role="option"]').first().innerText();
  await page.keyboard.press('Enter');
  await ready(page, 'mapa');
  const station = hashParams(page).get('station');
  await page.waitForTimeout(300);
  const detailTitle = (await page.locator('[data-testid="view-mapa"] h2').allInnerTexts()).find((t) => /Niš/.test(t)) ?? '';
  check('paleta Ctrl+K „Niš“ → Mapa', Boolean(station) && /Niš/.test(detailTitle) && /Niš/.test(firstOption), `station=${station}, naslov „${detailTitle}“, prva opcija „${firstOption.split('\n')[0]}“`);
  const focusBack = await page.evaluate(() => document.activeElement?.tagName);
  check('paleta se zatvorila', (await page.locator('dialog[open]').count()) === 0, `fokus: ${focusBack}`);

  // „/“ otvara, Esc zatvara
  await page.locator('body').click({ position: { x: 700, y: 870 } }).catch(() => {});
  await page.keyboard.press('/');
  await page.waitForSelector('dialog[open]', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('„/“ otvara paletu, Esc zatvara', (await page.locator('dialog[open]').count()) === 0);

  // Sočivo NO₂
  await sidebar.getByRole('radio', { name: 'NO₂' }).click();
  await page.waitForTimeout(200);
  const lensParam = hashParams(page).get('lens');
  const mapEyebrow = await page.locator('[data-testid="view-mapa"] .eyebrow').first().innerText();
  check('sočivo NO₂ u URL-u i natpisu Mape', lensParam === 'NO2' && /NO₂/.test(mapEyebrow), `lens=${lensParam}, eyebrow „${mapEyebrow}“`);
  await page.screenshot({ path: join(outDir, 'desk-mapa-no2.png') });

  // Okrug iz bočne trake
  const okrugOptions = await sidebar.locator('select option').allInnerTexts();
  const target = okrugOptions.find((o) => /Nišav/.test(o)) ?? okrugOptions[1];
  await sidebar.locator('select').selectOption({ label: target });
  await page.waitForTimeout(200);
  const okrugParam = hashParams(page).get('okrug');
  const chip = await page.locator('header').getByRole('button', { name: /Ukloni filter/ }).count();
  check('okrug u URL-u i čip u gornjoj traci', Boolean(okrugParam) && chip === 1, `okrug=${okrugParam}, izabrano „${target}“`);

  for (const [name, title] of [['pregled', 'Pregled'], ['stanice', 'Stanice'], ['trendovi', 'Trendovi']]) {
    await sidebar.getByRole('button', { name: new RegExp(`^${title}`) }).click();
    await ready(page, name);
    await page.waitForTimeout(500);
    const p = hashParams(page);
    const eyebrows = (await page.locator(`[data-testid="view-${name}"] .eyebrow`).allInnerTexts()).join(' | ');
    const label = target.replace(/ okrug$/, '');
    check(`filteri važe na ${name}`, p.get('lens') === 'NO2' && p.get('okrug') === okrugParam && eyebrows.includes('NO₂') && eyebrows.toLowerCase().includes(label.toLowerCase()), eyebrows.slice(0, 160));
    await page.screenshot({ path: join(outDir, `desk-${name}-filtered.png`), fullPage: false });
  }
  const badge = await sidebar.getByRole('button', { name: /^Stanice/ }).innerText();
  check('broj stanica u navigaciji prati okrug', /\b[1-9]\b/.test(badge) && !/26/.test(badge), badge.replace(/\n/g, ' '));

  // Lepljivo zaglavlje tabele Stanice
  await sidebar.getByRole('button', { name: /^Stanice/ }).click();
  await ready(page, 'stanice');
  await sidebar.locator('select').selectOption({ label: 'Svi okruzi' });
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(400);
  const sticky = await page.evaluate(() => {
    const th = document.querySelector('.st-table thead th');
    const bar = document.querySelector('header.vt-topbar');
    return th && bar ? { th: Math.round(th.getBoundingClientRect().top), bar: Math.round(bar.getBoundingClientRect().bottom) } : null;
  });
  check('lepljivo zaglavlje tabele ispod gornje trake (desktop)', sticky && Math.abs(sticky.th - sticky.bar) <= 1, JSON.stringify(sticky));
  await page.screenshot({ path: join(outDir, 'desk-stanice-sticky.png') });

  // Tema
  const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await sidebar.getByRole('button', { name: /Uključi (svetlu|tamnu) temu/ }).click();
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  check('prekidač teme', before !== after, `dark ${before} → ${after}`);
  await page.screenshot({ path: join(outDir, 'desk-stanice-light.png') });

  // Ponovno učitavanje sa ?view=trendovi (i filterima iz URL-a)
  await page.goto(`${base}#/?view=trendovi&lens=PM10&okrug=${encodeURIComponent(okrugParam)}`);
  await ready(page, 'trendovi');
  await page.waitForTimeout(600);
  const lensChecked = await sidebar.getByRole('radio', { name: 'PM10' }).getAttribute('aria-checked');
  const selectVal = await sidebar.locator('select').inputValue();
  check('reload ?view=trendovi&lens=PM10&okrug=… vraća stranicu i filtere', lensChecked === 'true' && selectVal === okrugParam, `PM10 checked=${lensChecked}, select=${selectVal}`);

  // Nazad
  await page.goBack();
  await page.waitForTimeout(500);
  check('Nazad radi', !page.url().includes('view=trendovi&lens=PM10'), page.url().split('#')[1]);

  // O podacima → sidro
  await page.goto(`${base}#/`);
  await ready(page, 'pregled');
  await sidebar.getByRole('button', { name: 'O podacima' }).click();
  await ready(page, 'sinhronizacija');
  await page.waitForTimeout(700);
  const anchor = await page.evaluate(() => {
    const el = document.getElementById('o-podacima');
    const bar = document.querySelector('header.vt-topbar');
    return el && bar ? { top: Math.round(el.getBoundingClientRect().top), bar: Math.round(bar.getBoundingClientRect().bottom) } : null;
  });
  check('„O podacima“ skroluje do kartice ispod trake', anchor && anchor.top >= anchor.bar, JSON.stringify(anchor));
  await ctx.close();
}

// ---------------------------------------------------------------- telefon
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'sr-Latn-RS', timezoneId: 'Europe/Belgrade' });
  const page = await ctx.newPage();
  watch(page, 'phone');
  await page.goto(`${base}#/`);
  await ready(page, 'pregled');
  const nav = page.locator('nav[aria-label="Stranice"]').last();
  for (const [name, title] of [['pregled', 'Pregled'], ['mapa', 'Mapa'], ['stanice', 'Stanice'], ['trendovi', 'Trendovi'], ['sinhronizacija', 'Sinhronizacija']]) {
    // Donja traka: naziv počinje vidljivim natpisom („Sinhr. (sinhronizacija), status: …“).
    await nav.getByRole('button', { name: new RegExp(`^(${title}|${title.slice(0, 5)}\.)`) }).tap();
    await ready(page, name);
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    const cover = await page.evaluate(() => {
      const navEl = [...document.querySelectorAll('nav[aria-label="Stranice"]')].pop();
      const last = [...document.querySelectorAll('footer p')].pop();
      return { navTop: Math.round(navEl.getBoundingClientRect().top), lastBottom: Math.round(last.getBoundingClientRect().bottom) };
    });
    check(`telefon ${name}: bez vodoravnog skrola, donja traka ne pokriva sadržaj`, m.sw <= m.cw && cover.lastBottom <= cover.navTop, `scrollWidth ${m.sw}/${m.cw}, footer ${cover.lastBottom} ≤ nav ${cover.navTop}`);
  }
  // Okrug iz lista na telefonu
  await nav.getByRole('button', { name: /^Stanice/ }).tap();
  await ready(page, 'stanice');
  await page.getByRole('button', { name: 'Filter okruga' }).tap();
  await page.waitForSelector('dialog[open] [role="radio"]');
  await page.locator('dialog[open] [role="radio"]').nth(2).tap();
  await page.waitForTimeout(300);
  check('telefon: okrug iz lista', Boolean(hashParams(page).get('okrug')) && (await page.locator('dialog[open]').count()) === 0, hashParams(page).get('okrug'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(outDir, 'phone-stanice-okrug.png') });
  await page.mouse.wheel(0, 900);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, 'phone-stanice-scrolled.png') });
  // Lepljivo zaglavlje na tabletu (tabela ≥ 768) – proveravamo na 900 px ispod
  await ctx.close();
}

// ---------------------------------------------------------------- tablet 900 (tabela bez bočne trake)
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  watch(page, 'tablet');
  await page.goto(`${base}#/?view=stanice`);
  await ready(page, 'stanice');
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(400);
  const sticky = await page.evaluate(() => {
    const th = document.querySelector('.st-table thead th');
    const bar = document.querySelector('header.vt-mtopbar');
    return th && bar ? { th: Math.round(th.getBoundingClientRect().top), bar: Math.round(bar.getBoundingClientRect().bottom) } : null;
  });
  check('lepljivo zaglavlje tabele ispod mobilne trake (900 px)', sticky && Math.abs(sticky.th - sticky.bar) <= 1, JSON.stringify(sticky));
  await page.screenshot({ path: join(outDir, 'tablet-stanice-sticky.png') });
  await ctx.close();
}

// ---------------------------------------------------------------- smanjeno kretanje
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  watch(page, 'reduced');
  for (const name of ['pregled', 'mapa', 'stanice', 'trendovi', 'sinhronizacija']) {
    await page.goto(`${base}#/?view=${name}`);
    await ready(page, name);
    await page.waitForTimeout(1600);
    const anim = await page.evaluate(() => {
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      return running.map((a) => `${a.animationName ?? a.constructor.name}@${a.effect?.target?.className?.toString().slice(0, 40) ?? ''}`);
    });
    check(`smanjeno kretanje ${name}: nema animacija u toku`, anim.length === 0, anim.slice(0, 6).join(', '));
  }
  await page.goto(`${base}#/`);
  await ready(page, 'pregled');
  await page.waitForTimeout(1800);
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="view-pregled"] canvas');
    if (!c) return null;
    const ctx2 = c.getContext('2d');
    const data = ctx2.getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return { w: c.width, h: c.height, painted };
  });
  check('smanjeno kretanje: platno ima statičan kadar', canvas && canvas.painted > 200, JSON.stringify(canvas));
  const marquee = await page.evaluate(() => ({ track: document.querySelectorAll('.marquee__track').length, row: document.querySelectorAll('.marquee.scroll-row').length }));
  check('smanjeno kretanje: traka je red za skrol', marquee.track === 0 && marquee.row === 1, JSON.stringify(marquee));
  await page.screenshot({ path: join(outDir, 'reduced-pregled.png') });
  await ctx.close();
}

// ---------------------------------------------------------------- stanja iz unapređenja (Stanice, link, moja stanica, vodič, istorija)
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', locale: 'sr-Latn-RS', timezoneId: 'Europe/Belgrade' });
  const page = await ctx.newPage();
  watch(page, 'stanja');

  // Stanice: pretraga + grupa + redosled → stanica (Mapa) → Nazad vraća sve
  await page.goto(`${base}#/?view=stanice`);
  await ready(page, 'stanice');
  await page.waitForTimeout(400);
  const search = page.locator('[data-testid="view-stanice"] input[type="search"]');
  await search.click();
  await search.pressSequentially('demo stanica b', { delay: 15 });
  await page.locator('[data-testid="view-stanice"] [role="group"] button', { hasText: 'Umeren' }).first().click();
  await page.waitForTimeout(250);
  const rowsBefore = await page.locator('.st-table tbody tr').count();
  const paramsBefore = hashParams(page);
  await page.locator('.st-table tbody tr .st-name').first().click();
  await ready(page, 'mapa');
  await page.waitForTimeout(300);
  const mapUrl = hashParams(page);
  await page.goBack();
  await ready(page, 'stanice');
  await page.waitForTimeout(500);
  const qAfter = await page.locator('[data-testid="view-stanice"] input[type="search"]').inputValue();
  const pressedAfter = await page.locator('[data-testid="view-stanice"] [role="group"] button[aria-pressed="true"]').allInnerTexts();
  const rowsAfter = await page.locator('.st-table tbody tr').count();
  check(
    'Stanice: posle stanice i „Nazad“ ostaju pretraga, grupa i lista',
    paramsBefore.get('q') === 'demo stanica b' && paramsBefore.get('grupa') === 'umeren' && !mapUrl.get('q') && qAfter === 'demo stanica b' && pressedAfter.some((t) => /Umeren/.test(t)) && rowsAfter === rowsBefore && rowsBefore > 0,
    `q „${qAfter}“, grupa ${hashParams(page).get('grupa')}, redova ${rowsBefore}→${rowsAfter}`,
  );

  // Neispravan ?station= na Mapi: vidljiva poruka, URL očišćen (nikad tiho druga stanica)
  await page.goto(`${base}#/?view=mapa&station=nepostojeca-stanica`);
  await ready(page, 'mapa');
  await page.waitForTimeout(700);
  const notice = page.locator('[data-testid="link-notice"]');
  const noticeText = (await notice.count()) ? await notice.innerText() : '';
  check(
    'neispravan ?station= – poruka i očišćen URL',
    /Stanica iz linka nije pronađena/.test(noticeText) && hashParams(page).get('station') !== 'nepostojeca-stanica',
    `${page.url().split('#')[1]} | ${noticeText.replace(/\n/g, ' / ').slice(0, 140)}`,
  );
  await page.screenshot({ path: join(outDir, 'stanja-mapa-badlink.png') });
  // Isto na Pregledu (poruka nije samo na Mapi)
  await page.goto(`${base}#/?view=pregled&okrug=Nepostojeci`);
  await ready(page, 'pregled');
  await page.waitForTimeout(600);
  const overviewNotice = (await notice.count()) ? await notice.innerText() : '';
  check('neispravan ?okrug= na Pregledu – poruka', /Okrug iz linka/.test(overviewNotice) && !hashParams(page).get('okrug'), overviewNotice.replace(/\n/g, ' / ').slice(0, 120));

  // Moja stanica: izbor u heroju, ostaje posle ponovnog učitavanja, uklanja se
  await page.goto(`${base}#/`);
  await ready(page, 'pregled');
  const pregled = page.locator('[data-testid="view-pregled"]');
  await pregled.getByRole('combobox', { name: /Moja stanica/ }).selectOption({ label: 'Demo stanica Niš 1' });
  await page.waitForTimeout(300);
  const titleBefore = await pregled.locator('h2[id^="my-station-"]').innerText().catch(() => '');
  await page.reload();
  await ready(page, 'pregled');
  await page.waitForTimeout(500);
  const titleAfter = await pregled.locator('h2[id^="my-station-"]').innerText().catch(() => '');
  const stored = await page.evaluate(() => localStorage.getItem('vazduh-moja-stanica'));
  check('Moja stanica ostaje posle ponovnog učitavanja', /Niš 1/.test(titleBefore) && /Niš 1/.test(titleAfter) && Boolean(stored), `${titleAfter} / ${stored}`);
  await page.screenshot({ path: join(outDir, 'stanja-pregled-moja-stanica.png') });
  await pregled.getByRole('button', { name: 'Ukloni moju stanicu' }).click();
  await page.waitForTimeout(250);
  check('Moja stanica se uklanja', (await pregled.locator('h2[id^="my-station-"]').count()) === 0 && (await page.evaluate(() => localStorage.getItem('vazduh-moja-stanica'))) === null);

  // „Kako čitati“: otvara dijalog, Esc zatvara i vraća fokus na dugme
  const howTo = pregled.getByRole('button', { name: 'Kako čitati' });
  await howTo.click();
  await page.waitForSelector('dialog[open]', { timeout: 5000 });
  const dialogTitle = await page.locator('dialog[open] h2').first().innerText();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const focusAfter = await page.evaluate(() => document.activeElement?.textContent ?? '');
  check('„Kako čitati“ se otvara i zatvara sa Esc', /Kako čitati/.test(dialogTitle) && (await page.locator('dialog[open]').count()) === 0 && /Kako čitati/.test(focusAfter), `naslov „${dialogTitle}“, fokus „${focusAfter.trim()}“`);

  // Sinhronizacija: pokazatelj istorije i dugme za dopunu
  await page.goto(`${base}#/?view=sinhronizacija`);
  await ready(page, 'sinhronizacija');
  // Pokrivenost se čita posle prikaza stranice – čeka se broj dana (ne fiksno vreme, da ne pada pod opterećenjem).
  await page.getByText(/Istorija u bazi\s*·\s*\d+\/30 dana/i).first().waitFor({ timeout: 15000 });
  const syncText = await page.locator('[data-testid="view-sinhronizacija"]').innerText();
  const fill = await page.getByRole('button', { name: /^Dopuni nedostajuće dane \(\d+\)$/ }).count();
  check('Sinhronizacija: „Istorija u bazi · 27/30 dana“ i „Dopuni nedostajuće dane (3)“', /Istorija u bazi\s*·\s*27\/30 dana/i.test(syncText) && /Nedostaju/.test(syncText) && fill === 1, (syncText.match(/Istorija u bazi[^\n]*/i) ?? [''])[0]);

  // Trendovi: dani bez ijednog reda u bazi su „nije učitano“, ne „nema merenja“
  await page.goto(`${base}#/?view=trendovi`);
  await ready(page, 'trendovi');
  await page.waitForTimeout(700);
  const notLoadedCells = await page.locator('[data-testid="station-calendar"] [data-not-loaded]').count();
  const trendText = await page.locator('[data-testid="network-trend"]').innerText();
  check('Trendovi: nedostajući dani su „nije učitano“', notLoadedCells > 0 && /nije učitano/.test(trendText), `ćelija ${notLoadedCells}`);
  await ctx.close();
}

// ---------------------------------------------------------------- demo scenario: SEPA kasni (?demo=late)
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', locale: 'sr-Latn-RS', timezoneId: 'Europe/Belgrade' });
  const page = await ctx.newPage();
  watch(page, 'late');
  await page.goto(`${base}?demo=late#/?view=sinhronizacija`);
  await ready(page, 'sinhronizacija');
  await page.waitForTimeout(700);
  const chip = await page.locator('header.vt-topbar').innerText();
  const hero = await page.locator('[data-testid="view-sinhronizacija"]').innerText();
  const side = await page.locator('aside[aria-label="Glavna navigacija"]').innerText();
  check('?demo=late: ništa nije „Uživo“, Sinhronizacija kaže „SEPA kasni“', !/Uživo/.test(chip) && /Poslednji sat/.test(chip) && /SEPA\s+kasni/.test(hero) && /kasni/i.test(side), chip.replace(/\n/g, ' ').slice(0, 120));
  await page.screenshot({ path: join(outDir, 'late-sinhronizacija.png') });
  await page.goto(`${base}?demo=late#/`);
  await ready(page, 'pregled');
  await page.waitForTimeout(600);
  const heroText = await page.locator('[data-testid="view-pregled"]').innerText();
  check('?demo=late: Pregled kaže „poslednji sat“, stanice su i dalje sveže', /poslednji sat/i.test(heroText) && !/Nijedna stanica nema sveže podatke/.test(heroText), (heroText.match(/[^\n]*poslednji sat[^\n]*/i) ?? [''])[0]);
  await page.screenshot({ path: join(outDir, 'late-pregled.png') });
  await ctx.close();
}

// ---------------------------------------------------------------- telefon 390×664: traka izabrane stanice (R23)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'sr-Latn-RS', timezoneId: 'Europe/Belgrade' });
  const page = await ctx.newPage();
  watch(page, 'strip');
  await page.goto(`${base}#/?view=mapa`);
  await ready(page, 'mapa');
  await page.waitForSelector('[data-testid="serbia-map"] svg path');
  await page.waitForTimeout(600);
  const stripRect = () =>
    page.evaluate(() => {
      const strip = document.querySelector('[data-testid="selected-strip"]');
      const nav = [...document.querySelectorAll('nav[aria-label="Stranice"]')].pop();
      const button = strip?.querySelector('button');
      const r = (el) => (el ? (({ top, bottom, left, right, height }) => ({ top: Math.round(top), bottom: Math.round(bottom), left: Math.round(left), right: Math.round(right), height: Math.round(height) }))(el.getBoundingClientRect()) : null);
      return {
        strip: r(strip),
        placement: strip?.dataset.placement ?? null,
        name: strip?.querySelector('p')?.textContent ?? '',
        button: r(button),
        buttonText: button?.textContent?.trim() ?? '',
        nav: nav && getComputedStyle(nav).display !== 'none' ? r(nav) : null,
        vh: window.innerHeight,
        vw: window.innerWidth,
        stripVar: getComputedStyle(document.documentElement).getPropertyValue('--map-strip-h').trim(),
      };
    });
  // Tačka na jugu (Niš) je na 664 px visine ispod donje navigacije dok se ne doskroluje: `tap()`
  // je dovodi u ekran; ako je dodir presretnut (susedne ćelije od 28 px se preklapaju), dodir
  // ide po koordinatama centra tačke.
  const marker = page.locator('button.mk[aria-label^="Demo stanica Niš"]').first();
  try {
    await marker.tap({ timeout: 5000 });
  } catch {
    await marker.scrollIntoViewIfNeeded();
    const box = await marker.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  }
  await page.waitForTimeout(600);
  const tapped = await stripRect();
  const s = tapped.strip;
  check(
    '390×664 Mapa: posle dodira traka izabrane stanice lebdi cela vidljiva iznad donje navigacije',
    Boolean(s && tapped.placement === 'fixed' && /Niš/.test(tapped.name) && s.top >= 0 && s.bottom <= tapped.vh && s.left >= 0 && s.right <= tapped.vw && tapped.nav && s.bottom <= tapped.nav.top),
    `strip=${JSON.stringify(s)} nav.top=${tapped.nav?.top} „${tapped.name}“`,
  );
  check(
    '390×664 Mapa: „Detalji“ je vidljivo i visoko ≥ 44 px (dodir)',
    Boolean(tapped.button && /^Detalji/.test(tapped.buttonText) && tapped.button.height >= 44 && tapped.button.bottom <= tapped.vh && tapped.button.right <= tapped.vw) && (await page.getByRole('button', { name: /^Detalji/ }).isVisible()),
    `${JSON.stringify(tapped.button)} „${tapped.buttonText}“`,
  );
  check('390×664 Mapa: traka objavljuje --map-strip-h (za plutajuće obaveštenje)', /^\d+px$/.test(tapped.stripVar) && Number.parseInt(tapped.stripVar, 10) >= (s?.height ?? 0), `--map-strip-h=${tapped.stripVar}`);
  await page.screenshot({ path: join(outDir, 'phone-664-mapa-strip.png') });
  // Obaveštenje sinhronizacije (demo „Osveži“) stoji iznad trake, ne preko nje.
  await page.getByRole('button', { name: 'Osveži podatke sa SEPA' }).first().tap();
  await page.waitForSelector('[role="status"]', { timeout: 5000 });
  await page.waitForTimeout(250);
  const stacked = await page.evaluate(() => {
    const toast = document.querySelector('[role="status"]');
    const strip = document.querySelector('[data-testid="selected-strip"]');
    const r = (el) => (el ? { top: Math.round(el.getBoundingClientRect().top), bottom: Math.round(el.getBoundingClientRect().bottom) } : null);
    return { toast: r(toast), strip: r(strip), title: toast?.querySelector('p')?.textContent ?? '' };
  });
  check('390×664 Mapa: obaveštenje sinhronizacije stoji iznad trake izabrane stanice', Boolean(stacked.toast && stacked.strip && stacked.toast.bottom <= stacked.strip.top), JSON.stringify(stacked));
  await page.screenshot({ path: join(outDir, 'phone-664-mapa-strip-toast.png') });
  await page.waitForTimeout(1200);
  // „Detalji“ skroluje do panela; traka tada nestaje.
  await page.getByRole('button', { name: /^Detalji/ }).tap();
  await page.waitForTimeout(1200);
  const afterDetails = await stripRect();
  check('390×664 Mapa: „Detalji“ skroluje do detalja, traka nestaje i --map-strip-h se briše', afterDetails.strip === null && afterDetails.stripVar === '' && (await page.evaluate(() => window.scrollY)) > 100, `strip=${JSON.stringify(afterDetails.strip)} var=„${afterDetails.stripVar}“ scrollY=${await page.evaluate(() => window.scrollY)}`);
  await ctx.close();
}

// ---------------------------------------------------------------- telefon Stanice: 20 kartica + „+N stanica“ (R25)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light', locale: 'sr-Latn-RS', timezoneId: 'Europe/Belgrade' });
  const page = await ctx.newPage();
  watch(page, 'cards');
  await page.goto(`${base}#/?view=stanice`);
  await ready(page, 'stanice');
  await page.waitForTimeout(600);
  const cards = () => page.locator('[data-testid="view-stanice"] ul[aria-label="Stanice"] > li').count();
  const shown = await cards();
  const more = page.getByRole('button', { name: /^\+\d+ stanic/ });
  const moreText = (await more.count()) ? await more.innerText() : '';
  const total = Number(moreText.match(/\d+/)?.[0] ?? 0) + 20;
  check('telefon Stanice: prvih 20 kartica i dugme „+N stanica“', shown === 20 && /^\+\d+ stanic/.test(moreText) && (await more.getAttribute('aria-expanded')) === 'false', `kartica ${shown}, dugme „${moreText}“`);
  await more.scrollIntoViewIfNeeded();
  await more.tap();
  await page.waitForTimeout(400);
  const expanded = await cards();
  const less = page.getByRole('button', { name: 'Prikaži manje' });
  check('telefon Stanice: „+N“ otvara celu listu i nudi „Prikaži manje“', expanded === total && total > 20 && (await less.count()) === 1 && (await less.getAttribute('aria-expanded')) === 'true', `kartica ${expanded}/${total}`);
  await page.screenshot({ path: join(outDir, 'phone-stanice-expanded.png') });
  const search = page.locator('[data-testid="view-stanice"] input[type="search"]');
  await search.fill('demo stanica');
  await page.waitForTimeout(500);
  const withQuery = await cards();
  const anyButton = await page.getByRole('button', { name: /^\+\d+ stanic|^Prikaži manje$/ }).count();
  await search.fill('');
  await page.waitForTimeout(500);
  const cleared = await cards();
  check('telefon Stanice: pretraga ukida ograničenje, brisanje pretrage vraća prvih 20', withQuery === total && anyButton === 0 && cleared === 20, `sa pretragom ${withQuery} (dugmadi ${anyButton}), bez ${cleared}`);
  await ctx.close();
}

// ---------------------------------------------------------------- Pregled: naslov heroja (R16), prvi prikaz brojeva (R27), traka kao jedan tab-stop (R20)
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', locale: 'sr-Latn-RS', timezoneId: 'Europe/Belgrade' });
  const page = await ctx.newPage();
  watch(page, 'hero');
  // Beleži svaku promenu teksta u `CountUp` elementima Pregleda (struktura iz fx/CountUp.tsx:
  // omotač sa tačno dva deteta – span[aria-hidden] sa brojem i span.sr-only sa konačnom
  // vrednošću; parovi skraćenica „1 st.“/„1 stanica“ nisu brojevi i ne broje se): posle prvog
  // prikaza ne sme biti nijedne promene – brojevi se ne „odbrojavaju“ od nule.
  await page.addInitScript(() => {
    const log = [];
    window.__countUpLog = log;
    const isCountUp = (el) =>
      Boolean(
        el &&
          el.nodeType === 1 &&
          el.matches('span[aria-hidden]') &&
          el.childElementCount === 0 &&
          el.parentElement?.childElementCount === 2 &&
          el.nextElementSibling?.matches('span.sr-only') &&
          el.nextElementSibling.childElementCount === 0 &&
          /^(–|[\d.,\s−-]+)$/.test(el.nextElementSibling.textContent) &&
          el.closest('[data-testid="view-pregled"]'),
      );
    window.__isCountUp = isCountUp;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') {
          const el = record.target.parentElement;
          if (isCountUp(el)) log.push(`${record.oldValue}→${record.target.data}`);
        } else if (record.type === 'childList' && isCountUp(record.target) && record.removedNodes.length) {
          log.push(`replace→${record.target.textContent}`);
        }
      }
    });
    // `document` (ne documentElement – pre parsiranja ga još nema).
    observer.observe(document, { subtree: true, characterData: true, characterDataOldValue: true, childList: true });
  });
  /** Pravilo naslova iz `heroHeadline` (overviewText.ts), ponovljeno nezavisno: dominantna = najbrojnija (pri jednakom broju lošija); ≥ 40 % u lošijim → dva stanja. */
  const expectedHeadline = (counts) => {
    const reporting = counts.reduce((a, b) => a + b, 0);
    let dominant = 0;
    counts.forEach((count, rank) => {
      if (count >= counts[dominant]) dominant = rank;
    });
    let worse = 0;
    let worseMode = null;
    for (let rank = dominant + 1; rank < counts.length; rank++) {
      worse += counts[rank];
      if (counts[rank] > 0 && (worseMode === null || counts[rank] >= counts[worseMode])) worseMode = rank;
    }
    const labels = ['dobar', 'prihvatljiv', 'umeren', 'zagađen', 'veoma zagađen', 'izuzetno zagađen'];
    if (worseMode !== null && worse / reporting >= 0.4) return `Vazduh je ${labels[dominant]} do ${labels[worseMode]}`;
    const share = counts[dominant] / reporting;
    return `Vazduh je ${share >= 0.999 ? 'svuda' : share >= 0.5 ? 'uglavnom' : 'najčešće'} ${labels[dominant]}`;
  };
  const readHero = async () => ({
    h1: (await page.locator('#hero-title').innerText()).replace(/\s+/g, ' ').trim(),
    counts: (await page.locator('.ov-legend__row .tnum').allInnerTexts()).map((t) => Number(t.replace(/\D/g, ''))),
  });
  // Dvomodalan dan: podrazumevani demo u 16:28 (Europe/Belgrade) – 1/13/11/0/0/0, 11 od 25 (44 %) lošije od „prihvatljiv“.
  await page.clock.setFixedTime(new Date('2026-10-08T14:28:00Z'));
  await page.goto(`${base}?t=bimodal#/`);
  await ready(page, 'pregled');
  await page.waitForTimeout(1600);
  const bimodal = await readHero();
  check('Pregled: naslov sa dva stanja na dvomodalan dan („prihvatljiv do umeren“)', /^Vazduh je prihvatljiv do umeren$/.test(bimodal.h1) && bimodal.h1 === expectedHeadline(bimodal.counts), `„${bimodal.h1}“ · stanice ${bimodal.counts.join('/')}`);
  const noDangling = await page.evaluate(() => {
    const h1 = document.getElementById('hero-title');
    const range = document.createRange();
    const rects = [];
    for (const node of h1.querySelectorAll('span')) {
      range.selectNodeContents(node);
      rects.push(...range.getClientRects());
    }
    return { lines: new Set(rects.map((r) => Math.round(r.top))).size, text: h1.textContent };
  });
  check('Pregled: „do“ je vezano za reč kategorije (nema reda koji se završava na „do“)', /do \S/.test(noDangling.text), `redova ${noDangling.lines}`);
  const countUps = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-testid="view-pregled"] span[aria-hidden]')].filter((el) => window.__isCountUp(el));
    return {
      nodes: nodes.length,
      mismatched: nodes.filter((el) => el.textContent !== el.nextElementSibling.textContent).map((el) => `${el.textContent}≠${el.nextElementSibling.textContent}`),
      log: window.__countUpLog,
    };
  });
  check(
    'Pregled: KPI brojevi se pri prvom prikazu ne odbrojavaju od nule (nijedna promena teksta posle prikaza)',
    countUps.nodes > 0 && countUps.log.length === 0 && countUps.mismatched.length === 0,
    `CountUp ${countUps.nodes}, promena ${countUps.log.length}${countUps.log.length ? `: ${countUps.log.slice(0, 4).join(', ')}` : ''}, neslaganja ${countUps.mismatched.length}${countUps.mismatched.length ? `: ${countUps.mismatched.slice(0, 3).join(', ')}` : ''}`,
  );
  await page.screenshot({ path: join(outDir, 'desk-pregled-bimodal.png') });

  // Traka „Uživo“: tačno jedan tab-stop po stanicama (+ „Zaustavi traku“), strelice vode dalje.
  const ticker = page.locator('.ov-ticker');
  const tabbable = await ticker.evaluate((root) => {
    const items = [...root.querySelectorAll('.marquee button, .marquee a')];
    const stops = items.filter((el) => el.tabIndex === 0);
    return { items: items.length, stops: stops.length, stopText: stops.map((el) => el.textContent.trim().slice(0, 30)) };
  });
  await ticker.locator('.marquee button[tabindex="0"]').first().focus();
  const focused = await page.evaluate(() => document.activeElement?.closest('.ov-ticker .marquee') !== null);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  const afterArrow = await page.evaluate(() => ({ inMarquee: document.activeElement?.closest('.ov-ticker .marquee') !== null, text: document.activeElement?.textContent?.trim().slice(0, 30) }));
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  const afterTab = await page.evaluate(() => ({ inMarquee: document.activeElement?.closest('.ov-ticker .marquee') !== null, inTicker: document.activeElement?.closest('.ov-ticker') !== null, text: document.activeElement?.textContent?.trim().slice(0, 30) || document.activeElement?.getAttribute('aria-label') }));
  check(
    'Pregled: traka „Uživo“ je jedan tab-stop (strelica vodi po stanicama, Tab izlazi iz liste)',
    tabbable.items >= 12 && tabbable.stops === 1 && focused && afterArrow.inMarquee && afterArrow.text !== tabbable.stopText[0] && !afterTab.inMarquee,
    `stavki ${tabbable.items}, tab-stopova ${tabbable.stops}; → „${afterArrow.text}“; Tab → „${afterTab.text}“${afterTab.inTicker ? ' (u traci)' : ''}`,
  );

  // Jednomodalan dan (18:28 lokalno, 0/4/21/0/0/0): jedno stanje, isto pravilo.
  await page.clock.setFixedTime(new Date('2026-10-08T16:28:00Z'));
  await page.goto(`${base}?t=unimodal#/`);
  await ready(page, 'pregled');
  await page.waitForTimeout(600);
  const unimodal = await readHero();
  check('Pregled: jednomodalan dan ostaje jedno stanje („uglavnom umeren“)', /^Vazduh je uglavnom umeren$/.test(unimodal.h1) && unimodal.h1 === expectedHeadline(unimodal.counts), `„${unimodal.h1}“ · stanice ${unimodal.counts.join('/')}`);
  await ctx.close();
}

// ---------------------------------------------------------------- demo scenario: Beograd (?demo=beograd) – grupa stanica i uvećan okrug
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', locale: 'sr-Latn-RS', timezoneId: 'Europe/Belgrade' });
  const page = await ctx.newPage();
  watch(page, 'beograd');
  await page.goto(`${base}?demo=beograd#/?view=mapa`);
  await ready(page, 'mapa');
  await page.waitForSelector('[data-testid="serbia-map"] svg path');
  await page.waitForTimeout(800);
  const map = page.locator('[data-testid="serbia-map"]');
  const clusters = map.locator('button.mk--cluster');
  const clusterName = (await clusters.count()) ? await clusters.first().getAttribute('aria-label') : '';
  const notesBefore = await map.locator('[data-testid="map-notes"]').innerText();
  const areaBefore = await map.locator('.smap__area').innerText();
  const stationsBefore = await map.locator('button.mk:not(.mk--cluster)').count();
  check(
    '?demo=beograd Mapa: jedna grupa „Grad Beograd · 33 stanice“, red i napomena u legendi, razmernik 50 km',
    (await clusters.count()) === 1 && /^Grad Beograd · 33 stanice · .* — dodir otvara okrug$/.test(clusterName) && /Gust okrug \(Grad Beograd · 33\) je prikazan kao grupa stanica/.test(notesBefore) && (await map.locator('[data-testid="cluster-key"]').count()) === 1 && /50 km/.test(areaBefore) && stationsBefore === 24,
    `grupa „${clusterName}“, pojedinačnih tačaka ${stationsBefore}`,
  );
  await page.screenshot({ path: join(outDir, 'beograd-mapa-grupa.png') });

  await clusters.first().click();
  await page.waitForTimeout(900);
  /** Dugmad oznaka u okviru mape: sva, cela unutar okvira, beogradska (neprigušena), grupe. */
  const zoomState = () =>
    map.evaluate((root) => {
      const area = root.querySelector('.smap__area');
      const a = area.getBoundingClientRect();
      const buttons = [...root.querySelectorAll('button.mk:not(.mk--cluster)')];
      const inside = buttons.filter((b) => {
        const r = b.getBoundingClientRect();
        return r.left >= a.left - 1 && r.right <= a.right + 1 && r.top >= a.top - 1 && r.bottom <= a.bottom + 1;
      }).length;
      const own = buttons.filter((b) => /^Demo stanica Beograd \d+,/.test(b.getAttribute('aria-label') ?? '') && !b.hasAttribute('data-dim')).length;
      return {
        buttons: buttons.length,
        inside,
        own,
        clusters: root.querySelectorAll('button.mk--cluster').length,
        area: area.innerText,
        legend: root.querySelector('.smap__legend')?.innerText ?? '',
        vb: root.querySelector('svg.smap__land')?.getAttribute('viewBox') ?? '',
        clipped: getComputedStyle(area).overflow === 'hidden',
      };
    });
  const zoomed = await zoomState();
  const okrugParam = hashParams(page).get('okrug');
  const panelText = await page.locator('[data-testid="view-mapa"]').innerText();
  check(
    '?demo=beograd Mapa: dodir na grupu otvara okrug – ?okrug=Grad Beograd, bez grupe, 33 beogradske tačke cele u okviru, mreža „44,5°N“, razmernik 20 km, legenda prati okrug',
    okrugParam === 'Grad Beograd' && zoomed.clusters === 0 && zoomed.own === 33 && zoomed.inside === zoomed.buttons && zoomed.buttons >= 33 && zoomed.clipped && /44,5°N/.test(zoomed.area) && /\b20 km\b/.test(zoomed.area) && !/50 km/.test(zoomed.area) && /van okruga \(prigušeno\)/.test(zoomed.legend) && /Grad Beograd/.test(panelText),
    `okrug=${okrugParam}, dugmadi ${zoomed.buttons} (u okviru ${zoomed.inside}, beogradskih ${zoomed.own}), viewBox ${zoomed.vb}`,
  );
  await page.screenshot({ path: join(outDir, 'beograd-mapa-okrug.png') });

  // Ponovo cela mreža: čip „Ukloni filter“ u gornjoj traci vraća grupu i razmernik od 50 km.
  await page.locator('header').getByRole('button', { name: /Ukloni filter/ }).click();
  await page.waitForTimeout(900);
  const reset = await zoomState();
  check('?demo=beograd Mapa: „Ukloni filter“ vraća celu mapu (50 km, bez sečenja) i grupu', !hashParams(page).get('okrug') && reset.clusters === 1 && /50 km/.test(reset.area) && !reset.clipped && reset.buttons === 24, `dugmadi ${reset.buttons}, grupa ${reset.clusters}`);

  // Tastatura: Enter na grupi otvara okrug, a fokus prelazi na prvu stanicu u okviru (ne ispada iz mape).
  await clusters.first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const focused = await page.evaluate(() => ({ cls: document.activeElement?.className ?? '', label: document.activeElement?.getAttribute('aria-label') ?? '' }));
  check(
    '?demo=beograd Mapa: Enter na grupi otvara okrug i fokus prelazi na prvu stanicu u okviru',
    hashParams(page).get('okrug') === 'Grad Beograd' && /(^|\s)mk(\s|$)/.test(focused.cls) && !/mk--cluster/.test(focused.cls) && /^Demo stanica/.test(focused.label),
    `fokus „${focused.label.slice(0, 60)}“`,
  );

  // Pregled: kompaktna mapa ima istu grupu, a dodir na nju filtrira celu stranicu po okrugu.
  await page.goto(`${base}?demo=beograd#/?view=pregled`);
  await ready(page, 'pregled');
  await page.waitForTimeout(900);
  const preview = page.locator('.smap--compact button.mk--cluster');
  const previewCount = await preview.count();
  await page.screenshot({ path: join(outDir, 'beograd-pregled-grupa.png') });
  if (previewCount) await preview.first().click();
  await page.waitForTimeout(900);
  const previewZoom = await page.evaluate(() => ({
    clusters: document.querySelectorAll('.smap--compact button.mk--cluster').length,
    own: [...document.querySelectorAll('.smap--compact button.mk')].filter((b) => !b.hasAttribute('data-dim')).length,
    filter: /aktivan filter/i.test(document.querySelector('[data-testid="view-pregled"]')?.innerText ?? ''),
  }));
  check(
    '?demo=beograd Pregled: kompaktna mapa ima grupu „Grad Beograd · 33“; dodir filtrira stranicu po okrugu i uvećava mapu (33 tačke)',
    previewCount === 1 && hashParams(page).get('okrug') === 'Grad Beograd' && previewZoom.clusters === 0 && previewZoom.own === 33 && previewZoom.filter === true,
    `grupa ${previewCount}, posle dodira: grupa ${previewZoom.clusters}, tačaka ${previewZoom.own}`,
  );
  await page.screenshot({ path: join(outDir, 'beograd-pregled-okrug.png') });
  await ctx.close();
}

// ---------------------------------------------------------------- telefon 390×664 + ?demo=beograd: dodir na grupu, pa na tačku (traka izabrane stanice)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'sr-Latn-RS', timezoneId: 'Europe/Belgrade' });
  const page = await ctx.newPage();
  watch(page, 'beograd-phone');
  await page.goto(`${base}?demo=beograd#/?view=mapa`);
  await ready(page, 'mapa');
  await page.waitForSelector('[data-testid="serbia-map"] svg path');
  await page.waitForTimeout(800);
  const map = page.locator('[data-testid="serbia-map"]');
  const tapOn = async (locator) => {
    try {
      await locator.tap({ timeout: 5000 });
    } catch {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    }
  };
  const cluster = map.locator('button.mk--cluster').first();
  const clusterBox = await cluster.boundingBox();
  await tapOn(cluster);
  await page.waitForTimeout(900);
  const phoneZoom = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    clusters: document.querySelectorAll('[data-testid="serbia-map"] button.mk--cluster').length,
    own: [...document.querySelectorAll('[data-testid="serbia-map"] button.mk')].filter((b) => /^Demo stanica Beograd \d+,/.test(b.getAttribute('aria-label') ?? '') && !b.hasAttribute('data-dim')).length,
  }));
  check(
    '390×664 ?demo=beograd: dodir na grupu (dugme ≥ 32 px) uvećava okrug – 33 beogradske tačke, bez vodoravnog skrola',
    Boolean(clusterBox && clusterBox.width >= 32 && clusterBox.height >= 32) && hashParams(page).get('okrug') === 'Grad Beograd' && phoneZoom.clusters === 0 && phoneZoom.own === 33 && phoneZoom.sw <= phoneZoom.cw,
    `dugme grupe ${clusterBox ? `${Math.round(clusterBox.width)}×${Math.round(clusterBox.height)}` : '–'}, tačaka ${phoneZoom.own}, scrollWidth ${phoneZoom.sw}/${phoneZoom.cw}`,
  );
  await page.screenshot({ path: join(outDir, 'phone-664-beograd-okrug.png') });

  // Pravilo iz prethodne runde važi i na uvećanom okrugu: dodir na tačku → traka cela vidljiva iznad donje
  // navigacije (ćelije od 28 px susednih tačaka se preklapaju, pa dodir sme da pogodi i susednu beogradsku stanicu).
  await tapOn(page.locator('button.mk[aria-label^="Demo stanica Beograd 1,"]').first());
  await page.waitForTimeout(700);
  const strip = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="selected-strip"]');
    const nav = [...document.querySelectorAll('nav[aria-label="Stranice"]')].pop();
    const r = (node) => (node ? (({ top, bottom, left, right }) => ({ top: Math.round(top), bottom: Math.round(bottom), left: Math.round(left), right: Math.round(right) }))(node.getBoundingClientRect()) : null);
    return { strip: r(el), placement: el?.dataset.placement ?? null, name: el?.querySelector('p')?.textContent ?? '', nav: nav && getComputedStyle(nav).display !== 'none' ? r(nav) : null, vh: window.innerHeight, vw: window.innerWidth };
  });
  const s = strip.strip;
  check(
    '390×664 ?demo=beograd: posle dodira na tačku uvećanog okruga traka izabrane stanice lebdi cela vidljiva iznad donje navigacije',
    Boolean(s && strip.placement === 'fixed' && /Demo stanica Beograd \d+/.test(strip.name) && s.top >= 0 && s.bottom <= strip.vh && s.left >= 0 && s.right <= strip.vw && strip.nav && s.bottom <= strip.nav.top),
    `strip=${JSON.stringify(s)} nav.top=${strip.nav?.top} „${strip.name}“`,
  );
  await page.screenshot({ path: join(outDir, 'phone-664-beograd-strip.png') });
  await ctx.close();
}

check('bez grešaka u konzoli', errors.length === 0, errors.slice(0, 5).join(' || '));
await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} provera prošlo.`);
process.exit(failed.length ? 1 : 0);
