#!/usr/bin/env node
// Batch-query a set of NotebookLM notebooks with the same question.
// Env vars:
//   QUESTION  - the question to ask (required)
//   FILTER    - optional JS regex to filter notebook titles (case insensitive)
//   LIMIT     - optional max number of notebooks to query
//   OUTPUT    - JSONL output path (default: data/results.jsonl). Resumable — existing ids are skipped.
//   NOTEBOOKS - path to notebooks.json (default: data/notebooks.json)

import { spawn } from 'node:child_process';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const QUESTION = process.env.QUESTION;
if (!QUESTION) {
  console.error('QUESTION env var required');
  process.exit(1);
}
const NOTEBOOKS_FILE = process.env.NOTEBOOKS || `${ROOT}/data/notebooks.json`;
const OUTPUT_FILE = process.env.OUTPUT || `${ROOT}/data/results.jsonl`;
const FILTER = process.env.FILTER;
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : null;

let notebooks = JSON.parse(readFileSync(NOTEBOOKS_FILE, 'utf8'));
if (FILTER) {
  const re = new RegExp(FILTER, 'i');
  notebooks = notebooks.filter((n) => re.test(n.title));
}
if (LIMIT) notebooks = notebooks.slice(0, LIMIT);

const done = new Set();
if (existsSync(OUTPUT_FILE)) {
  for (const line of readFileSync(OUTPUT_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).id); } catch {}
  }
}
const todo = notebooks.filter((n) => !done.has(n.id));

console.log(`Question: ${QUESTION}`);
console.log(`Total matching: ${notebooks.length}, already done: ${done.size}, todo: ${todo.length}`);
console.log(`Output: ${OUTPUT_FILE}\n`);

if (todo.length === 0) {
  console.log('Nothing to do. Delete output file to re-run from scratch.');
  process.exit(0);
}

const proc = spawn('npx', ['-y', 'notebooklm-mcp@latest'], {
  stdio: ['pipe', 'pipe', 'ignore'],
  shell: true,
  env: { ...process.env, HEADLESS: 'true' },
});

let buf = '';
let nextId = 1;
const pending = new Map();

proc.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line || !line.startsWith('{')) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {}
  }
});

function send(method, params, timeoutMs = 600000) {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
  });
}

function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

await new Promise((r) => setTimeout(r, 5000));

await send('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'notebooklm-skill-batch', version: '1.0.0' },
});
notify('notifications/initialized', {});
console.log('← MCP ready\n');

const started = Date.now();
let i = 0;
for (const nb of todo) {
  i++;
  const t0 = Date.now();
  process.stdout.write(`[${i}/${todo.length}] ${nb.title.slice(0, 50)} ... `);
  try {
    const resp = await send('tools/call', {
      name: 'ask_question',
      arguments: { question: QUESTION, notebook_url: nb.url },
    }, 300000);
    const text = resp.result?.content?.[0]?.text ?? JSON.stringify(resp.result);
    appendFileSync(OUTPUT_FILE, JSON.stringify({
      id: nb.id, title: nb.title, url: nb.url, answer: text, elapsed_ms: Date.now() - t0,
    }) + '\n');
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    appendFileSync(OUTPUT_FILE, JSON.stringify({
      id: nb.id, title: nb.title, url: nb.url, error: err.message, elapsed_ms: Date.now() - t0,
    }) + '\n');
    console.log(`ERROR: ${err.message}`);
  }
}

console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s. Results: ${OUTPUT_FILE}`);

proc.stdin.end();
setTimeout(() => proc.kill(), 2000);
