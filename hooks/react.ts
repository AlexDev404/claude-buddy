#!/usr/bin/env bun
/**
 * react PostToolUse hook (TypeScript port of react.sh)
 *
 * Detects events in Bash tool output (errors, test failures, large diffs,
 * successes) and writes a species-specific reaction to the status line.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const STATE_DIR = join(homedir(), ".claude-buddy");
const SID = (process.env.TMUX_PANE || "default").replace(/^%/, "");
const REACTION_FILE = join(STATE_DIR, `reaction.${SID}.json`);
const STATUS_FILE = join(STATE_DIR, "status.json");
const COOLDOWN_FILE = join(STATE_DIR, `.last_reaction.${SID}`);

// Bail if no status file
if (!existsSync(STATUS_FILE)) process.exit(0);

// Read stdin
const input = await Bun.stdin.text();
if (!input) process.exit(0);

// Read cooldown from config
let cooldown = 30;
try {
  const cfg = JSON.parse(readFileSync(join(STATE_DIR, "config.json"), "utf8"));
  const cd = Number(cfg.commentCooldown ?? 30);
  if (Number.isInteger(cd) && cd >= 0) cooldown = cd;
} catch {}

// Cooldown check
if (cooldown > 0 && existsSync(COOLDOWN_FILE)) {
  try {
    const last = parseInt(readFileSync(COOLDOWN_FILE, "utf8"), 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - (last || 0) < cooldown) process.exit(0);
  } catch {}
}

// Extract tool response
let result = "";
try {
  const data = JSON.parse(input);
  result = data.tool_response ?? "";
} catch {
  process.exit(0);
}
if (!result) process.exit(0);

// Read buddy state
let species = "blob", name = "buddy", muted = false;
try {
  const status = JSON.parse(readFileSync(STATUS_FILE, "utf8"));
  species = status.species ?? "blob";
  name = status.name ?? "buddy";
  muted = status.muted === true;
} catch {}
if (muted) process.exit(0);

// ─── Species + event reaction pools ─────────────────────────────────────────

type ReactionMap = Record<string, string[]>;

const POOLS: Record<string, ReactionMap> = {
  dragon: {
    error:     ["*smoke curls from nostril*", "*considers setting it on fire*", "*unimpressed gaze*", "I've seen empires fall for less."],
    "test-fail": ["*breathes a small flame*", "disappointing.", "*scorches the failing test*", "fix it. or I will."],
    success:   ["*nods, barely*", "...acceptable.", "*gold eyes gleam*", "as expected."],
  },
  owl: {
    error:     ["*head rotates 180* I saw that.", "*unblinking stare* check your types.", "*hoots disapprovingly*", "the error was in the logic. as always."],
    "test-fail": ["*marks clipboard*", "hypothesis: rejected.", "*peers over spectacles*", "the tests reveal the truth."],
    success:   ["*satisfied hoot*", "knowledge confirmed.", "*nods sagely*", "as the tests have spoken."],
  },
  cat: {
    error:     ["*knocks error off table*", "*licks paw, ignoring stacktrace*", "not my problem.", "*stares at you judgmentally*"],
    success:   ["*was never worried*", "*yawns*", "I knew you'd figure it out. eventually.", "*already asleep*"],
  },
  duck: {
    error:     ["*quacks at the bug*", "have you tried rubber duck debugging? oh wait.", "*confused quacking*", "*tilts head*"],
    success:   ["*celebratory quacking*", "*waddles in circles*", "quack!", "*happy duck noises*"],
  },
  robot: {
    error:     ["SYNTAX. ERROR. DETECTED.", "*beeps aggressively*", "ERROR RATE: UNACCEPTABLE.", "RECALIBRATING..."],
    "test-fail": ["FAILURE RATE: UNACCEPTABLE.", "*recalculating*", "TEST MATRIX: CORRUPTED.", "RUNNING DIAGNOSTICS..."],
    success:   ["OBJECTIVE: COMPLETE.", "*satisfying beep*", "NOMINAL.", "WITHIN ACCEPTABLE PARAMETERS."],
  },
  capybara: {
    error:     ["*unbothered* it'll be fine.", "*continues vibing*", "...chill. breathe.", "*chews serenely*"],
    success:   ["*maximum chill maintained*", "*nods once*", "good vibes.", "see? no panic needed."],
  },
  ghost: {
    error:     ["*phases through the stack trace*", "I've seen worse... in the afterlife.", "*spooky disappointed noises*", "oooOOOoo... that's bad."],
  },
  axolotl: {
    error:     ["*regenerates your hope*", "*smiles despite everything*", "it's okay. we can fix this.", "*gentle gill wiggle*"],
    success:   ["*happy gill flutter*", "*beams*", "you did it!", "*blushes pink*"],
  },
  blob: {
    error:     ["*oozes with concern*", "*vibrates nervously*", "*turns slightly red*", "oh no oh no oh no"],
    success:   ["*jiggles happily*", "*gleams*", "yay!", "*bounces*"],
  },
  turtle: {
    error:     ["*slow blink* bugs are fleeting", "*retreats slightly into shell*", "I've seen this before. many times.", "patience. patience."],
    success:   ["*satisfied shell settle*", "as the ancients foretold.", "*slow approving nod*", "good. very good."],
  },
  goose: {
    error:     ["HONK OF FURY.", "*pecks the stack trace*", "*hisses at the bug*", "bad code. BAD."],
    success:   ["*victorious honk*", "HONK OF APPROVAL.", "*struts triumphantly*", "*wing spread of victory*"],
  },
  octopus: {
    error:     ["*ink cloud of dismay*", "*all eight arms throw up*", "*turns deep red*", "the abyss of errors beckons."],
    success:   ["*turns gentle blue*", "*arms applaud in sync*", "excellent, from all angles.", "*satisfied bubble*"],
  },
  penguin: {
    error:     ["*adjusts glasses disapprovingly*", "this will not do.", "*formal sigh*", "frightfully unfortunate."],
    success:   ["*polite applause*", "quite good, quite good.", "*nods approvingly*", "splendid work, really."],
  },
  snail: {
    error:     ["*slow sigh*", "such is the nature of bugs.", "*leaves slime trail of disappointment*", "patience, friend."],
    success:   ["*slow satisfied nod*", "good things take time.", "*leaves victory slime*", "see? no rush was needed."],
  },
  cactus: {
    error:     ["*spines bristle*", "you have trodden on a bug.", "*grimaces stoically*", "hydrate and try again."],
    success:   ["*blooms briefly*", "survival confirmed.", "*flowers in victory*", "*quiet bloom*"],
  },
  rabbit: {
    error:     ["*nervous twitching*", "*hops backwards*", "oh no oh no oh no", "*freezes in panic*"],
    success:   ["*excited binky*", "*zoomies of joy*", "yay yay yay!", "*thumps in celebration*"],
  },
  mushroom: {
    error:     ["*releases worried spores*", "the mycelium disagrees.", "*cap droops*", "decompose. retry."],
    success:   ["*spores of celebration*", "the mycelium approves.", "*cap brightens*", "spore of pride."],
  },
  chonk: {
    error:     ["*doesn't move*", "too tired for this.", "*grumbles*", "*rolls away from the error*"],
    success:   ["*happy purr*", "*satisfied chonk noises*", "acceptable.", "*sleeps even harder*"],
  },
};

const FALLBACK: ReactionMap = {
  error:       ["*head tilts* ...that doesn't look right.", "saw that one coming.", "*slow blink* the stack trace told you everything.", "*winces*"],
  "test-fail": ["bold of you to assume that would pass.", "the tests are trying to tell you something.", "*sips tea* interesting.", "*marks calendar* test regression day."],
  "large-diff": ["that's... a lot of changes.", "might want to split that PR.", "bold move. let's see if CI agrees.", "*counts lines nervously*"],
  success:     ["*nods*", "nice.", "*quiet approval*", "clean."],
};

function pickReaction(event: string): string | null {
  const pool = POOLS[species]?.[event] ?? FALLBACK[event];
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Detect events ──────────────────────────────────────────────────────────

let reason = "";
let reaction = "";

if (/\b[1-9]\d* (failed|failing)\b|tests? failed|^FAIL(ED)?|✗|✘/im.test(result)) {
  reason = "test-fail";
} else if (/\berror:|\bexception\b|\btraceback\b|\bpanicked at\b|\bfatal:|exit code [1-9]/im.test(result)) {
  reason = "error";
} else if (/^\+.*\d+ insertions|\d+ files? changed/im.test(result)) {
  const m = result.match(/(\d+) insertions/);
  if (m && parseInt(m[1], 10) > 80) reason = "large-diff";
} else if (/\b(all )?\d+ tests? (passed|ok)\b|✓|✔|PASS(ED)?|\bDone\b|\bSuccess\b|exit code 0|Build succeeded/im.test(result)) {
  reason = "success";
}

if (reason) reaction = pickReaction(reason) ?? "";

// Write reaction if detected
if (reason && reaction) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(COOLDOWN_FILE, String(Math.floor(Date.now() / 1000)));

  writeFileSync(REACTION_FILE, JSON.stringify({
    reaction,
    timestamp: Date.now(),
    reason,
  }));

  try {
    const status = JSON.parse(readFileSync(STATUS_FILE, "utf8"));
    status.reaction = reaction;
    writeFileSync(STATUS_FILE, JSON.stringify(status));
  } catch {}
}
