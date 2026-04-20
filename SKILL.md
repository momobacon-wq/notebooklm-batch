---
name: notebooklm-batch
description: Batch-query all NotebookLM notebooks with the same question and export a consolidated Google Doc. Use when user wants to ask a question across multiple NotebookLM notebooks and get a summary.
---

# NotebookLM Batch Query Skill

This skill batch-queries multiple NotebookLM notebooks with the same question and uploads the consolidated answers to a Google Doc.

## Prerequisites (one-time setup)

1. `notebooklm-mcp` installed (via `npx -y notebooklm-mcp@latest` — it caches on first run)
2. System Chrome installed (patchright uses `channel: 'chrome'`)
3. Google authentication done — run `node scripts/auth.mjs` once and log in to the NotebookLM Google account in the browser window that opens
4. Google Drive MCP available in current Claude Code session (claude.ai Google Drive)

## Workflow

When the user asks something like "對所有 NotebookLM 筆記本問 XXX 然後統整":

### Step 1 — List notebooks (only if not cached)

```bash
node scripts/list-notebooks.mjs
```

Output: `data/notebooks.json` with every notebook's id/url/title.

Skip if `data/notebooks.json` already exists and user hasn't added/removed notebooks.

### Step 2 — Batch query

Filter to relevant notebooks by title regex when the question has an obvious topic (e.g. question mentions "DLN" → filter to gas-turbine related titles). For 90+ notebooks, filtering matters — each query is ~60s.

```bash
QUESTION="使用者的問題" FILTER="正規表達式" OUTPUT="data/run-name.jsonl" node scripts/batch-query.mjs
```

Environment variables:
- `QUESTION` — the exact question to ask
- `FILTER` — JS regex string, matched against notebook titles (case insensitive). Omit for all notebooks.
- `LIMIT` — max notebooks to process (useful for dry runs)
- `OUTPUT` — JSONL output path. If file exists, already-queried notebooks are skipped (resumable).

Output format (one JSON per line):
```json
{"id":"...","title":"...","url":"...","answer":"{\"success\":true,\"data\":{\"answer\":\"...\"}}","elapsed_ms":71058}
```

Each `answer` field is a JSON-string containing the MCP tool response. The real answer is at `JSON.parse(answer).data.answer`.

### Step 3 — Format and upload to Google Doc

Generate plain text with UTF-8 BOM (critical — without BOM, Google Docs mangles Chinese characters during text/plain auto-conversion), base64-encode, and upload via the Google Drive MCP.

```bash
INPUT="data/run-name.jsonl" TITLE="彙整文件標題" node scripts/format-for-upload.mjs
```

This writes `data/run-name.txt.b64` with the base64 content. Then call the Google Drive MCP:

```
mcp__claude_ai_Google_Drive__create_file({
  title: "彙整文件標題",
  mimeType: "text/plain",    // auto-converts to application/vnd.google-apps.document
  content: <contents of run-name.txt.b64>
})
```

Return the resulting `https://docs.google.com/document/d/{id}/edit` URL to the user.

## Gotchas

- **UTF-8 BOM is mandatory** for Chinese content. `text/plain` → Google Doc conversion without BOM produces garbled output
- **`text/html` does NOT auto-convert** to Google Doc via this MCP — it creates an HTML file viewable only in Drive, not editable as a Doc. Use `text/plain` with BOM instead
- **MCP tools in Claude Code don't load** (`claude mcp list` says Connected but tool schemas never appear in ToolSearch). All notebooklm-mcp calls must go through the bootstrap pattern in `batch-query.mjs` (spawn + JSON-RPC over stdio)
- **notebooklm-mcp library is separate** from the user's Google account notebooks. The MCP's internal `list_notebooks` only lists what was added via `add_notebook`. To enumerate the actual Google account notebooks, scrape the web UI (`list-notebooks.mjs`)
- **Each query takes 30–90s** (browser navigation + Gemini response). Don't estimate faster than 60s/notebook average
- **Free tier NotebookLM limit: 50 queries/day.** Pro tier has no limit. Check user's account type before large batches
- **Resume on crash**: `batch-query.mjs` writes JSONL incrementally and skips already-done ids on restart. Let this work for you — don't delete the output file between runs unless you want to redo everything

## Example invocation

User: "幫我找所有 notebook 有關 DLN 的資料"

1. Check `data/notebooks.json` exists — if not, run list-notebooks.mjs
2. Filter by `氣渦輪|燃氣|燃燒|GT|DLN|NOx` (DLN is gas-turbine related — narrows 95 → ~14 notebooks)
3. Run batch-query.mjs with the question, save to `data/dln.jsonl`
4. Run format-for-upload.mjs on the JSONL
5. Upload via Google Drive MCP with `mimeType: text/plain`
6. Return the Google Docs URL to the user
