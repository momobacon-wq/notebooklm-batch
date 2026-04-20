#!/usr/bin/env node
// One-time Google auth setup for notebooklm-mcp.
// Opens a visible Chrome window. Log in to the Google account that owns your NotebookLM notebooks.
// Closes automatically once NotebookLM loads.

import { spawn } from 'node:child_process';

const proc = spawn('npx', ['-y', 'notebooklm-mcp@latest'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  shell: true,
  env: { ...process.env, HEADLESS: 'false' },
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

function send(method, params, timeoutMs = 900000) {
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

await new Promise((r) => setTimeout(r, 4000));

console.log('→ initialize');
await send('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'notebooklm-skill-auth', version: '1.0.0' },
});
notify('notifications/initialized', {});

console.log('→ setup_auth (a browser window will open, log in to Google)');
const result = await send('tools/call', {
  name: 'setup_auth',
  arguments: { browser_options: { show: true, headless: false } },
});

console.log('\n=== Result ===');
console.log(JSON.stringify(result, null, 2));

proc.stdin.end();
setTimeout(() => proc.kill(), 2000);
