#!/usr/bin/env node
// Convert a results JSONL to a Markdown document.
// Output is full-fidelity (no truncation) — upload happens via rclone (scripts/upload.mjs),
// which streams the file directly to Drive and has no size limit.
//
// Env vars:
//   INPUT  - JSONL path (required)
//   TITLE  - optional title (default: "NotebookLM 彙整")

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

let out = `# ${TITLE}\n\n`;
out += `- 筆記本數: **${rows.length}**\n`;
out += `- 產出時間: ${new Date().toISOString()}\n\n`;
out += `---\n\n`;

// Table of contents
out += `## 目錄\n\n`;
for (const [i, row] of rows.entries()) {
  out += `${i + 1}. [${row.title}](#${i + 1}-${row.title.replace(/\s+/g, '-')})\n`;
}
out += `\n---\n\n`;

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

  out += `## ${i + 1}. ${row.title}\n\n`;
  out += `- 來源: <${row.url}>\n`;
  out += `- 耗時: ${(row.elapsed_ms / 1000).toFixed(1)} 秒\n\n`;
  if (error) {
    out += `> ⚠️ **查詢失敗**: ${error}\n\n`;
  } else {
    out += answer + '\n\n';
  }
  out += `---\n\n`;
}

const mdPath = INPUT.replace(/\.jsonl$/, '') + '.md';
writeFileSync(mdPath, out);

console.log(`Markdown: ${mdPath} (${out.length} chars)`);
console.log(`\nNext step: INPUT="${mdPath}" node scripts/upload.mjs`);
