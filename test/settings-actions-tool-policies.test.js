"use strict";

// Tests for the toolPolicies validator in updateRegistry.
// Validator contract: always { status: "ok", value: <normalized> } — coerce
// instead of reject (normalizeToolPolicies is fail-safe). The "value" field
// carries the normalized structure that the caller may use; the controller
// reads only "status" and "noop".

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { updateRegistry } = require("../src/settings-actions");
const { cloneDefaultToolPolicies, normalizeDirPath } = require("../src/permission-policy");
const prefs = require("../src/prefs");

const deps = { snapshot: prefs.getDefaults() };

describe("updateRegistry.toolPolicies — coerce-always validator", () => {
  it("passes valid input and echoes normalized structure in result.value", () => {
    const input = {
      global: { read: "allow", exec: "deny" },
      directories: [],
    };
    const result = updateRegistry.toolPolicies(input, deps);
    assert.strictEqual(result.status, "ok");
    // value field carries the normalized copy
    assert.ok(result.value, "result.value should be present");
    assert.strictEqual(result.value.global.read, "allow");
    assert.strictEqual(result.value.global.exec, "deny");
    // Unspecified kinds default to "bubble"
    assert.strictEqual(result.value.global.edit, "bubble");
    assert.deepStrictEqual(result.value.directories, []);
  });

  it("corrects garbage input to all-bubble defaults (never rejects)", () => {
    const garbage = "not-an-object";
    const result = updateRegistry.toolPolicies(garbage, deps);
    // Must not reject — coerce to defaults
    assert.strictEqual(result.status, "ok");
    const expected = cloneDefaultToolPolicies();
    assert.deepStrictEqual(result.value, expected);
  });

  it("normalizes ~ paths in directory rules", () => {
    const os = require("os");
    const input = {
      global: {},
      directories: [
        { path: "~/projects", policies: { read: "allow" } },
      ],
    };
    const result = updateRegistry.toolPolicies(input, deps);
    assert.strictEqual(result.status, "ok");
    // normalizeDirPath expands "~/projects" to an absolute path
    const expected = normalizeDirPath("~/projects");
    assert.strictEqual(result.value.directories.length, 1);
    assert.strictEqual(result.value.directories[0].path, expected);
  });

  it("silently drops directory entries with empty/invalid paths", () => {
    const input = {
      global: { read: "deny" },
      directories: [
        { path: "", policies: { read: "allow" } },
        { path: null, policies: { exec: "deny" } },
        { path: "/valid/path", policies: { edit: "allow" } },
      ],
    };
    const result = updateRegistry.toolPolicies(input, deps);
    assert.strictEqual(result.status, "ok");
    // Only the entry with a valid path survives
    assert.strictEqual(result.value.directories.length, 1);
  });
});
