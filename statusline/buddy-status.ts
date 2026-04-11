#!/usr/bin/env bun
/**
 * buddy-status status line (TypeScript port of buddy-status.sh)
 *
 * Animated, right-aligned multi-line companion display.
 * Uses art data from server/art.ts — single source of truth.
 *
 * Animation: 500ms ticks, sequence [0,0,0,0,1,0,0,0,-1,0,0,2,0,0,0]
 *   Frame -1 = blink (eyes → "-"), Frames 0,1,2 = idle variants
 * Braille Blank (U+2800) for padding — survives JS .trim()
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { SPECIES_ART, HAT_ART } from "../server/art.ts";

const STATE_DIR = join(homedir(), ".claude-buddy");
const SID = (process.env.TMUX_PANE || "default").replace(/^%/, "");
const STATUS_FILE = join(STATE_DIR, "status.json");
const REACTION_FILE = join(STATE_DIR, `reaction.${SID}.json`);
const CONFIG_FILE = join(STATE_DIR, "config.json");

// Drain stdin (Claude Code pipes empty JSON)
await Bun.stdin.text();

// Bail if no status file
if (!existsSync(STATUS_FILE)) process.exit(0);

// Read status
let name = "", species = "", hat = "none", rarity = "common", reaction = "", eye = "°", muted = false;
try {
  const s = JSON.parse(readFileSync(STATUS_FILE, "utf8"));
  name     = s.name ?? "";
  species  = s.species ?? "";
  hat      = s.hat ?? "none";
  rarity   = s.rarity ?? "common";
  reaction = s.reaction ?? "";
  eye      = s.eye ?? "°";
  muted    = s.muted === true;
} catch {
  process.exit(0);
}

if (muted || !name) process.exit(0);

// ─── ANSI codes ─────────────────────────────────────────────────────────────

const NC   = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM  = "\x1b[2;3m";
const B    = "\u2800"; // Braille Blank

const RARITY_COLOR: Record<string, string> = {
  common:    "\x1b[38;2;153;153;153m",
  uncommon:  "\x1b[38;2;78;186;101m",
  rare:      "\x1b[38;2;177;185;249m",
  epic:      "\x1b[38;2;175;135;255m",
  legendary: "\x1b[38;2;255;193;7m",
};
const C = RARITY_COLOR[rarity] ?? NC;

// ─── Animation frame ────────────────────────────────────────────────────────

const SEQ = [0,0,0,0,1,0,0,0,-1,0,0,2,0,0,0];
const now = Math.floor(Date.now() / 1000);
const frameIdx = now % SEQ.length;
let frame = SEQ[frameIdx];
let blink = false;
if (frame === -1) { blink = true; frame = 0; }

// ─── Get art from server/art.ts ─────────────────────────────────────────────

const artFrames = (SPECIES_ART as Record<string, string[][]>)[species];
if (!artFrames) process.exit(0);

// Art frames are 5 lines each (first line often empty for hat space)
// Replace {E} with eye, handle blink
let artLines = artFrames[frame].map(line => {
  let l = line.replace(/\{E\}/g, blink ? "-" : eye);
  return l;
});

// Drop leading empty line, trim trailing whitespace per line
// The shell version uses 4 lines (L1-L4), art.ts has 5 (with leading empty)
// Remove fully blank lines from start
while (artLines.length > 0 && artLines[0].trim() === "") artLines.shift();

// ─── Hat ────────────────────────────────────────────────────────────────────

const hatLine = (HAT_ART as Record<string, string>)[hat] ?? "";

// ─── Reaction TTL check ─────────────────────────────────────────────────────

let reactionTTL = 0;
try {
  const cfg = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  const ttl = Number(cfg.reactionTTL ?? 0);
  if (Number.isInteger(ttl) && ttl >= 0) reactionTTL = ttl;
} catch {}

let bubble = "";
if (reaction && reaction !== "null") {
  let fresh = false;
  if (reactionTTL === 0) {
    fresh = true;
  } else if (existsSync(REACTION_FILE)) {
    try {
      const rf = JSON.parse(readFileSync(REACTION_FILE, "utf8"));
      const ts = Number(rf.timestamp ?? 0);
      if (ts > 0) {
        const age = Math.floor(Date.now() / 1000) - Math.floor(ts / 1000);
        fresh = age < reactionTTL;
      }
    } catch {}
  }
  if (fresh) bubble = reaction;
}

// ─── Build all art lines ────────────────────────────────────────────────────

interface Line { text: string; color: string; }

const allLines: Line[] = [];
if (hatLine) allLines.push({ text: hatLine, color: C });
for (const line of artLines) allLines.push({ text: line, color: C });

// Center name under art
const artCenter = 4;
const namePad = Math.max(0, artCenter - Math.floor(name.length / 2));
const nameLine = " ".repeat(namePad) + name;
allLines.push({ text: nameLine, color: DIM });

const ART_W = 14;
const artCount = allLines.length;

// ─── Speech bubble (word-wrapped) ───────────────────────────────────────────

const INNER_W = 28;
const textLines: string[] = [];

if (bubble) {
  const words = bubble.split(/\s+/);
  let curLine = "";
  for (const word of words) {
    if (!curLine) {
      curLine = word;
    } else if (curLine.length + 1 + word.length <= INNER_W) {
      curLine += " " + word;
    } else {
      textLines.push(curLine);
      curLine = word;
    }
  }
  if (curLine) textLines.push(curLine);
}

// Build box
const BOX_W = INNER_W + 4;
const bubbleLines: { text: string; type: "border" | "text" }[] = [];

if (textLines.length > 0) {
  const border = "-".repeat(BOX_W - 2);
  bubbleLines.push({ text: `.${border}.`, type: "border" });
  for (const tl of textLines) {
    const padding = " ".repeat(Math.max(0, INNER_W - tl.length));
    bubbleLines.push({ text: `| ${tl}${padding} |`, type: "text" });
  }
  bubbleLines.push({ text: `\`${border}'`, type: "border" });
}

// ─── Terminal width ─────────────────────────────────────────────────────────

let cols = process.stdout.columns || 125;
if (cols < 40) cols = 125;

// ─── Right-align with bubble ────────────────────────────────────────────────

const GAP = 2;
const totalW = bubbleLines.length > 0 ? BOX_W + GAP + ART_W : ART_W;
const MARGIN = 8;
const pad = Math.max(0, cols - totalW - MARGIN);
const spacer = B + " ".repeat(pad);
const gapStr = " ".repeat(GAP);

// Vertically center bubble on art
let bubbleStart = 0;
if (bubbleLines.length > 0 && bubbleLines.length < artCount) {
  bubbleStart = Math.floor((artCount - bubbleLines.length) / 2);
}

// Find connector line (middle text row)
let connectorBI = -1;
if (bubbleLines.length > 2) {
  const firstText = 1;
  const lastText = bubbleLines.length - 2;
  connectorBI = Math.floor((firstText + lastText) / 2);
}

// ─── Output ─────────────────────────────────────────────────────────────────

const output: string[] = [];

for (let i = 0; i < artCount; i++) {
  const artPart = `${allLines[i].color}${allLines[i].text}${NC}`;

  if (bubbleLines.length > 0) {
    const bi = i - bubbleStart;
    if (bi >= 0 && bi < bubbleLines.length) {
      const { text: bline, type: btype } = bubbleLines[bi];
      const gap = bi === connectorBI ? `${C}--${NC} ` : "   ";

      if (btype === "border") {
        output.push(`${spacer}${C}${bline}${NC}${gap}${artPart}`);
      } else {
        const pipeL = bline[0];
        const pipeR = bline[bline.length - 1];
        const inner = bline.slice(1, -1);
        output.push(`${spacer}${C}${pipeL}${NC}${DIM}${inner}${NC}${C}${pipeR}${NC}${gap}${artPart}`);
      }
    } else {
      const empty = " ".repeat(BOX_W);
      output.push(`${spacer}${empty}   ${artPart}`);
    }
  } else {
    output.push(`${spacer}${artPart}`);
  }
}

console.log(output.join("\n"));
