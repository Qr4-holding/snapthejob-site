// Makes a skin's app icons from its brand colour (or its own logo).
// Usage: node tools/make-icons.js <skin-id> [#colour] [path/to/logo.png]
//   no logo: the camera mark on the colour (like SnapTheJob and CleanUpSnap)
//   with logo: the logo centred on the colour (white if none given), framed so phones never crop it
// Needs Playwright (dev machine only; not used by the live site).
const fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const [id, colourArg, logo] = process.argv.slice(2);
if (!id) { console.log('Usage: node tools/make-icons.js <skin-id> [#colour] [logo.png]'); process.exit(1); }
const skinDir = path.join(__dirname, '..', 'skins', id);
const skin = JSON.parse(fs.readFileSync(path.join(skinDir, 'skin.json'), 'utf8'));
const colour = colourArg || skin.theme;
const out = path.join(skinDir, 'public', 'assets');
fs.mkdirSync(out, { recursive: true });
const cam = `<g fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></g>`;
const logoData = logo ? `data:image/${path.extname(logo).slice(1).replace('jpg', 'jpeg')};base64,${fs.readFileSync(logo).toString('base64')}` : '';
// safe = how much of the square the mark may fill (maskable icons are cropped to a circle by Android, so they get less)
const svg = (rounded, safe) => logoData
  ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" ${rounded ? 'rx="12"' : ''} fill="${colourArg || '#fff'}"/><image href="${logoData}" x="${24 - 24 * safe}" y="${24 - 24 * safe}" width="${48 * safe}" height="${48 * safe}" preserveAspectRatio="xMidYMid meet"/></svg>`
  : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" ${rounded ? 'rx="12"' : ''} fill="${colour}"/><g transform="translate(${24 - 24 * safe} ${24 - 24 * safe}) scale(${2 * safe})">${cam}</g></svg>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const shot = async (file, size, rounded, safe) => {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg(rounded, safe).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: path.join(out, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('made', file);
  };
  const f = logoData ? 0.8 : 0.585, fm = logoData ? 0.62 : 0.52;
  await shot('icon-192.png', 192, true, f);
  await shot('icon-512.png', 512, true, f);
  await shot('icon-maskable-512.png', 512, false, fm);
  await shot('apple-touch-icon.png', 180, false, f);
  fs.writeFileSync(path.join(out, 'icon.svg'), svg(true, f));
  console.log('made icon.svg');
  await b.close();
})();
