#!/usr/bin/env node
// Upload a local file to Google Drive via rclone and print the Drive URL.
// Env vars:
//   INPUT    - path to local file (required)
//   NAME     - filename to use on Drive (default: original basename)
//   FOLDER   - Drive folder path under the remote (default: NotebookLM 彙整)
//   REMOTE   - rclone remote name (default: gdrive)
//   RCLONE   - path to rclone binary (default: auto-detect)

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, resolve as pathResolve } from 'node:path';

function findRclone() {
  if (process.env.RCLONE) return process.env.RCLONE;
  try {
    execFileSync('rclone', ['version'], { stdio: 'ignore' });
    return 'rclone';
  } catch {}
  const wingetPath = `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Packages\\Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe\\rclone-v1.73.5-windows-amd64\\rclone.exe`;
  if (existsSync(wingetPath)) return wingetPath;
  throw new Error('rclone not found. Install via `winget install Rclone.Rclone` or set RCLONE env var');
}

const RCLONE = findRclone();
const INPUT = process.env.INPUT;
const FOLDER = process.env.FOLDER || 'NotebookLM 彙整';
const REMOTE = process.env.REMOTE || 'gdrive';

if (!INPUT) {
  console.error('INPUT env var required');
  process.exit(1);
}
const inputPath = pathResolve(INPUT);
if (!existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

const fileName = process.env.NAME || basename(inputPath);
const dest = `${REMOTE}:${FOLDER}`;
const destFile = `${dest}/${fileName}`;

console.log(`Uploading ${fileName} → ${dest}/`);
execFileSync(RCLONE, ['mkdir', dest], { stdio: 'inherit' });
execFileSync(RCLONE, ['copyto', inputPath, destFile], { stdio: 'inherit' });

const out = execFileSync(RCLONE, ['lsf', '--format=i', destFile], { encoding: 'utf8' }).trim();
const fileId = out.split('\n').filter(Boolean).pop();
if (!fileId) {
  console.error('Upload succeeded but could not retrieve file ID');
  process.exit(1);
}
const url = `https://drive.google.com/file/d/${fileId}/view`;
console.log(`\nDrive URL: ${url}`);
