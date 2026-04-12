#!/usr/bin/env bun
/**
 * cli/tui.tsx — fullscreen 3-pane dashboard for claude-buddy (Ink/React)
 *
 * Layout: persistent sidebar | content list | detail preview
 * The sidebar is always visible. Selecting a section opens the
 * middle + right panes for that section's content.
 *
 * Usage:  bun run tui
 */

import React, { useState } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import {
  readFileSync, existsSync, readdirSync, statSync,
  mkdirSync, writeFileSync, copyFileSync, rmSync,
} from "fs";
import { execSync } from "child_process";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import {
  listCompanionSlots, loadActiveSlot, saveActiveSlot,
  loadConfig, saveConfig, writeStatusState, loadReaction,
  type BuddyConfig,
} from "../server/state.ts";
import { RARITY_STARS, STAT_NAMES, type Companion, type StatName } from "../server/engine.ts";
import { getArtFrame, HAT_ART } from "../server/art.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

type Section = "menagerie" | "settings" | "doctor" | "backup";
type Focus = "sidebar" | "list" | "edit";
interface SlotEntry { slot: string; companion: Companion }

const RARITY_COLOR: Record<string, string> = {
  common: "gray", uncommon: "green", rare: "blue",
  epic: "magenta", legendary: "yellow",
};


const HOME = homedir();
const PROJECT_ROOT = resolve(dirname(import.meta.dir));

// ─── Sidebar ────────────────────────────────────────────────────────────────

const SIDEBAR_ITEMS: { key: Section; icon: string; label: string }[] = [
  { key: "menagerie", icon: "🏠", label: "Pets" },
  { key: "settings", icon: "🔧", label: "Config" },
  { key: "doctor", icon: "🩺", label: "Doctor" },
  { key: "backup", icon: "💾", label: "Backup" },
];

function Sidebar({ cursor, section, focus }: {
  cursor: number; section: Section; focus: Focus;
}) {
  const isFocused = focus === "sidebar";
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">{" 🐢 claude-buddy"}</Text>
      <Text>{""}</Text>
      {SIDEBAR_ITEMS.map((item, i) => {
        const isActive = item.key === section && focus !== "sidebar";
        const isCursor = isFocused && i === cursor;
        const borderColor = isCursor ? "cyan" : isActive ? "green" : "gray";
        const borderStyle = isCursor || isActive ? "round" : "single";
        return (
          <Box key={item.key}
            borderStyle={borderStyle as any}
            borderColor={borderColor}
            paddingX={1}
            marginBottom={0}
          >
            <Text bold={isCursor || isActive} color={isCursor ? "cyan" : isActive ? "green" : "white"}>
              {item.icon} {item.label}
            </Text>
          </Box>
        );
      })}
      <Text>{""}</Text>
      <Box
        borderStyle={isFocused && cursor >= SIDEBAR_ITEMS.length ? "round" as any : "single" as any}
        borderColor={isFocused && cursor >= SIDEBAR_ITEMS.length ? "red" : "gray"}
        paddingX={1}
      >
        <Text color={isFocused && cursor >= SIDEBAR_ITEMS.length ? "red" : "gray"}>
          👋 Exit
        </Text>
      </Box>
    </Box>
  );
}

// ─── Middle: Buddy List ─────────────────────────────────────────────────────

function BuddyListPane({ slots, cursor, activeSlot, focused }: {
  slots: SlotEntry[]; cursor: number; activeSlot: string; focused: boolean;
}) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={focused ? "cyan" : "gray"}>{" 🏠 Menagerie"}</Text>
      <Text>{""}</Text>
      {slots.length === 0 ? (
        <Text dimColor>{" "}No buddies yet.</Text>
      ) : (
        slots.map(({ slot, companion: c }, i) => {
          const isActive = slot === activeSlot;
          const color = RARITY_COLOR[c.bones.rarity] ?? "white";
          const stars = RARITY_STARS[c.bones.rarity];
          const shiny = c.bones.shiny ? "✨" : "";
          const isCursor = focused && i === cursor;
          return (
            <Box key={slot}
              borderStyle={isCursor ? "round" as any : isActive ? "round" as any : "single" as any}
              borderColor={isCursor ? "cyan" : isActive ? "green" : "gray"}
              paddingX={1}
            >
              <Text color={isActive ? "green" : "gray"}>{isActive ? "● " : "○ "}</Text>
              <Text color={color} bold={isCursor || isActive}>{c.name.padEnd(8)}</Text>
              <Text dimColor>{c.bones.species.padEnd(7)}{stars}{shiny}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}

// ─── Middle: Settings List ──────────────────────────────────────────────────

const SETTINGS_ITEMS = [
  { key: "commentCooldown", label: "Comment Cooldown" },
  { key: "reactionTTL", label: "Reaction TTL" },
  { key: "bubbleStyle", label: "Bubble Style" },
  { key: "bubblePosition", label: "Bubble Position" },
  { key: "showRarity", label: "Show Rarity" },
] as const;

function SettingsListPane({ cursor, config, focused }: {
  cursor: number; config: BuddyConfig; focused: boolean;
}) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={focused ? "cyan" : "gray"}>{" 🔧 Settings"}</Text>
      <Text>{""}</Text>
      {SETTINGS_ITEMS.map((item, i) => {
        const val = String(config[item.key as keyof BuddyConfig]);
        const isCursor = focused && i === cursor;
        return (
          <Box key={item.key}
            borderStyle={isCursor ? "round" as any : "single" as any}
            borderColor={isCursor ? "cyan" : "gray"}
            paddingX={1}
          >
            <Text bold={isCursor} color={isCursor ? "cyan" : "white"}>{item.label.padEnd(16)}</Text>
            <Text color="yellow">{val}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Doctor: data collection ────────────────────────────────────────────────

interface DiagCheck { label: string; value: string; status: "ok" | "warn" | "err" }

interface DiagCategory { name: string; icon: string; checks: DiagCheck[] }

function tryExec(cmd: string, fallback = "(failed)"): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return fallback; }
}

function runDiagnostics(): DiagCategory[] {
  const categories: DiagCategory[] = [];

  // Environment
  const env: DiagCheck[] = [];
  const bunVer = tryExec("bun --version");
  env.push({ label: "Bun", value: bunVer, status: bunVer === "(failed)" ? "err" : "ok" });
  const jqVer = tryExec("jq --version", "(not installed)");
  env.push({ label: "jq", value: jqVer, status: jqVer === "(not installed)" ? "warn" : "ok" });
  const claudeVer = tryExec("claude --version", "(not in PATH)");
  env.push({ label: "Claude Code", value: claudeVer, status: claudeVer === "(not in PATH)" ? "warn" : "ok" });
  env.push({ label: "OS", value: tryExec("uname -srm"), status: "ok" });
  env.push({ label: "Shell", value: process.env.SHELL ?? "(unset)", status: "ok" });
  categories.push({ name: "Environment", icon: "💻", checks: env });

  // Filesystem
  const fs: DiagCheck[] = [];
  const dirs: [string, string][] = [
    ["~/.claude/", join(HOME, ".claude")],
    ["~/.claude.json", join(HOME, ".claude.json")],
    ["~/.claude-buddy/", join(HOME, ".claude-buddy")],
    ["Status script", join(PROJECT_ROOT, "statusline", "buddy-status.sh")],
  ];
  for (const [label, path] of dirs) {
    const exists = existsSync(path);
    fs.push({ label, value: exists ? "found" : "MISSING", status: exists ? "ok" : "err" });
  }
  categories.push({ name: "Filesystem", icon: "📁", checks: fs });

  // MCP & Hooks
  const mcp: DiagCheck[] = [];
  try {
    const claudeJson = JSON.parse(readFileSync(join(HOME, ".claude.json"), "utf8"));
    const registered = !!claudeJson?.mcpServers?.["claude-buddy"];
    mcp.push({ label: "MCP server", value: registered ? "registered" : "NOT registered", status: registered ? "ok" : "err" });
  } catch {
    mcp.push({ label: "MCP server", value: "cannot read config", status: "err" });
  }
  try {
    const settings = JSON.parse(readFileSync(join(HOME, ".claude", "settings.json"), "utf8"));
    const hookCount = Object.keys(settings.hooks ?? {}).reduce((n: number, k: string) => n + (settings.hooks[k]?.length ?? 0), 0);
    mcp.push({ label: "Hooks", value: `${hookCount} entries`, status: hookCount > 0 ? "ok" : "warn" });
    mcp.push({ label: "Status line", value: settings.statusLine ? "configured" : "not set", status: settings.statusLine ? "ok" : "warn" });
  } catch {
    mcp.push({ label: "Settings", value: "cannot read", status: "err" });
  }
  const skillPath = join(HOME, ".claude", "skills", "buddy", "SKILL.md");
  mcp.push({ label: "Skill", value: existsSync(skillPath) ? "installed" : "MISSING", status: existsSync(skillPath) ? "ok" : "err" });
  categories.push({ name: "Integration", icon: "🔌", checks: mcp });

  // Buddy state
  const state: DiagCheck[] = [];
  try {
    const menagerie = JSON.parse(readFileSync(join(HOME, ".claude-buddy", "menagerie.json"), "utf8"));
    const slots = Object.keys(menagerie.companions ?? {});
    state.push({ label: "Menagerie", value: `${slots.length} buddy(s)`, status: slots.length > 0 ? "ok" : "warn" });
    state.push({ label: "Active slot", value: menagerie.active ?? "(none)", status: menagerie.active ? "ok" : "warn" });
    const active = menagerie.companions?.[menagerie.active];
    if (active) {
      state.push({ label: "Active buddy", value: `${active.name} (${active.bones?.rarity} ${active.bones?.species})`, status: "ok" });
    }
  } catch {
    state.push({ label: "Menagerie", value: "not found", status: "warn" });
  }
  const statusJson = join(HOME, ".claude-buddy", "status.json");
  if (existsSync(statusJson)) {
    try {
      const s = JSON.parse(readFileSync(statusJson, "utf8"));
      state.push({ label: "Status muted", value: String(s.muted ?? false), status: "ok" });
      state.push({ label: "Last reaction", value: s.reaction || "(none)", status: "ok" });
    } catch {
      state.push({ label: "Status", value: "corrupt", status: "err" });
    }
  }
  categories.push({ name: "Buddy State", icon: "🐢", checks: state });

  return categories;
}

// ─── Middle: Doctor Categories ──────────────────────────────────────────────

function DoctorListPane({ categories, cursor, focused }: {
  categories: DiagCategory[]; cursor: number; focused: boolean;
}) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={focused ? "cyan" : "gray"}>{" 🩺 Doctor"}</Text>
      <Text>{""}</Text>
      {categories.map((cat, i) => {
        const oks = cat.checks.filter(c => c.status === "ok").length;
        const total = cat.checks.length;
        const allOk = oks === total;
        const isCursor = focused && i === cursor;
        return (
          <Box key={cat.name}
            borderStyle={isCursor ? "round" as any : "single" as any}
            borderColor={isCursor ? "cyan" : allOk ? "green" : "yellow"}
            paddingX={1}
          >
            <Text bold={isCursor} color={isCursor ? "cyan" : "white"}>
              {cat.icon} {cat.name.padEnd(14)}
            </Text>
            <Text color={allOk ? "green" : "yellow"}>{oks}/{total} ✓</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Right: Doctor Detail ───────────────────────────────────────────────────

function DoctorDetailPane({ category }: { category: DiagCategory }) {
  const statusIcon = (s: string) => s === "ok" ? "✓" : s === "warn" ? "⚠" : "✗";
  const statusColor = (s: string) => s === "ok" ? "green" : s === "warn" ? "yellow" : "red";

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>{""}</Text>
      <Text bold color="cyan">{category.icon} {category.name}</Text>
      <Text>{""}</Text>
      {category.checks.map((check, i) => (
        <Box key={i}>
          <Text color={statusColor(check.status)}>{" "}{statusIcon(check.status)} </Text>
          <Text dimColor>{check.label.padEnd(18)}</Text>
          <Text>{check.value}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ─── Backup: data ───────────────────────────────────────────────────────────

const BACKUPS_DIR = join(HOME, ".claude-buddy", "backups");

interface BackupEntry { ts: string; fileCount: number }

function getBackups(): BackupEntry[] {
  if (!existsSync(BACKUPS_DIR)) return [];
  return readdirSync(BACKUPS_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}-\d{6}$/.test(f))
    .filter(f => statSync(join(BACKUPS_DIR, f)).isDirectory())
    .sort()
    .reverse()
    .map(ts => {
      let fileCount = 0;
      try {
        const m = JSON.parse(readFileSync(join(BACKUPS_DIR, ts, "manifest.json"), "utf8"));
        fileCount = m.files?.length ?? 0;
      } catch {}
      return { ts, fileCount };
    });
}

function createBackup(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const dir = join(BACKUPS_DIR, ts);
  mkdirSync(dir, { recursive: true });

  const manifest: { timestamp: string; files: string[] } = { timestamp: ts, files: [] };
  const tryRead = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

  const settingsPath = join(HOME, ".claude", "settings.json");
  if (existsSync(settingsPath)) { writeFileSync(join(dir, "settings.json"), readFileSync(settingsPath)); manifest.files.push("settings.json"); }

  const claudeJsonRaw = tryRead(join(HOME, ".claude.json"));
  if (claudeJsonRaw) {
    try {
      const mcp = JSON.parse(claudeJsonRaw).mcpServers?.["claude-buddy"];
      if (mcp) { writeFileSync(join(dir, "mcpserver.json"), JSON.stringify(mcp, null, 2)); manifest.files.push("mcpserver.json"); }
    } catch {}
  }

  const skillPath = join(HOME, ".claude", "skills", "buddy", "SKILL.md");
  if (existsSync(skillPath)) { copyFileSync(skillPath, join(dir, "SKILL.md")); manifest.files.push("SKILL.md"); }

  const stateDir = join(dir, "claude-buddy");
  mkdirSync(stateDir, { recursive: true });
  for (const f of ["menagerie.json", "status.json", "config.json"]) {
    const src = join(HOME, ".claude-buddy", f);
    if (existsSync(src)) { copyFileSync(src, join(stateDir, f)); manifest.files.push(`claude-buddy/${f}`); }
  }

  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return ts;
}

function deleteBackup(ts: string): boolean {
  const dir = join(BACKUPS_DIR, ts);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true });
  return true;
}

// ─── Middle: Backup List ────────────────────────────────────────────────────

const BACKUP_ACTIONS = [
  { key: "create", icon: "➕", label: "Create new backup" },
] as const;

function BackupListPane({ backups, cursor, focused }: {
  backups: BackupEntry[]; cursor: number; focused: boolean;
}) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={focused ? "cyan" : "gray"}>{" 💾 Backup"}</Text>
      <Text>{""}</Text>
      {BACKUP_ACTIONS.map((a, i) => {
        const isCursor = focused && i === cursor;
        return (
          <Box key={a.key}
            borderStyle={isCursor ? "round" as any : "single" as any}
            borderColor={isCursor ? "cyan" : "gray"}
            paddingX={1}
          >
            <Text bold={isCursor} color={isCursor ? "cyan" : "white"}>
              {a.icon} {a.label}
            </Text>
          </Box>
        );
      })}
      <Text>{""}</Text>
      <Text dimColor>{" "}Snapshots:</Text>
      <Text>{""}</Text>
      {backups.length === 0 ? (
        <Text dimColor>{" "}No backups yet.</Text>
      ) : (
        backups.map((b, bi) => {
          const idx = bi + BACKUP_ACTIONS.length;
          const isCursor = focused && cursor === idx;
          return (
            <Box key={b.ts}
              borderStyle={isCursor ? "round" as any : "single" as any}
              borderColor={isCursor ? "cyan" : bi === 0 ? "green" : "gray"}
              paddingX={1}
            >
              <Text bold={isCursor} color={isCursor ? "cyan" : "white"}>{b.ts}</Text>
              <Text dimColor>{" "}{b.fileCount} files</Text>
              {bi === 0 ? <Text color="green">{" latest"}</Text> : null}
            </Box>
          );
        })
      )}
    </Box>
  );
}

// ─── Right: Backup Detail ───────────────────────────────────────────────────

function BackupDetailPane({ backups, cursor }: {
  backups: BackupEntry[]; cursor: number;
}) {
  if (cursor < BACKUP_ACTIONS.length) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>{""}</Text>
        <Text bold color="cyan">➕ Create Backup</Text>
        <Text>{""}</Text>
        <Text dimColor>Creates a snapshot of all</Text>
        <Text dimColor>claude-buddy state files:</Text>
        <Text>{""}</Text>
        <Text>{" "}• settings.json</Text>
        <Text>{" "}• MCP server config</Text>
        <Text>{" "}• SKILL.md</Text>
        <Text>{" "}• menagerie.json</Text>
        <Text>{" "}• status.json</Text>
        <Text>{" "}• config.json</Text>
        <Text>{""}</Text>
        <Text dimColor>Press enter to create</Text>
      </Box>
    );
  }

  const b = backups[cursor - BACKUP_ACTIONS.length];
  if (!b) return <Text dimColor>{" "}No selection</Text>;

  let files: string[] = [];
  try {
    const m = JSON.parse(readFileSync(join(BACKUPS_DIR, b.ts, "manifest.json"), "utf8"));
    files = m.files ?? [];
  } catch {}

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>{""}</Text>
      <Text bold color="cyan">📦 {b.ts}</Text>
      <Text>{""}</Text>
      <Text dimColor>Files in this snapshot:</Text>
      <Text>{""}</Text>
      {files.map((f, i) => (
        <Text key={i}>{" "}• {f}</Text>
      ))}
      <Text>{""}</Text>
      <Text dimColor>{"─".repeat(28)}</Text>
      <Text>{""}</Text>
      <Text color="red">d = delete this backup</Text>
    </Box>
  );
}

// ─── Right: Buddy Card ──────────────────────────────────────────────────────

function BuddyCardPane({ companion, slot, isActive }: {
  companion: Companion; slot: string; isActive: boolean;
}) {
  const b = companion.bones;
  const color = RARITY_COLOR[b.rarity] ?? "white";
  const stars = RARITY_STARS[b.rarity];
  const shiny = b.shiny ? " ✨" : "";
  const art = getArtFrame(b.species, b.eye, 0);
  const hatLine = HAT_ART[b.hat];
  if (hatLine && !art[0].trim()) art[0] = hatLine;
  const reaction = loadReaction();

  const mkBar = (val: number) => {
    const f = Math.round(val / 10);
    return "█".repeat(f) + "░".repeat(10 - f);
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={2} paddingY={1} width={48}>

      {/* Header: rarity + species */}
      <Box justifyContent="space-between">
        <Text color={color}>{stars} {b.rarity.toUpperCase()}{shiny}</Text>
        <Text dimColor>{b.species.toUpperCase()}</Text>
      </Box>

      {/* ASCII art */}
      <Box flexDirection="column" marginTop={2} marginBottom={2}>
        {art.map((line, i) => line.trim() ? <Text key={i}>{"  "}{line}</Text> : null)}
      </Box>

      {/* Name */}
      <Box marginBottom={1}>
        <Text bold color={color}>{companion.name}</Text>
      </Box>

      {/* Personality */}
      <Box marginBottom={1}>
        <Text dimColor italic>"{companion.personality}"</Text>
      </Box>

      {/* Stats */}
      <Box flexDirection="column" marginBottom={1}>
        {(STAT_NAMES as readonly StatName[]).map(stat => {
          const val = b.stats[stat];
          const isPeak = stat === b.peak;
          const isDump = stat === b.dump;
          const marker = isPeak ? " ▲" : isDump ? " ▼" : "";
          const statColor = isPeak ? "green" : isDump ? "red" : undefined;
          return (
            <Box key={stat} justifyContent="space-between">
              <Text dimColor>{stat.padEnd(10)}</Text>
              <Text> {mkBar(val)} </Text>
              <Text bold color={statColor}>{String(val).padStart(3)}{marker.padEnd(2)}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Reaction */}
      {reaction?.reaction ? (
        <Box marginBottom={1}>
          <Text>💬 <Text italic>{reaction.reaction}</Text></Text>
        </Box>
      ) : null}

      {/* Footer */}
      <Box>
        <Text dimColor>eye: {b.eye}  hat: {b.hat}  slot: </Text>
        <Text bold>{slot}</Text>
        {isActive ? <Text color="green" bold>{" ●"}</Text> : null}
      </Box>

    </Box>
  );
}

// ─── Right: Setting Detail ──────────────────────────────────────────────────

interface SettingDef {
  key: string; label: string; description: string[];
  type: "number" | "options"; options?: string[];
  min?: number; default: string;
}

const SETTING_DEFS: SettingDef[] = [
  { key: "commentCooldown", label: "Comment Cooldown", description: ["Minimum seconds between", "buddy status line comments.", "", "Lower = chatty, Higher = quiet"], type: "number", min: 0, default: "30" },
  { key: "reactionTTL", label: "Reaction TTL", description: ["How long reactions stay", "visible in status line.", "", "0 = permanent"], type: "number", min: 0, default: "0" },
  { key: "bubbleStyle", label: "Bubble Style", description: ["Speech bubble style.", "", 'classic → "quoted"', "round → (parens)"], type: "options", options: ["classic", "round"], default: "classic" },
  { key: "bubblePosition", label: "Bubble Position", description: ["Bubble placement.", "", "top → above buddy", "left → beside buddy"], type: "options", options: ["top", "left"], default: "top" },
  { key: "showRarity", label: "Show Rarity", description: ["Show rarity stars in", "the status line.", "", "true → ★★★★ visible", "false → hidden"], type: "options", options: ["true", "false"], default: "true" },
];

function SettingDetailPane({ settingIndex, config, editing, numInput, optCursor }: {
  settingIndex: number; config: BuddyConfig; editing: boolean; numInput: string; optCursor: number;
}) {
  const def = SETTING_DEFS[settingIndex];
  const currentVal = String(config[def.key as keyof BuddyConfig]);
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>{""}</Text>
      <Text bold color="cyan">{def.label}</Text>
      <Text>{""}</Text>
      {def.description.map((line, i) => <Text key={i} dimColor>{line}</Text>)}
      <Text>{""}</Text>
      <Text dimColor>{"─".repeat(28)}</Text>
      <Text>{""}</Text>
      {!editing ? (
        <Box flexDirection="column">
          <Text>Current: <Text bold color="yellow">{currentVal}</Text></Text>
          <Text dimColor>Default: {def.default}</Text>
          <Text>{""}</Text>
          <Text dimColor>Press enter to edit</Text>
        </Box>
      ) : def.type === "options" ? (
        <Box flexDirection="column">
          {def.options!.map((opt, i) => (
            <Text key={opt}>
              {i === optCursor ? <Text color="green" bold>{" ▸ "}{opt}</Text> : opt === currentVal ? <Text>{" ● "}{opt}</Text> : <Text dimColor>{" ○ "}{opt}</Text>}
              {opt === def.default ? <Text dimColor>{" (default)"}</Text> : null}
            </Text>
          ))}
          <Text>{""}</Text>
          <Text dimColor>↑↓ select  enter confirm  esc cancel</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box>
            <Text dimColor>{"Value: "}</Text>
            <Text bold color="yellow" underline>{numInput || " "}</Text>
            <Text color="yellow">▌</Text>
            <Text dimColor> seconds</Text>
          </Box>
          <Text>{""}</Text>
          <Text dimColor>Was: {currentVal}  Default: {def.default}</Text>
          <Text>{""}</Text>
          <Text dimColor>Type number  enter confirm  esc cancel</Text>
        </Box>
      )}
    </Box>
  );
}

// ─── Right: Welcome ─────────────────────────────────────────────────────────

function WelcomePane() {
  const slots = listCompanionSlots();
  const activeSlot = loadActiveSlot();
  const entry = slots.find(s => s.slot === activeSlot);
  if (!entry) return <Box flexDirection="column" paddingLeft={1}><Text dimColor>No companion yet.</Text></Box>;
  return <BuddyCardPane companion={entry.companion} slot={entry.slot} isActive={true} />;
}

// ─── App ────────────────────────────────────────────────────────────────────

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;

  const [section, setSection] = useState<Section>("menagerie");
  const [focus, setFocus] = useState<Focus>("sidebar");
  const [sidebarCursor, setSidebarCursor] = useState(0);
  const [listCursor, setListCursor] = useState(0);
  const [settCursor, setSettCursor] = useState(0);
  const [optCursor, setOptCursor] = useState(0);
  const [numInput, setNumInput] = useState("");
  const [config, setConfig] = useState<BuddyConfig>(loadConfig());
  const [message, setMessage] = useState("");
  const [diagData] = useState(() => runDiagnostics());
  const [backups, setBackups] = useState(() => getBackups());

  const slots = listCompanionSlots();
  const activeSlot = loadActiveSlot();

  const sidebarWidth = 35;
  const middleWidth = 35;

  useInput((input, key) => {
    setMessage("");

    // Unified: Enter or Space = primary action
    const isSelect = key.return || input === " ";

    // ─── Sidebar ────────────────────────────
    if (focus === "sidebar") {
      if (key.upArrow) setSidebarCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setSidebarCursor(c => Math.min(SIDEBAR_ITEMS.length, c + 1));
      if (input === "q") exit();
      if (isSelect) {
        if (sidebarCursor >= SIDEBAR_ITEMS.length) { exit(); return; }
        const selected = SIDEBAR_ITEMS[sidebarCursor].key;
        setSection(selected);
        setFocus("list");
        setListCursor(0);
        setSettCursor(0);
        if (selected === "backup") setBackups(getBackups());
      }
    }

    // ─── List: Menagerie ────────────────────
    else if (focus === "list" && section === "menagerie") {
      if (key.escape) setFocus("sidebar");
      if (input === "q") exit();
      if (key.upArrow) setListCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setListCursor(c => Math.min(slots.length - 1, c + 1));
      if (isSelect && slots[listCursor]) {
        const { slot, companion } = slots[listCursor];
        saveActiveSlot(slot);
        writeStatusState(companion, `*${companion.name} arrives*`);
        setMessage(`✓ ${companion.name} is now active!`);
      }
    }

    // ─── List: Settings ─────────────────────
    else if (focus === "list" && section === "settings") {
      if (key.escape) setFocus("sidebar");
      if (input === "q") exit();
      if (key.upArrow) setSettCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setSettCursor(c => Math.min(SETTINGS_ITEMS.length - 1, c + 1));
      if (isSelect) {
        const def = SETTING_DEFS[settCursor];
        if (def.type === "options") {
          const current = String(config[def.key as keyof BuddyConfig]);
          setOptCursor(def.options!.indexOf(current));
        } else {
          setNumInput(String(config[def.key as keyof BuddyConfig]));
        }
        setFocus("edit");
      }
    }

    // ─── List: Doctor ───────────────────────
    else if (focus === "list" && section === "doctor") {
      if (key.escape) setFocus("sidebar");
      if (input === "q") exit();
      if (key.upArrow) setListCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setListCursor(c => Math.min(diagData.length - 1, c + 1));
    }

    // ─── List: Backup ───────────────────────
    else if (focus === "list" && section === "backup") {
      if (key.escape) setFocus("sidebar");
      if (input === "q") exit();
      const maxIdx = BACKUP_ACTIONS.length + backups.length - 1;
      if (key.upArrow) setListCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setListCursor(c => Math.min(maxIdx, c + 1));
      if (isSelect) {
        if (listCursor < BACKUP_ACTIONS.length) {
          const ts = createBackup();
          setBackups(getBackups());
          setMessage(`✓ Backup created: ${ts}`);
          setListCursor(0);
        }
      }
      if (input === "d" && listCursor >= BACKUP_ACTIONS.length) {
        const b = backups[listCursor - BACKUP_ACTIONS.length];
        if (b && deleteBackup(b.ts)) {
          setBackups(getBackups());
          setMessage(`✓ Deleted: ${b.ts}`);
          setListCursor(Math.max(0, listCursor - 1));
        }
      }
    }

    // ─── Edit: Settings value ───────────────
    else if (focus === "edit") {
      const def = SETTING_DEFS[settCursor];
      if (key.escape) { setNumInput(""); setFocus("list"); }

      if (def.type === "options") {
        if (key.upArrow) setOptCursor(c => Math.max(0, c - 1));
        if (key.downArrow) setOptCursor(c => Math.min(def.options!.length - 1, c + 1));
        if (isSelect) {
          const selected = def.options![optCursor];
          const val = selected === "true" ? true : selected === "false" ? false : selected;
          setConfig(saveConfig({ [def.key]: val }));
          setMessage(`✓ ${def.label} → ${selected}`);
          setFocus("list");
        }
      } else {
        if (input >= "0" && input <= "9" && numInput.length < 6) setNumInput(prev => prev + input);
        if (key.backspace || key.delete) setNumInput(prev => prev.slice(0, -1));
        if (key.return) {
          const clamped = Math.max(def.min ?? 0, parseInt(numInput || "0", 10));
          setConfig(saveConfig({ [def.key]: clamped }));
          setMessage(`✓ ${def.label} → ${clamped}`);
          setNumInput("");
          setFocus("list");
        }
      }
    }
  });

  // ─── Build panes ────────────────────────────
  const showContent = focus !== "sidebar";
  let middlePane: React.ReactNode = null;
  let rightPane: React.ReactNode = null;

  if (showContent) {
    if (section === "menagerie") {
      middlePane = <BuddyListPane slots={slots} cursor={listCursor} activeSlot={activeSlot} focused={focus === "list"} />;
      if (slots[listCursor]) {
        const { slot, companion } = slots[listCursor];
        rightPane = <BuddyCardPane companion={companion} slot={slot} isActive={slot === activeSlot} />;
      }
    } else if (section === "settings") {
      middlePane = <SettingsListPane cursor={settCursor} config={config} focused={focus === "list"} />;
      rightPane = <SettingDetailPane settingIndex={settCursor} config={config} editing={focus === "edit"} numInput={numInput} optCursor={optCursor} />;
    } else if (section === "doctor") {
      middlePane = <DoctorListPane categories={diagData} cursor={listCursor} focused={focus === "list"} />;
      rightPane = diagData[listCursor] ? <DoctorDetailPane category={diagData[listCursor]} /> : null;
    } else if (section === "backup") {
      middlePane = <BackupListPane backups={backups} cursor={listCursor} focused={focus === "list"} />;
      rightPane = <BackupDetailPane backups={backups} cursor={listCursor} />;
    }
  }

  // ─── Footer ─────────────────────────────────
  const helpText =
    focus === "sidebar" ? "↑↓ navigate  ⏎/␣ select  q quit" :
    focus === "edit" ? (SETTING_DEFS[settCursor]?.type === "options"
      ? "↑↓ navigate  ⏎/␣ confirm  esc back"
      : "type number  ⏎ confirm  esc back") :
    section === "menagerie" ? "↑↓ navigate  ⏎/␣ summon  esc back  q quit" :
    section === "doctor" ? "↑↓ navigate  esc back  q quit" :
    section === "backup" ? "↑↓ navigate  ⏎/␣ select  d delete  esc back  q quit" :
    "↑↓ navigate  ⏎/␣ select  esc back  q quit";

  return (
    <Box flexDirection="column" height={rows}>
      <Box>
        <Text color="cyan" bold>{"─ claude-buddy "}{"─".repeat(Math.max(0, cols - 17))}</Text>
      </Box>
      <Box flexGrow={1}>
        <Box width={sidebarWidth} flexDirection="column" borderStyle="single" borderColor={focus === "sidebar" ? "cyan" : "gray"}>
          <Sidebar cursor={sidebarCursor} section={section} focus={focus} />
        </Box>
        {showContent ? (
          <>
            <Box width={middleWidth} flexDirection="column" borderStyle="single" borderColor={focus === "list" ? "cyan" : "gray"}>
              {middlePane}
            </Box>
            <Box flexGrow={1} flexDirection="column" borderStyle="single" borderColor={focus === "edit" ? "cyan" : "gray"}>
              {rightPane}
            </Box>
          </>
        ) : (
          <Box flexGrow={1} flexDirection="column" borderStyle="single" borderColor="gray">
            <WelcomePane />
          </Box>
        )}
      </Box>
      {message ? <Box><Text color="green" bold>{"  "}{message}</Text></Box> : null}
      <Box>
        <Text dimColor>{"─ "}{helpText}{" "}{"─".repeat(Math.max(0, cols - helpText.length - 4))}</Text>
      </Box>
    </Box>
  );
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (!process.stdin.isTTY) {
  console.error("claude-buddy tui requires an interactive terminal (TTY)");
  process.exit(1);
}

render(<App />, { fullscreen: true });
