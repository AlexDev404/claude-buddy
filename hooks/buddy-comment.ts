#!/usr/bin/env bun
/**
 * buddy-comment Stop hook (TypeScript port of buddy-comment.sh)
 *
 * Extracts hidden buddy comment from Claude's response.
 * Claude writes: <!-- buddy: *adjusts tophat* nice code -->
 * This hook extracts it and updates the status line bubble.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const STATE_DIR = join(homedir(), ".claude-buddy");
const SID = (process.env.TMUX_PANE || "default").replace(/^%/, "");
const STATUS_FILE = join(STATE_DIR, "status.json");
const COOLDOWN_FILE = join(STATE_DIR, `.last_comment.${SID}`);
const REACTION_FILE = join(STATE_DIR, `reaction.${SID}.json`);

// Bail if no status file (buddy not initialized)
if (!existsSync(STATUS_FILE)) process.exit(0);

// Read config
let cooldown = 30;
try {
  const cfg = JSON.parse(readFileSync(join(STATE_DIR, "config.json"), "utf8"));
  const cd = Number(cfg.commentCooldown ?? 30);
  if (Number.isInteger(cd) && cd >= 0) cooldown = cd;
} catch {}

// Read stdin
const input = await Bun.stdin.text();
if (!input) process.exit(0);

// Parse hook input
let msg = "";
try {
  const data = JSON.parse(input);
  msg = data.last_assistant_message ?? "";
} catch {
  process.exit(0);
}
if (!msg) process.exit(0);

// Extract <!-- buddy: ... --> comment
const match = msg.match(/<!-- *buddy: *(.*[^ ]) *-->/);
if (!match) process.exit(0);
const comment = match[1];

// Cooldown check
if (cooldown > 0 && existsSync(COOLDOWN_FILE)) {
  try {
    const last = parseInt(readFileSync(COOLDOWN_FILE, "utf8"), 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - (last || 0) < cooldown) process.exit(0);
  } catch {}
}

// Write cooldown timestamp
mkdirSync(STATE_DIR, { recursive: true });
writeFileSync(COOLDOWN_FILE, String(Math.floor(Date.now() / 1000)));

// Update status.json with reaction
try {
  const status = JSON.parse(readFileSync(STATUS_FILE, "utf8"));
  status.reaction = comment;
  writeFileSync(STATUS_FILE, JSON.stringify(status));
} catch {}

// Write reaction file
writeFileSync(REACTION_FILE, JSON.stringify({
  reaction: comment,
  timestamp: Date.now(),
  reason: "turn",
}));
