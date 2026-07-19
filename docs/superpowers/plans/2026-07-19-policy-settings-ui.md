# 권한 정책 설정 탭 (Plan 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings 창에 "권한 정책(Permission Policy)" 탭을 추가 — 전역 도구 5종 × (자동 허용/버블/자동 거부) 드롭다운 그리드 + 디렉토리 규칙 리스트(경로 선택 다이얼로그, 종류별 오버라이드, 삭제). 저장 즉시 다음 권한 요청부터 반영.

**Architecture:** 기존 탭 패턴(IIFE + `root.ClawdSettingsTabXXX = { init, render }`) 그대로. 읽기는 `state.snapshot.toolPolicies`, 저장은 `settingsAPI.update("toolPolicies", <전체 객체>)` 한 방 — 검증은 main 쪽 validator가 Plan 1의 `normalizeToolPolicies`에 위임. 런타임 반영은 pull 구조(`ctx.getToolPolicies()` → `settingsController.get()`)라 effect 핸들러 불필요.

**Tech Stack:** Electron 41 renderer(vanilla DOM, IIFE 모듈), settings-ipc(IPC), node:test.

## Global Constraints

- 기존 파일 수정 최소: `settings.html`(script 1줄), `settings-renderer.js`(SIDEBAR_TABS 1항목 + init 1줄), `settings-icons.js`(아이콘 1개), `settings-i18n.js`(신규 키만), `settings-actions.js`(validator 1개), `settings-ipc.js`(IPC 핸들러 1개). 신규 파일: `src/settings-tab-permission-policy.js`, 테스트 1개.
- **드롭다운 값**: 전역 그리드 = `allow | bubble | deny`. 디렉토리 규칙의 종류별 값 = `inherit | allow | bubble | deny` (`inherit` = 해당 kind를 policies에서 생략 → 전역으로 폴백. Plan 1 엔진의 "규칙에 kind 없으면 global로" 의미론과 일치).
- **i18n 5개 언어(en, zh, zh-TW, ko, ja) 전부** 추가 — en/ko는 이 계획의 문안 그대로, zh/zh-TW/ja는 같은 의미로 번역.
- 저장은 항상 **전체 toolPolicies 객체**를 update — 부분 패치 금지(정규화가 전체 구조를 재구성하므로).
- fail-safe: validator는 오류 시 저장 거부가 아니라 **정규화된 값으로 교정 저장** (Plan 1 `normalizeToolPolicies`가 이미 그 계약).
- 코드 주석 영어, 커밋 메시지 한국어 `<tag>: <요약>`. NEVER `git push`.
- 전체 스위트 베이스라인: 5461 pass / 0 fail / 18 skip — 신규 실패 0 유지.
- UI 코드 블록은 **참조 구현**: 인접 탭(settings-tab-shortcuts.js·settings-tab-telegram-approval.js)과 settings-ui-core.js의 실제 헬퍼 시그니처(t() 접근, state.snapshot, settingsAPI 이름)를 확인해 기계적으로 맞추는 것은 허용·권장. 단 UI 구조(그리드/리스트/버튼 구성)와 저장 계약(전체 객체 update)은 불변.

---

### Task 1: main 쪽 배선 — validator + 디렉토리 선택 IPC

**Files:**
- Modify: `src/settings-actions.js` (updateRegistry에 `toolPolicies` validator — 기존 `tgApproval` validator 근처)
- Modify: `src/settings-ipc.js` (`settings:pick-directory` 핸들러 — 기존 `settings:pick-sound-file`(:207 부근) 패턴 미러)
- Test: `test/settings-actions-tool-policies.test.js`

**Interfaces:**
- Consumes: Plan 1 `normalizeToolPolicies(raw)` (`src/permission-policy.js`).
- Produces: `settingsAPI.update("toolPolicies", obj)`가 정규화 후 커밋되는 경로(Task 2가 의존), `settings:pick-directory` IPC → `{ status: "ok", path } | { status: "cancel" } | { status: "error", message }` (Task 2가 의존).

- [ ] **Step 1: 실패하는 테스트 작성** — validator가 updateRegistry에 존재하고, 임의 입력을 정규화된 전체 구조로 교정하는지. 먼저 `settings-actions.js`에서 기존 validator의 **실제 반환 계약**(예: `tgApproval`이 `{status,...}`를 반환하는지, 값 교정을 어떻게 전달하는지)을 확인하고, 그 계약에 맞춰 테스트를 작성한다 (인접 `test/settings-actions*.test.js`가 있으면 그 스타일을 따른다). 최소 3케이스: ① 유효 입력 통과 ② garbage → 전 종류 bubble 기본값으로 교정 ③ 디렉토리 규칙 경로 정규화(`~` 확장) 확인.
- [ ] **Step 2: 실패 확인** — `node --test test/settings-actions-tool-policies.test.js` → validator 부재로 FAIL.
- [ ] **Step 3: 구현** — validator는 `normalizeToolPolicies` 위임 한 줄이 본체:

```js
// settings-actions.js updateRegistry 안, tgApproval 근처. 실제 반환 계약에 맞춰 조정.
toolPolicies(value) {
  // Coerce instead of reject: normalizeToolPolicies always yields a valid
  // full structure (fail-safe contract from permission-policy.js).
  return { status: "ok", value: normalizeToolPolicies(value) };
},
```

`settings-ipc.js`에 (pick-sound-file 핸들러를 앵커로 바로 아래):

```js
handle("settings:pick-directory", async (event) => {
  const parent = getDialogParent(event);
  try {
    const result = await dialog.showOpenDialog(parent, {
      title: "Choose a directory",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return { status: "cancel" };
    return { status: "ok", path: result.filePaths[0] };
  } catch (err) {
    return { status: "error", message: err && err.message ? err.message : String(err) };
  }
});
```

(require 추가: `settings-actions.js`에 `const { normalizeToolPolicies } = require("./permission-policy");` — 기존 require 블록 스타일에 맞춰.)
- [ ] **Step 4: 통과 확인** — 신규 테스트 PASS + `node --test $(ls test/settings-actions*.test.js)` 회귀 없음.
- [ ] **Step 5: 커밋** — `feat: toolPolicies 설정 validator + 디렉토리 선택 IPC 추가`

---

### Task 2: 권한 정책 탭 UI + 등록 + i18n

**Files:**
- Create: `src/settings-tab-permission-policy.js`
- Modify: `src/settings.html` (script 태그 1줄, settings-icons.js 위), `src/settings-renderer.js` (SIDEBAR_TABS 항목 + init 호출 — :8-18/:84-96 부근), `src/settings-icons.js` (`"permission-policy"` 키 SVG — 방패/자물쇠 계열 단색 SVG), `src/settings-i18n.js` (아래 키 5개 언어)
- Test: 자동 UI 테스트 없음(기존 탭들도 없음) — Step 4 수동 검증으로 대체. 단 탭 모듈이 `settings.html`에 등록됐는지 확인하는 기존 스타일 테스트(`test/bubble-html-assets.test.js` 유사)가 있으면 1케이스 추가.

**Interfaces:**
- Consumes: Task 1의 validator·IPC, `state.snapshot.toolPolicies`, `settingsAPI.update`, i18n `t()`.
- Produces: 사용자-facing 탭. Plan 2b(버블 ▾·HUD)와 독립.

- [ ] **Step 1: i18n 키 추가** (en/ko 문안 확정, zh·zh-TW·ja 번역):

```js
// en
sidebarPermissionPolicy: "Permission Policy",
permissionPolicyTitle: "Permission Policy",
permissionPolicySubtitle: "Decide per tool kind whether agent permission requests are auto-allowed, shown as a bubble, or auto-denied.",
permissionPolicyGlobalSection: "Global policy",
permissionPolicyDirSection: "Directory rules",
permissionPolicyDirDesc: "Rules for requests whose working directory is under the path. Longest matching path wins; kinds set to Inherit fall back to the global policy.",
permissionPolicyAddRule: "+ Add rule",
permissionPolicyRemoveRule: "Remove",
permissionPolicyKindRead: "Read",
permissionPolicyKindEdit: "Edit / Write",
permissionPolicyKindExec: "Shell / Exec",
permissionPolicyKindNetwork: "Network",
permissionPolicyKindOther: "Other tools",
permissionPolicyActionAllow: "Auto-allow",
permissionPolicyActionBubble: "Bubble",
permissionPolicyActionDeny: "Auto-deny",
permissionPolicyActionInherit: "Inherit",
// ko
sidebarPermissionPolicy: "권한 정책",
permissionPolicyTitle: "권한 정책",
permissionPolicySubtitle: "도구 종류별로 에이전트 권한 요청을 자동 허용할지, 버블로 물어볼지, 자동 거부할지 정합니다.",
permissionPolicyGlobalSection: "전역 정책",
permissionPolicyDirSection: "디렉토리 규칙",
permissionPolicyDirDesc: "작업 디렉토리가 경로 아래인 요청에 적용됩니다. 가장 긴 경로가 우선하며, '상속'은 전역 정책을 따릅니다.",
permissionPolicyAddRule: "+ 규칙 추가",
permissionPolicyRemoveRule: "삭제",
permissionPolicyKindRead: "읽기",
permissionPolicyKindEdit: "편집/쓰기",
permissionPolicyKindExec: "셸/실행",
permissionPolicyKindNetwork: "네트워크",
permissionPolicyKindOther: "기타 도구",
permissionPolicyActionAllow: "자동 허용",
permissionPolicyActionBubble: "버블 표시",
permissionPolicyActionDeny: "자동 거부",
permissionPolicyActionInherit: "상속",
```

- [ ] **Step 2: 탭 모듈 참조 구현** — 인접 탭의 실제 skeleton(IIFE, init/render 시그니처, t() 획득 방식)에 맞춰 기계적 조정 허용:

```js
"use strict";
// Permission Policy tab: global per-kind grid + directory rules list.
// Reads state.snapshot.toolPolicies; every mutation saves the WHOLE object
// via settingsAPI.update("toolPolicies", next) — main-side validator
// normalizes, and the permission chokepoint pulls fresh values per request.
(function (root) {
  const KINDS = ["read", "edit", "exec", "network", "other"];
  const ACTIONS = ["allow", "bubble", "deny"];
  let core = null;

  function t(key) { return core && core.t ? core.t(key) : key; }
  function snapshotPolicies() {
    const s = core && core.state && core.state.snapshot;
    const p = (s && s.toolPolicies) || {};
    return {
      global: Object.assign({ read: "bubble", edit: "bubble", exec: "bubble", network: "bubble", other: "bubble" }, p.global || {}),
      directories: Array.isArray(p.directories) ? p.directories.map((d) => ({ path: d.path, policies: Object.assign({}, d.policies) })) : [],
    };
  }
  function save(next) { core.settingsAPI.update("toolPolicies", next); }

  function kindLabel(kind) { return t("permissionPolicyKind" + kind[0].toUpperCase() + kind.slice(1)); }
  function actionSelect(current, includeInherit, onChange) {
    const sel = document.createElement("select");
    const opts = includeInherit ? ["inherit"].concat(ACTIONS) : ACTIONS;
    for (const a of opts) {
      const o = document.createElement("option");
      o.value = a;
      o.textContent = t("permissionPolicyAction" + a[0].toUpperCase() + a.slice(1));
      sel.appendChild(o);
    }
    sel.value = current;
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }

  function render(parent) {
    const pol = snapshotPolicies();
    // — Global grid: one .row per kind —
    const globalSection = document.createElement("div");
    globalSection.className = "section-rows";
    for (const kind of KINDS) {
      const row = document.createElement("div");
      row.className = "row";
      const text = document.createElement("div");
      text.className = "row-text";
      const label = document.createElement("span");
      label.className = "row-label";
      label.textContent = kindLabel(kind);
      text.appendChild(label);
      const control = document.createElement("div");
      control.className = "row-control";
      control.appendChild(actionSelect(pol.global[kind], false, (v) => {
        const next = snapshotPolicies();
        next.global[kind] = v;
        save(next);
      }));
      row.appendChild(text); row.appendChild(control);
      globalSection.appendChild(row);
    }
    // — Directory rules —
    const dirSection = document.createElement("div");
    dirSection.className = "section-rows";
    pol.directories.forEach((rule, idx) => {
      const item = document.createElement("div");
      item.className = "bubble-policy-item";
      const pathEl = document.createElement("div");
      pathEl.className = "row-label";
      pathEl.textContent = rule.path;
      item.appendChild(pathEl);
      const grid = document.createElement("div");
      grid.className = "bubble-policy-list";
      for (const kind of KINDS) {
        const cell = document.createElement("label");
        cell.textContent = kindLabel(kind) + " ";
        cell.appendChild(actionSelect(rule.policies[kind] || "inherit", true, (v) => {
          const next = snapshotPolicies();
          if (v === "inherit") delete next.directories[idx].policies[kind];
          else next.directories[idx].policies[kind] = v;
          save(next);
        }));
        grid.appendChild(cell);
      }
      item.appendChild(grid);
      const rm = document.createElement("button");
      rm.className = "soft-btn";
      rm.textContent = t("permissionPolicyRemoveRule");
      rm.addEventListener("click", () => {
        const next = snapshotPolicies();
        next.directories.splice(idx, 1);
        save(next);
      });
      item.appendChild(rm);
      dirSection.appendChild(item);
    });
    const add = document.createElement("button");
    add.className = "soft-btn accent";
    add.textContent = t("permissionPolicyAddRule");
    add.addEventListener("click", () => {
      core.settingsAPI.command("settings:pick-directory", {}).then((r) => {
        if (!r || r.status !== "ok") return;
        const next = snapshotPolicies();
        next.directories.push({ path: r.path, policies: {} });
        save(next);
      });
    });
    // — assemble with section headers (permissionPolicyTitle/Subtitle/…Section) —
    parent.appendChild(/* header + globalSection + dirSection + add — 인접 탭의 섹션 헤더 헬퍼 사용 */ globalSection);
    parent.appendChild(dirSection);
    parent.appendChild(add);
  }

  root.ClawdSettingsTabPermissionPolicy = {
    init(c) { core = c; },
    render(parent) { render(parent); },
  };
})(typeof window !== "undefined" ? window : globalThis);
```

핵심 계약(불변): 저장은 전체 객체, `inherit`=키 삭제, 스냅샷 재렌더는 core의 기존 갱신 흐름(다른 탭이 하는 방식)을 따른다. `settingsAPI.command` 이름·`core.t`·헤더 헬퍼는 실제 core API로 조정.

- [ ] **Step 3: 등록** — settings.html script 태그, settings-renderer.js `{ id: "permission-policy", labelKey: "sidebarPermissionPolicy", available: true }` + init 호출, settings-icons.js SVG.
- [ ] **Step 4: 수동 검증 (필수)** — `npm start` → 트레이 → Settings → "권한 정책" 탭: ① 전역 read를 `자동 허용`→`버블`로 바꾼 뒤 **재시작 없이** cwd 밖 Read 시나리오에서 버블이 뜨는지(정책 즉시 반영) ② 다시 `자동 허용`으로 → `tool-policy allow` 로그 ③ `+ 규칙 추가`로 폴더 선택 → prefs 파일에 정규화된 경로로 저장되는지 ④ 규칙 삭제 동작 ⑤ 언어 ko/en 전환 시 문구. 결과를 보고서에 기록.
- [ ] **Step 5: 전체 회귀** — `npm test` → 베이스라인(5461/0/18) 대비 신규 실패 0.
- [ ] **Step 6: 커밋** — `feat: 권한 정책 설정 탭 추가 (전역 그리드 + 디렉토리 규칙)`

---

## Self-Review 결과

- **Spec coverage**: 스펙 패치 ④ 중 "전역 1뎁스 그리드 + 디렉토리 2뎁스 리스트" 충족. 버블 ▾·HUD 뱃지·세션 오버라이드는 Plan 2b(스펙에 명시된 분할). Plan 1 이관 항목(정규화 memoize, remote-only 경로)은 이 계획 범위 밖 — Plan 2b 또는 별도.
- **Placeholder scan**: Task 2 Step 2는 "참조 구현 + 실제 core API로 기계적 조정"을 Global Constraints에서 명시적으로 허용한 구조 — 조정 범위(시그니처·헬퍼명)와 불변 범위(UI 구조·저장 계약)를 구분해 명시함.
- **Type consistency**: 저장 계약 `update("toolPolicies", {global, directories})`는 Task 1 validator 입력과 일치, `inherit`=키 생략은 Plan 1 엔진의 폴백 의미론과 일치.
