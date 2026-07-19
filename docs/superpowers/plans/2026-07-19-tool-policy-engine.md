# 도구별 권한 정책 엔진 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** clawd-on-desk 포크에 도구 종류별(read/edit/exec/network/other) 권한 정책(자동 허용/버블/자동 거부)을 전역 + 디렉토리 단위로 추가한다. 이 계획만으로 prefs 파일 편집을 통해 동작하는 소프트웨어가 완성된다 (설정 UI·버블 ▾·HUD 뱃지·세션 오버라이드 스토어는 후속 Plan 2).

**Architecture:** 순수 결정 모듈 `src/permission-policy.js`(Electron 무의존, node:test로 단위 테스트) + prefs 스키마 키 `toolPolicies` + `showPermissionBubble` 초크포인트의 얇은 어댑터 1곳. 기존 auto-pilot(`maybeAutoApprovePermission`)과 동일한 패턴·동일한 지점에 끼운다. 모든 에이전트 분기가 이 초크포인트를 통과하므로 에이전트별 라우트는 수정하지 않는다.

**Tech Stack:** Node 24+ (로컬 v26), Electron 41 (기존), node:test + node:assert (기존 테스트 방식), CommonJS.

## Global Constraints

- **업스트림 머지 최소 침습**: 기존 파일 수정은 `src/prefs.js`(스키마 1키 + require 1줄), `src/permission.js`(require 1줄 + 함수 1개 + 호출 1줄), `src/main.js`(ctx 게터 1줄)뿐. 나머지는 신규 파일.
- **fail-safe**: 정책 평가 오류·알 수 없는 도구·cwd 부재·잘못된 설정값 → 반드시 `"bubble"`(버블 표시). 어떤 오류 경로도 자동 허용으로 빠지지 않는다.
- **엘리시테이션 보호**: `isElicitation`·`ExitPlanMode`·`AskUserQuestion`·passive notify 엔트리는 정책 대상에서 제외(항상 버블). 질문은 권한이 아니다.
- **기본값은 전부 `"bubble"`**: 자동 허용/거부는 사용자가 명시적으로 설정한 것만.
- **코드 주석은 영어**(업스트림 스타일 일치), 커밋 메시지는 한국어 `<tag>: <요약>` 형식.
- **AGPL-3.0**: LICENSE·NOTICE.md 유지. 삭제·수정 금지.
- 테스트 실행: 단일 파일 `node --test test/<file>.test.js`, 전체 `npm test`. **전체 스위트는 작업 전 베이스라인 실패 목록을 기록하고, 그 목록이 늘지 않으면 통과로 간주** (upstream 테스트 중 환경 의존 실패가 있을 수 있음).

---

### Task 1: 순수 정책 모듈 `src/permission-policy.js`

**Files:**
- Create: `src/permission-policy.js`
- Test: `test/permission-policy.test.js`

**Interfaces:**
- Consumes: 없음 (Node 내장 `path`, `os`만).
- Produces (Task 2·3과 Plan 2가 의존):
  - `TOOL_KINDS: readonly string[]` — `["read","edit","exec","network","other"]`
  - `POLICY_ACTIONS: readonly string[]` — `["allow","bubble","deny"]`
  - `canonicalToolKind(toolName: string): string` — 도구명 → 종류 (`"other"` 폴백)
  - `cloneDefaultToolPolicies(): {global: Record<kind,action>, directories: []}` — 매 호출 새 객체
  - `normalizeToolPolicies(raw: any, fallback?: object): object` — 임의 입력 → 유효한 전체 구조 (prefs `normalize(value, default)` 시그니처와 호환)
  - `decideToolPolicy(rawPolicies: any, request: {agentId?, toolName?, cwd?, sessionPolicies?}): "allow"|"bubble"|"deny"`

- [ ] **Step 1: 베이스라인 확보**

```bash
cd ~/SoftwareMaestro/pet && npm install
npm test 2>&1 | grep -E "^# (tests|pass|fail)"
npm test 2>&1 | grep "^✖" | sort > /tmp/pet-baseline-failures.txt; wc -l /tmp/pet-baseline-failures.txt
```
Expected: 의존성 설치 완료. 실패 테스트 목록이 `/tmp/pet-baseline-failures.txt`에 저장됨 (0개가 이상적, 환경 의존 실패가 있으면 그 목록이 이후 비교 기준).

- [ ] **Step 2: 실패하는 테스트 작성**

`test/permission-policy.test.js` 전체 내용:

```js
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const os = require("os");

const {
  TOOL_KINDS,
  POLICY_ACTIONS,
  canonicalToolKind,
  cloneDefaultToolPolicies,
  normalizeToolPolicies,
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

  it("missing cwd skips the directory tier", () => {
    const p = policies({
      global: { read: "allow" },
      directories: [{ path: "/work", policies: { read: "deny" } }],
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
```

- [ ] **Step 3: 실패 확인**

Run: `cd ~/SoftwareMaestro/pet && node --test test/permission-policy.test.js`
Expected: FAIL — `Cannot find module '../src/permission-policy'`

- [ ] **Step 4: 구현**

`src/permission-policy.js` 전체 내용:

```js
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
```

- [ ] **Step 5: 통과 확인**

Run: `node --test test/permission-policy.test.js`
Expected: PASS — 전체 테스트 통과 (`# fail 0`)

- [ ] **Step 6: 커밋**

```bash
cd ~/SoftwareMaestro/pet
git add src/permission-policy.js test/permission-policy.test.js
git commit -m "feat: 도구별 권한 정책 순수 결정 모듈 추가"
```

---

### Task 2: prefs 스키마에 `toolPolicies` 키 추가

**Files:**
- Modify: `src/prefs.js` (require 블록 + SCHEMA에 1키)
- Test: `test/prefs-tool-policies.test.js`

**Interfaces:**
- Consumes: Task 1의 `cloneDefaultToolPolicies`, `normalizeToolPolicies`.
- Produces: prefs 스냅샷의 `toolPolicies` 필드 — `_settingsController.get("toolPolicies")`로 접근 가능 (Task 3이 의존). `clawd-prefs.json`에 영속화.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/prefs-tool-policies.test.js` 전체 내용:

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/prefs-tool-policies.test.js`
Expected: FAIL — `getDefaults()` 결과에 `toolPolicies` 없음 (`deepStrictEqual` 불일치 또는 undefined 접근)

- [ ] **Step 3: 구현 — prefs.js 수정 2곳**

수정 1 — require 블록 (기존 `require("./session-alias")` 근처, `src/prefs.js:43` 부근)에 추가:

```js
const {
  cloneDefaultToolPolicies,
  normalizeToolPolicies,
} = require("./permission-policy");
```

수정 2 — SCHEMA 객체에 키 추가. 앵커: `permissionBubblesEnabled: { type: "boolean", default: true },` (`src/prefs.js:163` 부근) 바로 아래에 삽입:

```js
  // Per-tool-kind permission policy: auto-allow / bubble / auto-deny, global +
  // per-directory. Session-level overrides are runtime-only and never persisted.
  // Consumed by permission.js's maybeApplyToolPolicy chokepoint. All-bubble by
  // default — auto actions exist only when the user opts a kind in explicitly.
  toolPolicies: {
    type: "object",
    defaultFactory: cloneDefaultToolPolicies,
    normalize: normalizeToolPolicies,
  },
```

주의: `validate()`는 `field.normalize(value, out[key])`를 호출하고 그 결과에 `isValidValue`를 적용한다 (`src/prefs.js`의 validate 함수). `normalizeToolPolicies`는 항상 plain object를 반환하므로 통과한다. version 마이그레이션은 불필요 — 새 키는 validate()가 기본값으로 채운다.

- [ ] **Step 4: 통과 확인**

Run: `node --test test/prefs-tool-policies.test.js && node --test test/prefs.test.js 2>/dev/null; node --test $(ls test/prefs*.test.js)`
Expected: 신규 테스트 PASS + 기존 prefs 테스트 회귀 없음

- [ ] **Step 5: 커밋**

```bash
git add src/prefs.js test/prefs-tool-policies.test.js
git commit -m "feat: prefs 스키마에 toolPolicies 키 추가 (전역+디렉토리 정책 영속화)"
```

---

### Task 3: `showPermissionBubble` 초크포인트 통합

**Files:**
- Modify: `src/permission.js` (require 1줄 + `maybeApplyToolPolicy` 함수 + 호출 1줄 + `__test` 노출)
- Modify: `src/main.js` (ctx 게터 1줄)
- Test: `test/permission-tool-policy-gate.test.js`

**Interfaces:**
- Consumes: Task 1 `decideToolPolicy`, Task 2 `toolPolicies` prefs 키, 기존 `resolvePermissionEntry(permEntry, behavior, message)` (`src/permission.js:1538`), 기존 `isPassiveNotifyEntry` (이미 permission.js에 require됨, `src/permission.js:19`).
- Produces: `ctx.getToolPolicies(): object` (main.js), `shouldToolPolicySkipEntry(permEntry): boolean` (순수 가드 판정 — `__test`로 노출, Plan 2가 재사용).

- [ ] **Step 1: 실패하는 테스트 작성**

가드 판정(엘리시테이션·ExitPlanMode·AskUserQuestion·passive 제외)은 순수 함수로 분리해 `__test`로 검증한다. `test/permission-tool-policy-gate.test.js` 전체 내용:

```js
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
    assert.strictEqual(shouldToolPolicySkipEntry({ passiveNotify: true, toolName: "Read" }), true);
    assert.strictEqual(shouldToolPolicySkipEntry(null), true);
  });

  it("does not skip ordinary tool entries", () => {
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: "Read", cwd: "/x" }), false);
    assert.strictEqual(shouldToolPolicySkipEntry({ toolName: "bash_command" }), false);
  });
});
```

주의: `isPassiveNotifyEntry`의 실제 판정 필드는 `src/passive-notify-entry.js`(620B)를 열어 확인하고, 위 테스트의 `{ passiveNotify: true }` 픽스처를 그 필드명에 맞춘다 (구현 전 확인 필수 — 테스트 픽스처만 조정, 인터페이스는 불변).

- [ ] **Step 2: 실패 확인**

Run: `node --test test/permission-tool-policy-gate.test.js`
Expected: FAIL — `shouldToolPolicySkipEntry is not a function` (undefined)

- [ ] **Step 3: 구현 — permission.js 수정 4곳**

수정 1 — require 블록 (`src/permission.js:19`의 `passive-notify-entry` require 아래)에 추가:

```js
const { decideToolPolicy } = require("./permission-policy");
```

수정 2 — `maybeAutoApprovePermission` 함수 정의(`src/permission.js:664` 부근) 아래에 추가:

```js
// Per-tool policy chokepoint — same seam as auto-pilot above: every agent
// branch funnels through showPermissionBubble after DND / per-agent /
// headless gates, so applying the user's tool policy here can never approve
// a request those gates meant to drop. Elicitation-style entries are
// questions, not permissions — policy never consumes them.
function shouldToolPolicySkipEntry(permEntry) {
  if (!permEntry) return true;
  if (isPassiveNotifyEntry(permEntry)) return true;
  if (permEntry.isElicitation) return true;
  if (permEntry.toolName === "ExitPlanMode" || permEntry.toolName === "AskUserQuestion") return true;
  return false;
}

function maybeApplyToolPolicy(permEntry) {
  if (shouldToolPolicySkipEntry(permEntry)) return false;
  let decision = "bubble";
  try {
    const policies = typeof ctx.getToolPolicies === "function" ? ctx.getToolPolicies() : null;
    decision = decideToolPolicy(policies, {
      agentId: permEntry.agentId || "claude-code",
      toolName: permEntry.toolName,
      cwd: permEntry.cwd || "",
    });
  } catch (err) {
    permLog(`tool-policy error -> bubble fallback: ${err && err.message}`);
    return false;
  }
  if (decision === "allow") {
    permLog(`tool-policy allow: tool=${permEntry.toolName} session=${permEntry.sessionId} agent=${permEntry.agentId || "claude-code"}`);
    resolvePermissionEntry(permEntry, "allow");
    return true;
  }
  if (decision === "deny") {
    permLog(`tool-policy deny: tool=${permEntry.toolName} session=${permEntry.sessionId} agent=${permEntry.agentId || "claude-code"}`);
    resolvePermissionEntry(permEntry, "deny", "Denied by tool permission policy");
    return true;
  }
  return false;
}
```

수정 3 — `showPermissionBubble`(`src/permission.js:688`)의 auto-pilot 체크 바로 아래에 호출 추가:

```js
function showPermissionBubble(permEntry) {
  // Auto-pilot: if enabled, approve immediately and never render a bubble.
  if (maybeAutoApprovePermission(permEntry)) return;
  // User tool policy: auto-allow / auto-deny per tool kind (global + per-dir).
  if (maybeApplyToolPolicy(permEntry)) return;
```

수정 4 — `module.exports.__test`(`src/permission.js:2502` 부근)에 추가:

```js
  shouldToolPolicySkipEntry,
```

주의: `shouldToolPolicySkipEntry`가 `initPermission(ctx)` 클로저 내부에 정의되면 `__test`로 노출할 수 없다. `isPassiveNotifyEntry`는 모듈 레벨 require이므로, 두 함수 중 `shouldToolPolicySkipEntry`는 **모듈 레벨**(클로저 밖, `initPermission` 위)에 정의하고, ctx가 필요한 `maybeApplyToolPolicy`만 클로저 안에 둔다. `__test`에 실제로 추가되는 것은 모듈 레벨 함수다.

- [ ] **Step 4: main.js ctx 게터 추가**

앵커: `isAutoApproveAllEnabled` 항목 (`src/main.js:1382-1383`) 바로 아래에 추가:

```js
  // Per-tool permission policy snapshot for permission.js's
  // maybeApplyToolPolicy chokepoint (see permission-policy.js).
  getToolPolicies: () => _settingsController.get("toolPolicies"),
```

- [ ] **Step 5: 통과 + 회귀 확인**

```bash
node --test test/permission-tool-policy-gate.test.js
npm test 2>&1 | grep -E "^# (tests|pass|fail)"
npm test 2>&1 | grep "^✖" | sort > /tmp/pet-after-failures.txt
diff /tmp/pet-baseline-failures.txt /tmp/pet-after-failures.txt
```
Expected: 신규 테스트 PASS, diff 출력 없음 (베이스라인 대비 신규 실패 0)

- [ ] **Step 6: 수동 e2e 검증**

```bash
npm start   # 펫 실행
```

1. 펫 트레이 메뉴 → Quit으로 종료 후, prefs 파일에 정책 추가:
   `~/Library/Application Support/Clawd/clawd-prefs.json` (파일이 없으면 앱을 한 번 실행해 생성; 디렉토리명이 다르면 `ls ~/Library/Application\ Support/ | grep -i clawd`로 확인)

```json
"toolPolicies": {
  "global": { "read": "allow", "edit": "bubble", "exec": "bubble", "network": "bubble", "other": "bubble" },
  "directories": []
}
```

2. `npm start`로 재실행 → 아무 프로젝트에서 `claude` 세션 시작 (clawd 훅 설치 상태).
3. Claude Code가 `Read` 권한을 요청하는 작업 → **버블 없이 즉시 진행**되고 로그에 `tool-policy allow: tool=Read` 확인:
   `~/Library/Application Support/Clawd/logs/` 아래 최신 로그에서 `grep "tool-policy"`.
4. `Bash` 권한을 요청하는 작업 → **버블이 정상 표시**됨을 확인.
5. prefs에서 `"read": "bubble"`로 되돌린 뒤 재실행 → Read도 버블이 다시 뜨는지 확인.

Expected: 3·4·5 모두 기대 동작. 하나라도 다르면 systematic-debugging으로 원인 규명 후 수정.

- [ ] **Step 7: 커밋**

```bash
git add src/permission.js src/main.js test/permission-tool-policy-gate.test.js
git commit -m "feat: showPermissionBubble 초크포인트에 도구별 정책 적용 (auto-allow/deny/bubble)"
```

---

## Self-Review 결과

- **Spec coverage**: 이 계획은 스펙의 패치 ① 중 엔진+영속화 부분만 담당한다 (의도된 분할). 설정 UI·버블 ▾·HUD 뱃지·세션 오버라이드 스토어(패치 ④)는 Plan 2, 알림센터(②)는 Plan 3, Orca 라벨(③)은 Plan 4, 테마(⑤)는 Plan 5로 후속 작성. `decideToolPolicy`의 `sessionPolicies` 파라미터가 Plan 2와의 인터페이스 계약이다.
- **Placeholder scan**: 통과 — 모든 코드 스텝에 전체 코드 포함. Task 3 Step 1의 픽스처 필드명 확인은 명시적 확인 지시(인터페이스 불변)로 placeholder 아님.
- **Type consistency**: `decideToolPolicy(rawPolicies, {agentId, toolName, cwd, sessionPolicies})` — Task 1 정의·Task 3 사용 일치. `normalizeToolPolicies(raw, fallback)` — prefs `normalize(value, default)` 시그니처 일치. `resolvePermissionEntry(entry, behavior, message)` — 기존 시그니처(`src/permission.js:1538`) 일치.
