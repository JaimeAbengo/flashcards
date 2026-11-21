// Bundles src/ into docs/app.js and stamps a version into the app and service worker.
import { build } from 'esbuild';
import fs from 'node:fs';
const d = new Date();
const p2 = n => String(n).padStart(2, '0');
const version = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: ['safari16'], outfile: 'docs/app.js', logLevel: 'warning',
  external: ['fs', 'path', 'crypto', 'node:fs', 'node:crypto', 'node:path'], define: { 'process.env.NODE_ENV': '"production"' } });
fs.writeFileSync('docs/app.js', fs.readFileSync('docs/app.js', 'utf8').replaceAll('__VERSION__', version));
fs.writeFileSync('docs/sw.js', fs.readFileSync('src/sw.js', 'utf8').replaceAll('__VERSION__', version));
console.log('built', version, (fs.statSync('docs/app.js').size / 1024).toFixed(0) + ' KB');
