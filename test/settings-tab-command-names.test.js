"use strict";

// Mechanical contract test: every action name passed to settingsAPI.command()
// in settings-tab-*.js must resolve in the commandRegistry (or applyCommand's
// known-valid set). This catches "unknown command" silent failures that don't
// surface until the settings UI is exercised on-device.
//
// How it works:
//   1. Scan all settings-tab-*.js source files with a regex to collect every
//      literal string passed to settingsAPI.command("...").
//   2. Build the valid-name set from settings-actions.js commandRegistry keys.
//   3. Assert collected names are a subset of valid names (with an allowlist for
//      known pre-existing exceptions discovered at test-write time).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", "src");

// ── Collect command names used in settings-tab-*.js ──

function collectTabCommandNames() {
  const tabFiles = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.startsWith("settings-tab-") && f.endsWith(".js"))
    .map((f) => path.join(SRC_DIR, f));

  // Matches: settingsAPI.command("some-name"  or  settingsAPI.command('some-name'
  const RE = /settingsAPI\.command\(\s*["']([^"']+)["']/g;
  const found = new Map(); // name → first file:line where it appears

  for (const filePath of tabFiles) {
    const src = fs.readFileSync(filePath, "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      let m;
      RE.lastIndex = 0;
      while ((m = RE.exec(line)) !== null) {
        const name = m[1];
        if (!found.has(name)) {
          found.set(name, `${path.basename(filePath)}:${i + 1}`);
        }
      }
    });
  }
  return found;
}

// ── Build valid command name set from commandRegistry ──

function collectRegistryNames() {
  // Load the settings-actions module. It uses module.exports, so require() works.
  // We need a minimal stub for its dependencies that may not resolve in test env.
  // Rather than executing it (which pulls in Electron/native deps), we parse the
  // commandRegistry object literal from source via regex — safe and dependency-free.
  const actionsFiles = [
    "settings-actions.js",
    "settings-actions-agents.js",
    "settings-actions-shortcuts.js",
    "settings-actions-system.js",
    "settings-actions-theme-overrides.js",
  ].map((f) => path.join(SRC_DIR, f));

  const names = new Set();

  for (const filePath of actionsFiles) {
    const src = fs.readFileSync(filePath, "utf8");
    // Match bare identifier keys: e.g. `  removeTheme,` or `  removeTheme: fn,`
    // and quoted keys: `  "remoteSsh.add": fn,`
    const bareRE = /^\s{2}([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\s*[:,])/gm;
    const quotedRE = /^\s{2}"([^"]+)"\s*:/gm;

    // Find the commandRegistry block boundaries (conservative: collect all top-level keys
    // from any object that follows `commandRegistry = {` through the matching `}`).
    // Simpler: just collect all quoted/bare keys from the commandRegistry literal.
    // We bound the scan to lines after the `commandRegistry = {` declaration.
    const registryStart = src.indexOf("commandRegistry = {");
    if (registryStart === -1) continue;
    const block = src.slice(registryStart);
    // Find the closing `};` — walk depth
    let depth = 0, end = -1;
    for (let i = block.indexOf("{"); i < block.length; i++) {
      if (block[i] === "{") depth++;
      else if (block[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    const registryBlock = end !== -1 ? block.slice(0, end + 1) : block;

    let m;
    bareRE.lastIndex = 0;
    while ((m = bareRE.exec(registryBlock)) !== null) names.add(m[1]);
    quotedRE.lastIndex = 0;
    while ((m = quotedRE.exec(registryBlock)) !== null) names.add(m[1]);
  }

  return names;
}

// ── Allowlist: pre-existing names that were already broken before this PR ──
// These are NOT introduced by the permission-policy tab. Do not add new entries.
// If a name here starts passing (added to commandRegistry), remove it from the list.
const KNOWN_BROKEN_ALLOWLIST = new Set([
  // None discovered at test-write time — list intentionally empty.
  // Add entries only if `npm test` reveals pre-existing failures from other tabs.
]);

// ── Tests ──

test("settings-tab-*.js: all settingsAPI.command() action names exist in commandRegistry", () => {
  const usedNames = collectTabCommandNames();
  const validNames = collectRegistryNames();

  const failures = [];
  for (const [name, loc] of usedNames) {
    if (KNOWN_BROKEN_ALLOWLIST.has(name)) continue;
    if (!validNames.has(name)) {
      failures.push(`  "${name}" (used at ${loc}) is not in commandRegistry`);
    }
  }

  if (failures.length > 0) {
    assert.fail(
      "Unknown command names found in settings-tab-*.js:\n" +
        failures.join("\n") +
        "\n\nIf these are pre-existing (not introduced by this PR), add them to KNOWN_BROKEN_ALLOWLIST."
    );
  }
});

test("settings-tab-permission-policy.js: uses pickDirectory(), not command('settings:pick-directory')", () => {
  const src = fs.readFileSync(path.join(SRC_DIR, "settings-tab-permission-policy.js"), "utf8");
  // Must NOT use command() with the directory picker channel name
  assert.ok(
    !src.includes('command("settings:pick-directory"') && !src.includes("command('settings:pick-directory'"),
    "permission-policy tab must not call settingsAPI.command(\"settings:pick-directory\") — use pickDirectory() instead"
  );
  // Must use the direct bridge call
  assert.ok(
    src.includes("pickDirectory()"),
    "permission-policy tab must call settingsAPI.pickDirectory()"
  );
});

test("preload-settings.js: exposes pickDirectory as ipcRenderer.invoke('settings:pick-directory')", () => {
  const src = fs.readFileSync(path.join(SRC_DIR, "preload-settings.js"), "utf8");
  assert.ok(
    src.includes('pickDirectory:') && src.includes('"settings:pick-directory"'),
    "preload-settings.js must expose pickDirectory: () => ipcRenderer.invoke('settings:pick-directory')"
  );
});
