// Bundles the few third-party libraries the app uses into self-contained ES modules
// under vendor/, so the site loads nothing from a CDN at runtime.
// Run after changing a vendored dependency version: npm run vendor
import { build } from 'esbuild';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';

const banner = (name) => `/* ${name} — vendored by scripts/build-vendor.js. See vendor/LICENSES.md. */`;

writeFileSync('vendor/.preact-entry.js', `
export { h, render, Fragment, createContext, createRef, toChildArray } from 'preact';
export { useState, useEffect, useMemo, useRef, useCallback, useContext, useReducer, useLayoutEffect, useId } from 'preact/hooks';
import { h } from 'preact';
import htm from 'htm';
export const html = htm.bind(h);
`);

await build({
  entryPoints: ['vendor/.preact-entry.js'], bundle: true, format: 'esm', minify: true,
  platform: 'browser', target: 'es2020', outfile: 'vendor/preact.js',
  banner: { js: banner('preact + preact/hooks + htm') }, legalComments: 'none',
});

await build({
  stdin: { contents: `export { default } from '@anthropic-ai/sdk'; export * from '@anthropic-ai/sdk';`, resolveDir: process.cwd() },
  bundle: true, format: 'esm', minify: true, platform: 'browser', target: 'es2020',
  outfile: 'vendor/anthropic-sdk.js', banner: { js: banner('@anthropic-ai/sdk ' + JSON.parse(readFileSync('node_modules/@anthropic-ai/sdk/package.json', 'utf8')).version) },
  legalComments: 'none',
});
unlinkSync('vendor/.preact-entry.js');
const license = (pkg) => readFileSync(`node_modules/${pkg}/LICENSE`, 'utf8').trim();
const ver = (pkg) => JSON.parse(readFileSync(`node_modules/${pkg}/package.json`, 'utf8')).version;
writeFileSync('vendor/LICENSES.md', [
  '# Third-party licenses',
  '',
  'The files in this folder are bundles of these packages, built by scripts/build-vendor.js.',
  '',
  ...['preact', 'htm', '@anthropic-ai/sdk'].flatMap((p) => [`## ${p} ${ver(p)}`, '', '```', license(p), '```', '']),
].join('\n'));
console.log('vendor bundles written');
