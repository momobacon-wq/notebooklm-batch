# notebooklm-batch

Claude Code skill for batch-querying NotebookLM notebooks with the same question and exporting the consolidated answers to a Google Doc.

Built as a workaround because `notebooklm-mcp` tools don't register as Claude Code deferred tools on Windows (MCP stdio bug?) — this skill uses node scripts that talk to the MCP server directly via JSON-RPC, and uploads results through the claude.ai Google Drive MCP which does work.

## What this does

1. **One-time auth** — opens a Chrome window so you log in to Google once; Chrome profile stores credentials
2. **List notebooks** — scrapes notebooklm.google.com for every notebook (id, url, title)
3. **Batch query** — asks the same question to a filtered set of notebooks (or all), writing incremental JSONL results (resumable)
4. **Format + upload** — formats the answers into a text document with UTF-8 BOM, base64-encodes, uploads via Google Drive MCP as `text/plain` which auto-converts to a Google Doc

## Install

```bash
# clone into a working directory (not into ~/.claude/skills — Claude Code's skill discovery
# varies by setup; see "Using as a skill" below)
git clone https://github.com/momobacon-wq/notebooklm-batch.git
cd notebooklm-batch
```

No npm install needed — `notebooklm-mcp` is invoked via `npx`, and `patchright` is pulled from its cache.

## Using as a skill

Drop `SKILL.md` (or a symlink) into the Claude Code skills directory so it shows up in the available-skills list. On Windows that's usually:

```
%USERPROFILE%\.claude\skills\notebooklm-batch\SKILL.md
```

Then in a Claude Code session, ask something like "對所有 NotebookLM 筆記本問 X 然後統整". Claude will follow the instructions in `SKILL.md` — run the scripts, collect results, upload to Google Docs.

## Manual usage

### Step 1 — auth (once)

```bash
node scripts/auth.mjs
```

A Chrome window opens. Log in to the Google account that owns your notebooks. It closes automatically once NotebookLM loads.

### Step 2 — list notebooks

```bash
node scripts/list-notebooks.mjs
```

Writes `data/notebooks.json` with every notebook. Re-run any time you add or remove notebooks in NotebookLM.

### Step 3 — batch query

```bash
QUESTION="你的問題" \
FILTER="氣渦輪|GT|DLN" \
OUTPUT="data/dln.jsonl" \
node scripts/batch-query.mjs
```

- `FILTER` is a case-insensitive JS regex applied to notebook titles. Omit to query all.
- `LIMIT=3` for dry-run testing.
- Each query takes roughly 30–90 seconds (browser navigation + Gemini response). Output is written incrementally to `OUTPUT` — safe to interrupt and resume.

### Step 4 — format for upload

```bash
INPUT="data/dln.jsonl" \
TITLE="DLN 資料彙整" \
node scripts/format-for-upload.mjs
```

Produces `data/dln.txt` (readable) and `data/dln.txt.b64` (base64, ready for upload).

### Step 5 — upload to Google Doc

Call the Google Drive MCP in Claude Code:

```
mcp__claude_ai_Google_Drive__create_file({
  title: "DLN 資料彙整",
  mimeType: "text/plain",
  content: <contents of data/dln.txt.b64>
})
```

Response includes the file id — the URL is `https://docs.google.com/document/d/{id}/edit`.

## Gotchas worth knowing

- **UTF-8 BOM is mandatory** for Chinese content in Google Docs. The `format-for-upload.mjs` prepends it. Without BOM, `text/plain` → Google Doc conversion garbles non-ASCII
- **`text/html` does NOT auto-convert** to Google Doc via the Drive MCP — it lands as a raw HTML file in Drive. Use `text/plain` with BOM
- **MCP tools not loading in Claude Code** — if `claude mcp list` says Connected but `ToolSearch` can't find `ask_question`, `list_notebooks`, etc., that's the bug this skill works around. Don't waste time retrying
- **NotebookLM free tier: 50 queries/day.** Pro tier no limit. Check before a 95-notebook run
- **`list_notebooks` inside the MCP is different** from your Google account's notebooks — it only lists what was explicitly added via `add_notebook`. Always start from `scripts/list-notebooks.mjs` for a fresh enumeration

## Repo layout

```
notebooklm-batch/
├── SKILL.md                  # Claude Code skill definition
├── README.md                 # this file
├── scripts/
│   ├── auth.mjs              # one-time Google login
│   ├── list-notebooks.mjs    # scrape notebook list
│   ├── batch-query.mjs       # query filtered notebooks via MCP JSON-RPC
│   └── format-for-upload.mjs # JSONL → text+BOM → base64
└── data/                     # gitignored — notebooks.json, *.jsonl, *.txt, *.txt.b64
```
