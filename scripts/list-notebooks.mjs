#!/usr/bin/env node
// Scrape the user's NotebookLM account for all notebook URLs.
// Requires auth.mjs to have been run first (uses the stored Chrome profile).
// Writes data/notebooks.json with {id, url, title}[].

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Reuse patchright from the notebooklm-mcp npx cache.
const { execSync } = await import('node:child_process');
const npxCache = execSync('npm config get cache', { encoding: 'utf8' }).trim() + '/_npx';

import { readdirSync, existsSync } from 'node:fs';
let patchrightDir = null;
if (existsSync(npxCache)) {
  for (const entry of readdirSync(npxCache)) {
    const candidate = `${npxCache}/${entry}/node_modules/patchright`;
    if (existsSync(candidate)) {
      patchrightDir = candidate;
      break;
    }
  }
}
if (!patchrightDir) {
  console.error('patchright not found. Run `npx -y notebooklm-mcp@latest --help` once to prime the cache, then retry.');
  process.exit(1);
}

const require = createRequire(`${patchrightDir}/package.json`);
const { chromium } = require('patchright');

// Resolve Chrome profile used by notebooklm-mcp (env-paths style: %LocalAppData%\notebooklm-mcp\Data).
const PROFILE = process.env.NOTEBOOKLM_PROFILE
  ?? `${process.env.LOCALAPPDATA || process.env.HOME + '/.local/share'}/notebooklm-mcp/Data/chrome_profile`;

console.log(`Chrome profile: ${PROFILE}`);
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1280, height: 900 },
});

const page = ctx.pages()[0] ?? await ctx.newPage();
console.log('→ opening notebooklm.google.com');
await page.goto('https://notebooklm.google.com/', { waitUntil: 'domcontentloaded' });

console.log('→ waiting for notebook grid to render');
await page.waitForTimeout(6000);

const notebooks = await page.evaluate(() => {
  const anchors = Array.from(document.querySelectorAll('a[href*="/notebook/"]'));
  const seen = new Set();
  const out = [];
  for (const a of anchors) {
    const href = a.href;
    const m = href.match(/\/notebook\/([^/?#]+)/);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);

    let title = '';
    const card = a.closest('[role="gridcell"], article, mat-card, project-card, project-list-item') || a.parentElement;
    if (card) {
      const titleEl = card.querySelector('[class*="title" i], [class*="name" i], h1, h2, h3, h4');
      if (titleEl) title = titleEl.innerText.trim().split('\n')[0];
    }
    if (!title) title = (a.getAttribute('aria-label') || a.innerText || '').trim().split('\n')[0];
    out.push({ id, url: href, title });
  }
  return out;
});

const outPath = `${ROOT}/data/notebooks.json`;
writeFileSync(outPath, JSON.stringify(notebooks, null, 2));
console.log(`\n=== Found ${notebooks.length} notebooks → ${outPath} ===`);

await ctx.close();
