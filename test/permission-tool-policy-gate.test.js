"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { __test } = require("../src/permission");
const { shouldToolPolicySkipEntry } = __test;

describe("shouldToolPolicySkipEntry", () => {
  it("skips elicitation, plan-mode, question, and passive entries", () => {
    assert.strictEqual(shouldToolPolicySkipEntry({ isElicitation: true, toolName: "Read" }), true);
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: "ExitPlanMode" }), true);
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: "AskUserQuestion" }), true);
    assert.strictEqual(shouldToolPolicySkipEntry({ isCodexNotify: true, toolName: "Read" }), true);
    assert.strictEqual(shouldToolPolicySkipEntry(null), true);
    // F6: additional passive-notify kinds
    assert.strictEqual(shouldToolPolicySkipEntry({ isCodexUserInputNotify: true, toolName: "Read" }), true);
    assert.strictEqual(shouldToolPolicySkipEntry({ isKimiNotify: true, toolName: "Read" }), true);
  });

  it("skips malformed toolName entries (F2)", () => {
    // non-string
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: null }), true);
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: 42 }), true);
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: undefined }), true);
    // empty string
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: "" }), true);
    // route missing-name fallback
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: "Unknown" }), true);
  });

  it("does not skip ordinary tool entries", () => {
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: "Read", cwd: "/x" }), false);
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: "bash_command" }), false);
    // Named but unregistered tools (resolve to "other" kind — policy still applies)
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: "SomeFutureTool" }), false);
  });
});
