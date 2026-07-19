"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const os = require("os");
const fs = require("fs");

const {
  TOOL_KINDS,
  POLICY_ACTIONS,
  canonicalToolKind,
  cloneDefaultToolPolicies,
  normalizeToolPolicies,
  normalizeDirPath,
  decideToolPolicy,
} = require("../src/permission-policy");

const HOME = os.homedir();

describe("canonicalToolKind", () => {
  it("maps Claude Code tool names", () => {
    assert.strictEqual(canonicalToolKind("Read"), "read");
    assert.strictEqual(canonicalToolKind("Glob"), "read");
    assert.strictEqual(canonicalToolKind("Grep"), "read");
    assert.strictEqual(canonicalToolKind("Edit"), "edit");
    assert.strictEqual(canonicalToolKind("Write"), "edit");
    assert.strictEqual(canonicalToolKind("NotebookEdit"), "edit");
    assert.strictEqual(canonicalToolKind("Bash"), "exec");
    assert.strictEqual(canonicalToolKind("WebFetch"), "network");
    assert.strictEqual(canonicalToolKind("WebSearch"), "network");
  });

  it("maps Codex and opencode tool names", () => {
    assert.strictEqual(canonicalToolKind("read_file"), "read");
    assert.strictEqual(canonicalToolKind("edit_file"), "edit");
    assert.strictEqual(canonicalToolKind("apply_patch"), "edit");
    assert.strictEqual(canonicalToolKind("bash_command"), "exec");
    assert.strictEqual(canonicalToolKind("shell_command"), "exec");
    assert.strictEqual(canonicalToolKind("open_file"), "read");
    assert.strictEqual(canonicalToolKind("run_shell_command"), "exec");
  });

  it("maps F4 additional tool names", () => {
    // Copilot CLI
    assert.strictEqual(canonicalToolKind("edit"), "edit");
    assert.strictEqual(canonicalToolKind("powershell"), "exec");
    // Hermes
    assert.strictEqual(canonicalToolKind("execute_bash"), "exec");
    // opencode
    assert.strictEqual(canonicalToolKind("run_command"), "exec");
    assert.strictEqual(canonicalToolKind("write_to_file"), "edit");
  });

  it("falls back to other for unknown, MCP, and non-string names", () => {
    assert.strictEqual(canonicalToolKind("SomethingNew"), "other");
    assert.strictEqual(canonicalToolKind("mcp__atlassian__search"), "other");
    assert.strictEqual(canonicalToolKind(""), "other");
    assert.strictEqual(canonicalToolKind(null), "other");
    assert.strictEqual(canonicalToolKind(undefined), "other");
  });
});

describe("cloneDefaultToolPolicies", () => {
  it("returns all-bubble global and empty directories, fresh object each call", () => {
    const a = cloneDefaultToolPolicies();
    const b = cloneDefaultToolPolicies();
    assert.notStrictEqual(a, b);
    assert.notStrictEqual(a.global, b.global);
    assert.deepStrictEqual(a.directories, []);
    for (const kind of TOOL_KINDS) assert.strictEqual(a.global[kind], "bubble");
  });
});

describe("normalizeToolPolicies", () => {
  it("returns defaults for garbage input", () => {
    for (const raw of [null, undefined, 42, "x", [], { global: "no" }]) {
      const norm = normalizeToolPolicies(raw);
      assert.deepStrictEqual(norm, cloneDefaultToolPolicies());
    }
  });

  it("keeps valid actions and drops invalid ones", () => {
    const norm = normalizeToolPolicies({
      global: { read: "allow", exec: "yolo", bogusKind: "allow" },
      directories: "nope",
    });
    assert.strictEqual(norm.global.read, "allow");
    assert.strictEqual(norm.global.exec, "bubble");
    assert.strictEqual("bogusKind" in norm.global, false);
    assert.deepStrictEqual(norm.directories, []);
  });

  it("normalizes directory rules: expands ~, resolves, strips trailing sep, drops invalid", () => {
    const norm = normalizeToolPolicies({
      global: {},
      directories: [
        { path: "~/proj/", policies: { read: "allow", exec: "bad" } },
        { path: "", policies: { read: "allow" } },
        { path: "/ok", policies: {} },
        "garbage",
      ],
    });
    assert.strictEqual(norm.directories.length, 2);
    assert.strictEqual(norm.directories[0].path, path.join(HOME, "proj"));
    assert.deepStrictEqual(norm.directories[0].policies, { read: "allow" });
    assert.strictEqual(norm.directories[1].path, path.resolve("/ok"));
  });

  it("never shares references with the raw input", () => {
    const raw = { global: { read: "allow" }, directories: [{ path: "/a", policies: { read: "allow" } }] };
    const norm = normalizeToolPolicies(raw);
    raw.global.read = "deny";
    raw.directories[0].policies.read = "deny";
    assert.strictEqual(norm.global.read, "allow");
    assert.strictEqual(norm.directories[0].policies.read, "allow");
  });
});

describe("decideToolPolicy", () => {
  const policies = (over = {}) => ({
    global: { read: "bubble", edit: "bubble", exec: "bubble", network: "bubble", other: "bubble", ...over.global },
    directories: over.directories || [],
  });

  it("defaults to bubble with no config", () => {
    assert.strictEqual(decideToolPolicy(null, { toolName: "Read" }), "bubble");
    assert.strictEqual(decideToolPolicy(undefined, {}), "bubble");
  });

  it("applies global action per canonical kind", () => {
    const p = policies({ global: { read: "allow", exec: "deny" } });
    assert.strictEqual(decideToolPolicy(p, { toolName: "Read", cwd: "/x" }), "allow");
    assert.strictEqual(decideToolPolicy(p, { toolName: "read_file", cwd: "/x" }), "allow");
    assert.strictEqual(decideToolPolicy(p, { toolName: "Bash", cwd: "/x" }), "deny");
    assert.strictEqual(decideToolPolicy(p, { toolName: "Edit", cwd: "/x" }), "bubble");
  });

  it("unknown tools stay bubble even when read is auto-allowed", () => {
    const p = policies({ global: { read: "allow" } });
    assert.strictEqual(decideToolPolicy(p, { toolName: "TotallyNew", cwd: "/x" }), "bubble");
  });

  it("directory rule overrides global, with path-boundary matching", () => {
    const p = policies({
      global: { read: "bubble" },
      directories: [{ path: "/work/proj", policies: { read: "allow" } }],
    });
    assert.strictEqual(decideToolPolicy(p, { toolName: "Read", cwd: "/work/proj" }), "allow");
    assert.strictEqual(decideToolPolicy(p, { toolName: "Read", cwd: "/work/proj/sub" }), "allow");
    assert.strictEqual(decideToolPolicy(p, { toolName: "Read", cwd: "/work/project" }), "bubble");
    assert.strictEqual(decideToolPolicy(p, { toolName: "Read", cwd: "/elsewhere" }), "bubble");
  });

  it("longest matching directory rule wins", () => {
    const p = policies({
      directories: [
        { path: "/work", policies: { read: "deny" } },
        { path: "/work/proj", policies: { read: "allow" } },
      ],
    });
    assert.strictEqual(decideToolPolicy(p, { toolName: "Read", cwd: "/work/proj/deep" }), "allow");
    assert.strictEqual(decideToolPolicy(p, { toolName: "Read", cwd: "/work/other" }), "deny");
  });

  it("directory rule missing the kind falls through to global, not to a shorter rule", () => {
    const p = policies({
      global: { exec: "deny" },
      directories: [
        { path: "/work", policies: { exec: "allow" } },
        { path: "/work/proj", policies: { read: "allow" } },
      ],
    });
    // longest match (/work/proj) has no exec entry → global deny (predictable, documented)
    assert.strictEqual(decideToolPolicy(p, { toolName: "Bash", cwd: "/work/proj" }), "deny");
  });

  it("missing or non-absolute cwd bubbles when directories are configured", () => {
    // F3: directories present + no/bad cwd → bubble (cannot determine if deny applies)
    const p = policies({
      global: { read: "allow" },
      directories: [{ path: "/work", policies: { read: "deny" } }],
    });
    assert.strictEqual(decideToolPolicy(p, { toolName: "Read" }), "bubble");
    assert.strictEqual(decideToolPolicy(p, { toolName: "Read", cwd: "" }), "bubble");
    assert.strictEqual(decideToolPolicy(p, { toolName: "Read", cwd: "relative/path" }), "bubble");
  });

  it("missing cwd falls through to global when no directories are configured", () => {
    // F3: no directories → global applies regardless of cwd
    const p = policies({
      global: { read: "allow" },
      directories: [],
    });
    assert.strictEqual(decideToolPolicy(p, { toolName: "Read" }), "allow");
    assert.strictEqual(decideToolPolicy(p, { toolName: "Read", cwd: "" }), "allow");
  });

  it("sessionPolicies override directory and global", () => {
    const p = policies({
      global: { read: "deny" },
      directories: [{ path: "/work", policies: { read: "deny" } }],
    });
    assert.strictEqual(
      decideToolPolicy(p, { toolName: "Read", cwd: "/work", sessionPolicies: { read: "allow" } }),
      "allow"
    );
    assert.strictEqual(
      decideToolPolicy(p, { toolName: "Read", cwd: "/work", sessionPolicies: { read: "junk" } }),
      "deny"
    );
  });

  it("expands ~ in configured directory paths", () => {
    const p = policies({ directories: [{ path: "~/proj", policies: { read: "allow" } }] });
    assert.strictEqual(
      decideToolPolicy(p, { toolName: "Read", cwd: path.join(HOME, "proj", "sub") }),
      "allow"
    );
  });

  it("exports sanity", () => {
    assert.deepStrictEqual([...TOOL_KINDS], ["read", "edit", "exec", "network", "other"]);
    assert.deepStrictEqual([...POLICY_ACTIONS], ["allow", "bubble", "deny"]);
  });
});

describe("normalizeDirPath – symlink canonicalization (F5)", () => {
  it("resolves /var to /private/var on macOS (or keeps lexical if not macOS)", () => {
    const result = normalizeDirPath("/var");
    // On macOS /var is a symlink to /private/var; on Linux it resolves to itself.
    // Either way the result must be an absolute path.
    assert.ok(path.isAbsolute(result), `expected absolute path, got: ${result}`);
    // Must not retain trailing separator (root "/" is the only exception).
    if (result !== "/") assert.ok(!result.endsWith(path.sep));
  });

  it("symlinked cwd and real rule path match after normalization", () => {
    const os = require("os");
    const tmpReal = fs.mkdtempSync(path.join(os.tmpdir(), "policy-real-"));
    const tmpLink = path.join(os.tmpdir(), `policy-link-${Date.now()}`);
    try {
      fs.symlinkSync(tmpReal, tmpLink);
      // rule configured with real path; cwd arrives via symlink
      const p = {
        global: { read: "bubble" },
        directories: [{ path: tmpReal, policies: { read: "allow" } }],
      };
      // normalizeDirPath resolves both to real path → isPathWithin matches
      assert.strictEqual(
        decideToolPolicy(p, { toolName: "Read", cwd: tmpLink }),
        "allow",
        "symlink cwd should match real rule path after realpathSync.native"
      );
    } finally {
      try { fs.rmSync(tmpLink); } catch {}
      try { fs.rmSync(tmpReal, { recursive: true }); } catch {}
    }
  });
});
