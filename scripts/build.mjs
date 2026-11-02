// Build the distribution package of PixelForge.
//
//   npm run build  →  dist/pixelforge/            (upload this folder's contents)
//                     dist/pixelforge-<version>.zip
//
// Development uses the ES modules in js/ directly. For distribution, esbuild
// bundles them into one minified app.js (classic script, so it also runs from
// file://), minifies style.css, and index.html is pointed at app.js with the
// build version as query string so browsers fetch a new build after updates.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(dist, 'pixelforge');
const COPY = ['index.html', 'LICENSE'];
// Browsers with ES2020 + current Canvas features (Chrome/Edge 90+, Firefox 90+, Safari 15+)
const TARGET = ['es2020', 'chrome90', 'firefox90', 'safari15'];

const version = (() => {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const rev = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
    const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim() ? '-dirty' : '';
    return `${date}-${rev}${dirty}`;
  } catch {
    return date;
  }
})();

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of COPY) cpSync(join(root, f), join(out, f), { recursive: true });

// all modules → one minified classic script
await build({
  entryPoints: [join(root, 'js/main.js')],
  outfile: join(out, 'app.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: TARGET,
  legalComments: 'none',
  banner: { js: '"use strict";' },   // the modules ran in strict mode; keep it for the classic script
  logLevel: 'warning',
});
await build({
  entryPoints: [join(root, 'style.css')],
  outfile: join(out, 'style.css'),
  bundle: true,
  minify: true,
  target: TARGET,
  logLevel: 'warning',
});

// index.html: load the bundle (version query for cache busting)
const indexPath = join(out, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const entry = '<script type="module" src="js/main.js"></script>';
if (!html.includes(entry)) throw new Error('index.html: entry script tag not found');
writeFileSync(indexPath, html
  .replace(entry, `<script src="app.js?v=${version}"></script>`)
  .replace('href="style.css"', `href="style.css?v=${version}"`)
  // light HTML minification: comments and indentation only (index.html has no <pre>/<textarea>;
  // whitespace between inline elements is kept as a newline)
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[ \t]+/gm, '')
  .replace(/\n{2,}/g, '\n'));

// ── ZIP (deflate) ─────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function listFiles(dir) {
  return readdirSync(dir).sort().flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

function zip(dir) {
  const local = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const file of listFiles(dir)) {
    const name = Buffer.from(relative(dir, file).split('\\').join('/'));
    const data = readFileSync(file);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt16LE(dosTime, 10); header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10); entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

const zipPath = join(dist, `pixelforge-${version}.zip`);
writeFileSync(zipPath, zip(out));
const files = listFiles(out);
const size = files.reduce((s, f) => s + statSync(f).size, 0);
console.log(`PixelForge ${version}: ${files.length} files, ${(size / 1024).toFixed(0)} KB`);
console.log(`  folder: ${relative(root, out)}/`);
console.log(`  zip:    ${relative(root, zipPath)} (${(statSync(zipPath).size / 1024).toFixed(0)} KB)`);
