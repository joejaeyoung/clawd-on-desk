"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const prefs = require("../src/prefs");

describe("prefs toolPolicies", () => {
  it("defaults to all-bubble global and empty directories", () => {
    const d = prefs.getDefaults();
    assert.deepStrictEqual(d.toolPolicies, {
      global: { read: "bubble", edit: "bubble", exec: "bubble", network: "bubble", other: "bubble" },
      directories: [],
    });
  });

  it("validate() preserves a valid custom config", () => {
    const out = prefs.validate({
      toolPolicies: {
        global: { read: "allow" },
        directories: [{ path: "/work/proj", policies: { exec: "deny" } }],
      },
    });
    assert.strictEqual(out.toolPolicies.global.read, "allow");
    assert.strictEqual(out.toolPolicies.global.exec, "bubble");
    assert.deepStrictEqual(out.toolPolicies.directories, [
      { path: "/work/proj", policies: { exec: "deny" } },
    ]);
  });

  it("validate() coerces garbage back to defaults", () => {
    for (const bad of [42, "x", [], { global: { read: "yolo" } }]) {
      const out = prefs.validate({ toolPolicies: bad });
      assert.strictEqual(out.toolPolicies.global.read, "bubble");
      assert.deepStrictEqual(out.toolPolicies.directories, []);
    }
  });

  it("getDefaults() never shares toolPolicies references between calls", () => {
    const a = prefs.getDefaults();
    const b = prefs.getDefaults();
    assert.notStrictEqual(a.toolPolicies, b.toolPolicies);
    assert.notStrictEqual(a.toolPolicies.global, b.toolPolicies.global);
  });
});
