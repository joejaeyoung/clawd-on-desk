"use strict";

// ── Tool permission policy (pure data layer) ──
//
// Decides what to do with an agent permission request BEFORE a bubble is
// rendered: "allow" (auto-approve), "deny" (auto-reject), or "bubble" (ask
// the user — the default). Zero Electron/ctx dependencies so it unit-tests
// with plain node:test.
//
// Resolution order (most specific wins):
//   1. sessionPolicies (runtime-only, passed by the caller; Plan 2 wires a store)
//   2. directory rules (longest normalized-prefix match on the request cwd)
//   3. global policy
//   4. "bubble"
//
// Fail-safe: anything malformed — unknown tool, bad config, missing cwd —
// falls through to "bubble". No error path may produce an auto-approve.

const path = require("path");
const os = require("os");

const TOOL_KINDS = Object.freeze(["read", "edit", "exec", "network", "other"]);
const TOOL_KIND_SET = new Set(TOOL_KINDS);
const POLICY_ACTIONS = Object.freeze(["allow", "bubble", "deny"]);
const POLICY_ACTION_SET = new Set(POLICY_ACTIONS);
const DEFAULT_ACTION = "bubble";

// Agent tool name → canonical kind. Names don't collide across agents, so a
// single flat map covers Claude Code/CodeBuddy, Codex, and opencode. Unknown
// names (incl. every mcp__* tool) resolve to "other" — safe: its default is
// "bubble" and users opt kinds in explicitly.
const TOOL_KIND_MAP = Object.freeze({
  // Claude Code / CodeBuddy
  Read: "read",
  Glob: "read",
  Grep: "read",
  BashOutput: "read",
  Edit: "edit",
  Write: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Bash: "exec",
  KillShell: "exec",
  WebFetch: "network",
  WebSearch: "network",
  // Codex
  read_file: "read",
  list_files: "read",
  grep_search: "read",
  edit_file: "edit",
  write_file: "edit",
  apply_patch: "edit",
  bash_command: "exec",
  shell_command: "exec",
  exec_command: "exec",
  web_search: "network",
  fetch_url: "network",
  // opencode
  open_file: "read",
  run_shell_command: "exec",
});

function canonicalToolKind(toolName) {
  if (typeof toolName !== "string" || !toolName) return "other";
  return TOOL_KIND_MAP[toolName] || "other";
}

function cloneDefaultToolPolicies() {
  const global = {};
  for (const kind of TOOL_KINDS) global[kind] = DEFAULT_ACTION;
  return { global, directories: [] };
}

// "~" and "~/..." expand to the user's home; everything else resolves as-is.
// Returns "" for non-string/empty input so callers can skip the tier.
function normalizeDirPath(value) {
  if (typeof value !== "string" || !value) return "";
  let p = value;
  if (p === "~") p = os.homedir();
  else if (p.startsWith("~" + path.sep) || p.startsWith("~/")) {
    p = path.join(os.homedir(), p.slice(2));
  }
  p = path.resolve(p);
  // path.resolve already strips trailing separators (except root)
  return p;
}

function normalizePolicyMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const kind of TOOL_KINDS) {
    if (POLICY_ACTION_SET.has(raw[kind])) out[kind] = raw[kind];
  }
  return out;
}

// prefs.js validate() calls normalize(value, defaultValue) — keep that shape.
// Always returns a full, freshly-built structure sharing no refs with `raw`.
function normalizeToolPolicies(raw, fallback) {
  const base = cloneDefaultToolPolicies();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback && typeof fallback === "object"
      ? normalizeToolPolicies(fallback)
      : base;
  }
  const globalOverrides = normalizePolicyMap(raw.global);
  for (const kind of Object.keys(globalOverrides)) base.global[kind] = globalOverrides[kind];

  if (Array.isArray(raw.directories)) {
    for (const entry of raw.directories) {
      if (!entry || typeof entry !== "object") continue;
      const dirPath = normalizeDirPath(entry.path);
      if (!dirPath) continue;
      base.directories.push({ path: dirPath, policies: normalizePolicyMap(entry.policies) });
    }
  }
  return base;
}

function isPathWithin(cwd, dir) {
  return cwd === dir || cwd.startsWith(dir + path.sep);
}

function decideToolPolicy(rawPolicies, request = {}) {
  try {
    const kind = canonicalToolKind(request.toolName);
    if (!TOOL_KIND_SET.has(kind)) return DEFAULT_ACTION;

    // 1. session override (runtime-only, provided by the caller)
    const session = request.sessionPolicies;
    if (session && typeof session === "object" && POLICY_ACTION_SET.has(session[kind])) {
      return session[kind];
    }

    const policies = normalizeToolPolicies(rawPolicies);

    // 2. directory rules — longest matching path wins; a matching rule that
    // lacks this kind falls through to global (NOT to a shorter rule), so a
    // narrow rule cleanly scopes only the kinds it names.
    const cwd = normalizeDirPath(request.cwd);
    if (cwd) {
      let best = null;
      for (const rule of policies.directories) {
        if (!isPathWithin(cwd, rule.path)) continue;
        if (!best || rule.path.length > best.path.length) best = rule;
      }
      if (best && POLICY_ACTION_SET.has(best.policies[kind])) return best.policies[kind];
    }

    // 3. global
    const globalAction = policies.global[kind];
    return POLICY_ACTION_SET.has(globalAction) ? globalAction : DEFAULT_ACTION;
  } catch (_err) {
    // Fail-safe: never auto-approve on an error path.
    return DEFAULT_ACTION;
  }
}

module.exports = {
  TOOL_KINDS,
  POLICY_ACTIONS,
  canonicalToolKind,
  cloneDefaultToolPolicies,
  normalizeToolPolicies,
  decideToolPolicy,
};
