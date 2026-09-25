/**
 * Packs the built game (dist/) into ONE self-contained HTML file that can be
 * shared and opened by double-clicking, with no install and no internet.
 *   npm run build:single   ->   release/mystical-armies.html
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');

// Replace each <script ... src="./assets/xxx.js"></script> with the script's contents inline.
html = html.replace(/<script([^>]*?)\ssrc="\.\/([^"]+\.js)"([^>]*)><\/script>/g, (_m, before, src, after) => {
  const code = readFileSync(join(dist, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  const attrs = `${before}${after}`.replace(/\scrossorigin(="[^"]*")?/g, '');
  return `<script${attrs}>\n${code}\n</script>`;
});
// Inline any stylesheet links too (none today, but keeps the file self-contained later).
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="\.\/([^"]+\.css)"[^>]*>/g, (_m, href) => {
  return `<style>\n${readFileSync(join(dist, href), 'utf8')}\n</style>`;
});
html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');

if (/src="\.\/assets\//.test(html)) throw new Error('Some assets were not inlined.');
mkdirSync('release', { recursive: true });
const out = join('release', 'mystical-armies.html');
writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024 / 1024).toFixed(1)} MB). Share this one file; open it by double-clicking.`);
