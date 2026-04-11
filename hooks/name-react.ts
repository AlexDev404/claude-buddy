#!/usr/bin/env bun
/**
 * name-react UserPromptSubmit hook (TypeScript port of name-react.sh)
 *
 * Detects the buddy's name in the user's message → status line reaction.
 * No cooldown — name mentions are intentional.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const STATE_DIR = join(homedir(), ".claude-buddy");
const SID = (process.env.TMUX_PANE || "default").replace(/^%/, "");
const STATUS_FILE = join(STATE_DIR, "status.json");
const REACTION_FILE = join(STATE_DIR, `reaction.${SID}.json`);

// Bail if no status file
if (!existsSync(STATUS_FILE)) process.exit(0);

// Read stdin
const input = await Bun.stdin.text();
if (!input) process.exit(0);

// Extract prompt from hook input
let prompt = "";
try {
  const data = JSON.parse(input);
  const raw = data.prompt ?? data.message ?? data.user_message
    ?? data.messages?.[data.messages.length - 1]?.content ?? "";
  prompt = Array.isArray(raw) ? raw[0]?.text ?? "" : String(raw);
} catch {
  process.exit(0);
}
if (!prompt) process.exit(0);

// Read buddy name and state
let name = "", species = "blob", muted = false;
try {
  const status = JSON.parse(readFileSync(STATUS_FILE, "utf8"));
  name = status.name ?? "";
  species = status.species ?? "blob";
  muted = status.muted === true;
} catch {
  process.exit(0);
}
if (!name || muted) process.exit(0);

// Case-insensitive whole-word match
const namePattern = new RegExp(`(^|[^a-zA-Z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-zA-Z]|$)`, "i");
if (!namePattern.test(prompt)) process.exit(0);

// Species-specific name-call reactions
const REACTIONS: Record<string, string[]> = {
  dragon:   ["*one eye opens slowly*", "...you called?", "*smoke curls from nostril* yes.", "*regards you from above*"],
  owl:      ["*swivels head 180°*", "*blinks once, deliberately*", "hm.", "*adjusts perch*"],
  cat:      ["*ear flicks*", "...what.", "*ignores you, but heard*", "*opens one eye*"],
  duck:     ["*quack*", "*looks up mid-waddle*", "*attentive duck noises*"],
  ghost:    ["*materialises*", "...boo?", "*phases closer*"],
  robot:    ["NAME DETECTED.", "*whirrs attentively*", "STANDING BY."],
  capybara: ["*barely moves*", "*blinks slowly*", "...yes, friend."],
  axolotl:  ["*gill flutter*", "*smiles gently*", "oh! hello."],
  blob:     ["*jiggles*", "*oozes toward you*", "*wobbles excitedly*"],
  turtle:   ["*slowly extends neck*", "...you called?", "*ancient eyes open*", "*shell creaks thoughtfully*", "*blinks once, patiently*"],
  goose:    ["HONK.", "*necks aggressively*", "*wing flap*", "*honks in recognition*"],
  octopus:  ["*eight eyes open*", "*curls an arm toward you*", "*changes color curiously*", "...yes, friend?"],
  penguin:  ["*adjusts tie*", "*dignified waddle*", "*bows slightly*", "...yes, quite?"],
  snail:    ["*slow head extension*", "...mmm?", "*trails slowly toward you*", "*antenna twitches*"],
  cactus:   ["*stands silent*", "...hm.", "*spine twitches*", "*slowly rotates*"],
  rabbit:   ["*ears perk up*", "*nose twitches*", "yes?", "*hops closer*"],
  mushroom: ["*releases a tiny spore*", "*cap tilts*", "*stands mysterious*", "...yes?"],
  chonk:    ["*barely opens one eye*", "...mrrp?", "*yawns heavily*", "*rolls over toward you*"],
};

const pool = REACTIONS[species] ?? ["*perks up*", "...yes?", "*looks your way*"];
const reaction = pool[Math.floor(Math.random() * pool.length)];

// Write
mkdirSync(STATE_DIR, { recursive: true });

try {
  const status = JSON.parse(readFileSync(STATUS_FILE, "utf8"));
  status.reaction = reaction;
  writeFileSync(STATUS_FILE, JSON.stringify(status));
} catch {}

writeFileSync(REACTION_FILE, JSON.stringify({
  reaction,
  timestamp: Date.now(),
  reason: "name",
}));
