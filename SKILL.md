---
name: notebooklm-batch
description: Use this skill when the user wants to query multiple NotebookLM notebooks with the same question and get a consolidated answer. Triggers on phrases like "使用 notebooklm 在所有筆記本查詢 X", "所有 notebook 都問 X", "notebooklm 幫我查 X", "batch query notebooks", "ask all my notebooks about X". The skill scrapes the notebook list, runs filtered batch queries via the notebooklm-mcp server (bypassing the MCP-in-Claude-Code bug), and uploads a consolidated Markdown file to Google Drive for cloud reading.
---

# NotebookLM Batch Query Skill

This skill batch-queries multiple NotebookLM notebooks with the same question and uploads the consolidated answers as a Markdown file to Google Drive.

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

### Step 3 — Format as Markdown and upload to Drive

Generate a Markdown document with a table of contents and per-notebook sections, base64-encode, and upload to Google Drive as a raw `.md` file. Drive's preview pane renders Markdown, so the user can read it in the cloud without the encoding problems that plagued the previous `text/plain` → Google Doc flow.

```bash
INPUT="data/run-name.jsonl" TITLE="彙整文件標題" node scripts/format-markdown.mjs
```

This writes `data/run-name.md` (readable locally) and `data/run-name.md.b64` (for upload). Then call the Google Drive MCP:

```
mcp__claude_ai_Google_Drive__create_file({
  title: "彙整文件標題.md",
  mimeType: "text/markdown",
  content: <contents of run-name.md.b64>
})
```

Return the resulting Drive URL (`https://drive.google.com/file/d/{id}/view`) to the user. If they want it as an editable Google Doc, they can right-click in Drive → Open with → Google Docs.

#### Fallback: local Markdown only

If the Drive MCP is unavailable or fails, the `data/run-name.md` file is already a complete, readable document. Tell the user the local path and they can open it in VS Code / any Markdown viewer.

## Gotchas

- **Prefer `text/markdown` over `text/plain`**: the old text/plain → Google Doc auto-conversion mangled Chinese characters even with BOM across many runs. Raw `.md` upload is reliable and still renders in Drive's preview pane
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
4. Run format-markdown.mjs on the JSONL
5. Upload via Google Drive MCP with `mimeType: text/markdown`
6. Return the Drive URL to the user
