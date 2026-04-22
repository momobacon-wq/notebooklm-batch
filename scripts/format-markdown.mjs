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

// NotebookLM's Gemini output scatters line-breaks inside units and punctuation,
// and leaves citation numbers as bare-digit lines. Clean that up without touching
// legitimate list numbering (which uses "1." not "1\n").
const clean = (text) => {
  let t = text.replace(/\n*EXTREMELY IMPORTANT:[\s\S]*$/m, '').trim();

  // 1. Strip NotebookLM UI residue.
  t = t.replace(/\s*more_horiz\s*/g, ' ');

  // 2. Rejoin units broken across lines.
  //    "50\n∘\nC" → "50°C",  "m\n\n3\n/h" → "m³/h",  "3455 m\n\n/h" → "3455 m³/h"
  t = t.replace(/(\d)\s*\n\s*∘\s*\n?\s*C/g, '$1°C');
  t = t.replace(/∘\s*\n?\s*C/g, '°C');
  t = t.replace(/(m|ft)\s*\n\s*3\s*\n\s*\/\s*(h|s|min)/gi, '$1³/$2');
  t = t.replace(/(\d+(?:\.\d+)?)\s*m\s*\n+\s*\/\s*(h|s|min)/gi, '$1 m³/$2'); // cube lost entirely
  t = t.replace(/(\d)\s*\n\s*2\s*\n?/g, '$1² ');
  t = t.replace(/(\d)\s*\n\s*³/g, '$1³');
  t = t.replace(/(\d)\s*\n\s*²/g, '$1²');

  // 3. Strip bare-digit lines (NotebookLM footnote markers). "1." list bullets survive.
  //    Deliberately no inline "mid-sentence digit" stripping — would mangle decimals
  //    like "20.8 MPa" into ".8 MPa". Most NotebookLM citations are already on their
  //    own line, so the line-only rule above catches them.
  t = t.replace(/^\s*\d+\s*$/gm, '');

  // 4. Rejoin punctuation orphaned onto its own line.
  t = t.replace(/\n\s*([。,，;；、!?！？」）\)])/g, '$1');

  // 5. Collapse whitespace: multiple blank lines → single blank line; trailing spaces.
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');

  // 6. Trim residual leading/trailing whitespace per line for readability.
  t = t.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n');

  return t.trim();
};

// Detect "no relevant content" answers so we can drop them from the body and
// list them as "skipped" at the end. Heuristic:
//   - short answer (< 300 chars) AND contains negation + relevance phrases
//   - answer is empty after cleaning
const NO_RESULT_PATTERNS = [
  /(沒有|未|無法|不)[^。]{0,12}(找到|提供|提及|包含|涵蓋|涉及)[^。]{0,20}(相關|此|該|ST|內容|資訊|資料|訊息)/,
  /(來源|資料|文件|筆記本)[^。]{0,20}(沒有|未|無)[^。]{0,20}(相關|提及|包含|涉及)/,
  /do(es)? not (contain|mention|cover|provide)[^.]{0,40}(information|content|data|relevant)/i,
  /no (relevant|specific) (information|content|data)/i,
  /the (provided )?sources? (do not|don['’]t)/i,
];

const isNoResult = (answer) => {
  if (!answer || !answer.trim()) return true;
  if (answer.length < 300) {
    for (const re of NO_RESULT_PATTERNS) if (re.test(answer)) return true;
  }
  // Even for longer answers, if the first 200 chars are a flat refusal, treat as no-result.
  const head = answer.slice(0, 200);
  let hits = 0;
  for (const re of NO_RESULT_PATTERNS) if (re.test(head)) hits++;
  return hits >= 2;
};

// Process rows into {row, answer, error, skipped} entries.
const processed = rows.map((row) => {
  let answer = '';
  let error = null;
  if (row.error) {
    error = row.error;
  } else {
    try {
      const parsed = JSON.parse(row.answer);
      answer = clean(parsed.data?.answer ?? parsed.answer ?? '');
    } catch {
      answer = clean(row.answer || '');
    }
  }
  const skipped = error ? 'error' : isNoResult(answer) ? 'no-result' : null;
  return { row, answer, error, skipped };
});

const kept = processed.filter((p) => !p.skipped);
const skipped = processed.filter((p) => p.skipped);

let out = `# ${TITLE}\n\n`;
out += `- 有效筆記本數: **${kept.length}** / ${processed.length}\n`;
if (skipped.length) out += `- 已略過(無結果或查詢失敗): ${skipped.length}\n`;
out += `- 產出時間: ${new Date().toISOString()}\n\n`;
out += `---\n\n`;

// Table of contents — only kept entries
out += `## 目錄\n\n`;
for (const [i, p] of kept.entries()) {
  out += `${i + 1}. [${p.row.title}](#${i + 1}-${p.row.title.replace(/\s+/g, '-')})\n`;
}
out += `\n---\n\n`;

for (const [i, p] of kept.entries()) {
  out += `## ${i + 1}. ${p.row.title}\n\n`;
  out += `- 來源: <${p.row.url}>\n`;
  out += `- 耗時: ${(p.row.elapsed_ms / 1000).toFixed(1)} 秒\n\n`;
  out += p.answer + '\n\n';
  out += `---\n\n`;
}

if (skipped.length) {
  out += `## 附錄:已略過的筆記本\n\n`;
  out += `以下筆記本經 NotebookLM 查詢後回覆「無相關內容」或查詢失敗,已從正文移除:\n\n`;
  for (const p of skipped) {
    const reason = p.error ? `查詢失敗: ${p.error}` : '無相關內容';
    out += `- **${p.row.title}** — ${reason}\n`;
  }
  out += `\n`;
}

const mdPath = INPUT.replace(/\.jsonl$/, '') + '.md';
writeFileSync(mdPath, out);

console.log(`Markdown: ${mdPath} (${out.length} chars)`);
console.log(`\nNext step: INPUT="${mdPath}" node scripts/upload.mjs`);
