#!/usr/bin/env node
// Convert a results JSONL to a Markdown document, base64-encoded for Drive upload.
// Uploaded as text/markdown — Drive keeps it as raw .md and renders it in the preview pane,
// avoiding the text/plain → Google Doc encoding issues that mangled Chinese output.
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

const b64 = Buffer.from(out, 'utf8').toString('base64');
const mdPath = INPUT.replace(/\.jsonl$/, '') + '.md';
const b64Path = INPUT.replace(/\.jsonl$/, '') + '.md.b64';
writeFileSync(mdPath, out);
writeFileSync(b64Path, b64);

console.log(`Markdown: ${mdPath} (${out.length} chars)`);
console.log(`Base64 for upload: ${b64Path} (${b64.length} chars)`);
console.log('\nNext step: upload via Google Drive MCP —');
console.log('  mcp__claude_ai_Google_Drive__create_file({');
console.log(`    title: "${TITLE}.md",`);
console.log('    mimeType: "text/markdown",');
console.log(`    content: <contents of ${b64Path}>`);
console.log('  })');
