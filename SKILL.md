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
4. **rclone installed and configured for Drive upload**:
   - Install: `winget install Rclone.Rclone` (restart shell afterward so `rclone` is on PATH)
   - Configure: `rclone config create gdrive drive scope=drive` — opens browser, log in with the same Google account
   - Verify: `rclone lsd gdrive:` should list Drive folders

## Workflow

When the user asks something like "對所有 NotebookLM 筆記本問 XXX 然後統整":

**Steps 1-5 are mandatory and must all run.** Do not stop after the batch query to ask whether to format, synthesise, or upload — the deliverable is the Drive URL, so `format-markdown.mjs` → synthesis prepend → `upload.mjs` always follow `batch-query.mjs`. You can report an early finding mid-batch, but still complete the full pipeline at the end. The only time to stop short is if every step 2 result failed (e.g. Chrome lockfile) — in that case fix the root cause and retry, don't skip to reporting.

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

### Step 3 — Format as Markdown

Generate a Markdown document with a table of contents and per-notebook sections. No truncation — the full Gemini answer for every notebook is preserved. The script automatically:

- **Cleans NotebookLM's broken formatting**: rejoins units split across lines (`∘\nC` → `°C`, `m\n\n/h` → `m³/h`), strips bare-digit lines left over from citation markers, rejoins orphaned punctuation (`\n。` → `。`), and collapses 3+ consecutive blank lines to a single blank line. Decimals like `20.8 MPa` are preserved — the clean rules deliberately avoid mid-sentence digit stripping.
- Skips notebooks whose answer was "no relevant content" (heuristic detection) or that returned an error, and lists them in a collapsed "已略過" appendix at the end. They do **not** appear in the TOC or body.
- Reports `有效筆記本數: N / total` at the top so the user sees how many notebooks had usable content.

```bash
INPUT="data/run-name.jsonl" TITLE="彙整文件標題" node scripts/format-markdown.mjs
```

Writes `data/run-name.md` (readable locally and the artifact we upload).

### Step 3.5 — Synthesise across notebooks (Claude writes this)

**Mandatory.** After `format-markdown.mjs` produces the per-notebook document, Claude Code reads the markdown and prepends a `## ★ 綜合整理` section directly after the title/metadata (before 目錄). This section should:

- Answer the user's original question holistically by cross-referencing the best content from multiple notebooks — not just a summary of each notebook's answer.
- Use `[#n]` footnote markers pointing to the per-notebook sections (by TOC number) so the user can drill down.
- Favour tables, checklists, and concrete numbers/parameters over prose. The goal is a deliverable the user can use immediately without reading all N notebook sections.
- Be concise — target 2000–5000 chars. The per-notebook sections below it are still available for depth.

Prepend via the `Edit` tool using the existing `- 產出時間: ...\n\n---\n\n## 目錄` boundary as the anchor. Do **not** rewrite the entire file.

If the answer is highly technical (engineering, finance, medical), the synthesis should itself be structured like a working document (e.g. a course outline for teaching requests, a decision matrix for comparison questions, a checklist for troubleshooting questions) — match the artefact to what the user intends to do with it.

### Step 4 — Upload to Drive via rclone

```bash
INPUT="data/run-name.md" FOLDER="NotebookLM 彙整" node scripts/upload.mjs
```

The script streams the file directly to Drive (no base64, no size limit), retrieves the file ID with `rclone lsf`, and prints `https://drive.google.com/file/d/{id}/view`. Return that URL to the user.

Environment variables:
- `INPUT` — local file path (required)
- `FOLDER` — Drive folder path (default: `NotebookLM 彙整`)
- `REMOTE` — rclone remote name (default: `gdrive`)
- `RCLONE` — path to rclone binary (default: auto-detect PATH, fallback to winget install path)

If the user wants the file as an editable Google Doc, they can right-click in Drive → Open with → Google Docs.

#### Fallback: Google Drive MCP

If rclone is unavailable, fall back to the old base64 + MCP flow — but note the 30000-char Bash output limit means documents larger than ~22KB markdown won't fit in one `Read` call. For anything larger, rclone is the only reliable path.

#### Fallback: local Markdown only

If both rclone and the Drive MCP fail, the `data/run-name.md` file is already a complete, readable document. Tell the user the local path and they can open it in VS Code / any Markdown viewer.

## Gotchas

- **Use rclone, not the Drive MCP**: the Drive MCP's `create_file` takes base64 `content` passed through a tool parameter, which is capped by the Bash 30000-char output limit and the Read 25000-token limit — anything beyond ~22KB of markdown won't fit. rclone streams the file directly and has no size limit.
- **MCP tools in Claude Code don't load** (`claude mcp list` says Connected but tool schemas never appear in ToolSearch). All notebooklm-mcp calls must go through the bootstrap pattern in `batch-query.mjs` (spawn + JSON-RPC over stdio)
- **notebooklm-mcp library is separate** from the user's Google account notebooks. The MCP's internal `list_notebooks` only lists what was added via `add_notebook`. To enumerate the actual Google account notebooks, scrape the web UI (`list-notebooks.mjs`)
- **Each query takes 30–90s** (browser navigation + Gemini response). Don't estimate faster than 60s/notebook average
- **Free tier NotebookLM limit: 50 queries/day.** Pro tier has no limit. Check user's account type before large batches
- **Resume on crash**: `batch-query.mjs` writes JSONL incrementally and skips already-done ids on restart. Let this work for you — don't delete the output file between runs unless you want to redo everything
- **Chrome profile lockfile**: if a batch run is interrupted mid-stream, the Chrome persistent context at `$LOCALAPPDATA/notebooklm-mcp/Data/chrome_profile/lockfile` may block the next run. Symptoms: every notebook fails instantly (<1s) with "Target page, context or browser has been closed". Fix: kill lingering Chrome processes whose CommandLine contains "notebooklm", then retry — the lockfile clears automatically.

## Example invocation

User: "幫我找所有 notebook 有關 DLN 的資料"

1. Check `data/notebooks.json` exists — if not, run list-notebooks.mjs
2. Filter by `氣渦輪|燃氣|燃燒|GT|DLN|NOx` (DLN is gas-turbine related — narrows 95 → ~14 notebooks)
3. Run batch-query.mjs with the question, save to `data/dln.jsonl`
4. Run format-markdown.mjs on the JSONL → `data/dln.md`
5. Run upload.mjs on the `.md` → uploads via rclone, returns Drive URL
6. Return the Drive URL to the user
