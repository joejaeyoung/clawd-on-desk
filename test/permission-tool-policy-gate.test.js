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
  });

  it("does not skip ordinary tool entries", () => {
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: "Read", cwd: "/x" }), false);
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: "bash_command" }), false);
  });
});
