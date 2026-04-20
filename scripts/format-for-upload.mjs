#!/usr/bin/env node
// Convert a results JSONL to a plain-text document with UTF-8 BOM, base64-encoded.
// The output .txt.b64 file can be uploaded via Google Drive MCP as text/plain — it
// auto-converts to a Google Doc. The BOM is critical: without it, the text/plain
// conversion mangles non-ASCII characters.
//
// Env vars:
//   INPUT  - JSONL path (required)
//   TITLE  - optional title to put at top of doc (default: "NotebookLM 彙整")

import { readFileSync, writeFileSync } from 'node:fs';

const INPUT = process.env.INPUT;
if (!INPUT) {
  console.error('INPUT env var required');
  process.exit(1);
}
const TITLE = process.env.TITLE || 'NotebookLM 彙整';

const rows = readFileSync(INPUT, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const clean = (text) => {
  let t = text.replace(/\n*EXTREMELY IMPORTANT:[\s\S]*$/m, '').trim();
  t = t.replace(/^\s*\d+\s*$/gm, '');
  t = t.replace(/\s*more_horiz\s*/g, '');
  return t.trim();
};

let out = `${TITLE}\n`;
out += '='.repeat(Math.max(TITLE.length * 2, 40)) + '\n\n';
out += `筆記本數: ${rows.length}\n`;
out += `產出時間: ${new Date().toISOString()}\n\n`;

for (const [i, row] of rows.entries()) {
  let answer = '(無法解析)';
  let error = null;
  if (row.error) {
    error = row.error;
  } else {
    try {
      const parsed = JSON.parse(row.answer);
      answer = clean(parsed.data?.answer ?? parsed.answer ?? '');
    } catch {
      answer = clean(row.answer);
    }
  }

  out += `\n${'═'.repeat(50)}\n`;
  out += `【筆記本 ${i + 1}】${row.title}\n`;
  out += `URL: ${row.url}\n`;
  out += `耗時: ${(row.elapsed_ms / 1000).toFixed(1)} 秒\n`;
  out += `${'═'.repeat(50)}\n\n`;
  if (error) {
    out += `[查詢失敗] ${error}\n\n`;
  } else {
    out += answer + '\n\n';
  }
}

// Prepend UTF-8 BOM — critical for Google Docs text/plain conversion
const withBOM = '\uFEFF' + out;
const b64 = Buffer.from(withBOM, 'utf8').toString('base64');

const b64Path = INPUT.replace(/\.jsonl$/, '') + '.txt.b64';
const txtPath = INPUT.replace(/\.jsonl$/, '') + '.txt';
writeFileSync(txtPath, withBOM);
writeFileSync(b64Path, b64);

console.log(`Plain text: ${txtPath} (${out.length} chars)`);
console.log(`Base64 for upload: ${b64Path} (${b64.length} chars)`);
console.log('\nNext step: upload via Google Drive MCP —');
console.log('  mcp__claude_ai_Google_Drive__create_file({');
console.log(`    title: "${TITLE}",`);
console.log('    mimeType: "text/plain",');
console.log(`    content: <contents of ${b64Path}>`);
console.log('  })');
