# gromo 구름이 펫 테마 Implementation Plan

> **For agentic workers:** 이 계획은 시각 창작(SVG 아트)이 핵심이라 **인라인 실행**(작성자가 직접 제작 + 앱 육안 확인 루프)을 기본으로 한다. 자동 테스트는 스키마/파싱 정합만 가능하고 캐릭터 품질은 앱에서 눈으로 검증한다. Steps use checkbox (`- [ ]`) syntax.

**Goal:** clawd 기본 게 대신 gromo 마스코트 "구름이"를 SVG 벡터로 재해석한 번들 테마 `themes/gromo-cloud/`를 만들어, Settings에서 선택하면 펫이 구름이로 바뀌고 상태별(idle 아이트래킹 포함) 애니메이션이 동작하게 한다.

**Architecture:** 모든 상태 SVG가 공유하는 구름 몸통 실루엣 + 색 토큰을 한 번 정하고, 상태별로 얼굴/팔/소품/애니메이션만 바꿔 7개 `.svg` 파일을 만든다. `idle-follow.svg`만 아이트래킹용 필수 id를 갖는다. `theme.json`은 clawd template/calico 규격을 따른다. 코드 변경은 없다(테마 로더가 `themes/` 폴더를 자동 인식).

**Tech Stack:** SVG(+ 내부 CSS `@keyframes` 애니메이션), Electron/Chromium 렌더, clawd theme.json schemaVersion 1, node:test(스키마/파싱 검증).

## Global Constraints

- **캐릭터 정체성**(스펙): 뭉게구름 흰 몸통 + 굵은 검은 눈썹 + 검은 점 눈 + 분홍 볼터치 + 검은 짧은 팔 + 보라 책(+금 책갈피). 원본은 `phone/assets/app-icons/app-logo-*.png`.
- **색 토큰**(전 파일 통일): 구름 `#F8F8FB`, 먹색(눈썹·눈·팔) `#2B2B33`, 볼터치 `#F4A9B8`, gromo 보라 `#7C6FD6`, 책갈피 금 `#E9C46A`.
- **전 상태 SVG**(clawd가 SVG 상태 지원). idle은 아이트래킹 때문에 SVG 필수.
- **아이트래킹 계약**: `idle-follow.svg`는 `id="eyes-js"`, `id="body-js"`, `id="shadow-js"`를 반드시 포함(런타임이 이 id로 커서 추적 변환).
- **viewBox 통일**: 모든 에셋 동일 viewBox·종횡비. 이 계획은 `viewBox="0 0 220 200"` 사용.
- **번들 테마**: `themes/gromo-cloud/`에 커밋. 기본 clawd 게는 유지. 코드 수정 없음.
- **커밋 메시지 한국어** `<tag>: <요약>`, SVG 내부 주석은 최소. NEVER `git push`(작성자가 별도 승인 후).
- **검증 베이스라인**: `npm test` 5468 pass / 0 fail / 18 skip — 신규 테스트만큼만 증가, 회귀 0.
- **제작 방식**: 작성자가 SVG를 직접 코드로 작성. 공유 구름 실루엣 `<path>` 좌표를 정한 뒤 모든 상태가 재사용.

---

### Task 1: 공유 구름 베이스 + idle-follow.svg + theme.json 골격 (테마 로드 가능 상태)

이 태스크의 완결 산출물: 앱 Settings에서 "gromo 구름이"를 선택하면 펫이 구름이 idle로 바뀌고 커서를 따라 눈이 움직인다.

**Files:**
- Create: `themes/gromo-cloud/theme.json`
- Create: `themes/gromo-cloud/assets/idle-follow.svg`
- Test: `test/theme-gromo-cloud.test.js`

**Interfaces:**
- Produces: 공유 구름 실루엣 `<path d="...">`(모든 상태 재사용할 좌표), 색 토큰, viewBox `0 0 220 200`, 구름 중심/baseline 좌표 — Task 2가 재사용.

- [ ] **Step 1: 구름 실루엣·레이아웃 좌표 확정**

`viewBox="0 0 220 200"`. 구름 몸통 중심 대략 (110,95), 폭 ~150, 높이 ~110. 뭉게구름은 큰 원 5~6개를 겹친 `<path>`(부드러운 베지어) 또는 원 그룹. baseline(그림자) y≈165. 이 좌표를 주석 없이 실제 path로 확정하고 이후 전 상태가 동일 실루엣 사용.

- [ ] **Step 2: 검증 테스트 작성 (RED)**

`test/theme-gromo-cloud.test.js`:

```js
"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const THEME_DIR = path.join(__dirname, "..", "themes", "gromo-cloud");
const ASSETS = path.join(THEME_DIR, "assets");

function readTheme() {
  return JSON.parse(fs.readFileSync(path.join(THEME_DIR, "theme.json"), "utf8"));
}

describe("gromo-cloud theme.json", () => {
  it("has schemaVersion 1 and required meta", () => {
    const t = readTheme();
    assert.strictEqual(t.schemaVersion, 1);
    assert.ok(t.name && t.viewBox && t.states && t.eyeTracking);
  });
  it("declares idle state pointing at an existing SVG file", () => {
    const t = readTheme();
    const idle = Array.isArray(t.states.idle) ? t.states.idle[0] : t.states.idle.files[0];
    assert.ok(idle.endsWith(".svg"));
    assert.ok(fs.existsSync(path.join(ASSETS, idle)), `missing ${idle}`);
  });
  it("eyeTracking targets idle and references ids present in idle-follow.svg", () => {
    const t = readTheme();
    assert.deepStrictEqual(t.eyeTracking.states, ["idle"]);
    const svg = fs.readFileSync(path.join(ASSETS, "idle-follow.svg"), "utf8");
    assert.match(svg, /id="eyes-js"/);
    assert.match(svg, /id="body-js"/);
    assert.match(svg, /id="shadow-js"/);
  });
});

describe("gromo-cloud SVG assets parse as XML", () => {
  it("every .svg in assets is well-formed and shares the viewBox", () => {
    const t = readTheme();
    const vb = `${t.viewBox.x} ${t.viewBox.y} ${t.viewBox.width} ${t.viewBox.height}`;
    for (const f of fs.readdirSync(ASSETS).filter((n) => n.endsWith(".svg"))) {
      const svg = fs.readFileSync(path.join(ASSETS, f), "utf8");
      assert.match(svg, /<svg[\s>]/, `${f} not an svg`);
      assert.ok(svg.trim().endsWith("</svg>"), `${f} truncated`);
      assert.ok(svg.includes(vb) || svg.includes(`viewBox="${vb}"`), `${f} viewBox mismatch`);
    }
  });
});
```

- [ ] **Step 3: 실패 확인** — `node --test test/theme-gromo-cloud.test.js` → 파일 없음으로 FAIL.

- [ ] **Step 4: idle-follow.svg 작성**

`viewBox="0 0 220 200"`. 구조:
- `<ellipse id="shadow-js" cx="110" cy="168" rx="60" ry="9" fill="#2B2B33" opacity="0.12"/>`
- `<g id="body-js">`: 구름 실루엣 path(radial gradient 흰색), 볼터치 2개, 굵은 눈썹 2개, 팔 2개(무릎에 보라 책 얹은 정면 포즈)
- `<g id="eyes-js">`: 검은 점 눈 2개(+ 흰 하이라이트)
- 숨쉬기 애니메이션은 idle에서 과하지 않게(아이트래킹이 주). `<style>`에 `#body-js{animation:breathe 4s ease-in-out infinite}` 미세 scale.
- eyes/body는 아이트래킹 런타임이 transform을 덮어쓰므로, 눈 자체 애니는 넣지 않음(깜빡임은 optional, 넣으면 opacity만).

- [ ] **Step 5: theme.json 작성**

```json
{
  "schemaVersion": 1,
  "name": "gromo 구름이",
  "author": "조재영",
  "version": "1.0.0",
  "description": "gromo 마스코트 구름이 — SVG 벡터 데스크 펫",
  "viewBox": { "x": 0, "y": 0, "width": 220, "height": 200 },
  "layout": {
    "contentBox": { "x": 30, "y": 30, "width": 160, "height": 130 },
    "centerX": 110, "baselineY": 165,
    "visibleHeightRatio": 0.55, "baselineBottomRatio": 0.05
  },
  "eyeTracking": {
    "enabled": true, "states": ["idle"],
    "eyeRatioX": 0.5, "eyeRatioY": 0.45, "maxOffset": 10,
    "bodyScale": 0.3, "shadowStretch": 0.15, "shadowShift": 0.3,
    "ids": { "eyes": "eyes-js", "body": "body-js", "shadow": "shadow-js" },
    "shadowOrigin": "110px 168px"
  },
  "states": {
    "idle": ["idle-follow.svg"],
    "thinking": ["thinking.svg"],
    "working": ["working.svg"],
    "attention": ["happy.svg"],
    "notification": ["notification.svg"],
    "error": { "fallbackTo": "attention" },
    "sleeping": ["sleeping.svg"],
    "waking": ["waking.svg"]
  },
  "sleepSequence": { "mode": "direct" }
}
```

주의: `states`가 아직 없는 파일(thinking 등)을 가리키므로, **Task 1 커밋 시점에는 idle 외 상태 파일이 없어** 앱에서 그 상태가 뜨면 로더가 idle로 degrade한다(fallback). Task 1의 XML 파싱 테스트는 존재하는 SVG만 순회하므로 통과. Task 2에서 나머지를 채운다.

- [ ] **Step 6: 통과 확인** — `node --test test/theme-gromo-cloud.test.js` PASS + `npm test`로 회귀 0.

- [ ] **Step 7: 앱 육안 검증** — `npm start`(워크트리) 재시작 → Settings → 테마 → "gromo 구름이" 선택 → 펫이 구름이 idle로 바뀌고 마우스 따라 눈 이동 확인. 안 맞으면 SVG 좌표/색 조정 후 재확인.

- [ ] **Step 8: 커밋** — `feat: gromo 구름이 테마 골격 + idle 아이트래킹 상태`

---

### Task 2: 나머지 상태 SVG 6종

**Files:**
- Create: `themes/gromo-cloud/assets/thinking.svg`, `working.svg`, `happy.svg`, `notification.svg`, `sleeping.svg`, `waking.svg`

**Interfaces:**
- Consumes: Task 1의 공유 구름 실루엣 path·색 토큰·viewBox. 각 상태는 이 몸통을 복사하고 얼굴/팔/소품/애니만 교체.

각 파일 공통: `viewBox="0 0 220 200"`, Task 1과 동일 구름 실루엣·그림자. 애니메이션은 `<style>` 내부 `@keyframes`(CSS). 아이트래킹 id는 **불필요**(idle 전용).

- [ ] **Step 1: thinking.svg** — 눈썹을 안쪽으로 모아 골똘, 시선 아래(책), 머리 위 물음표(`?`) opacity 점멸(`@keyframes blink`), 몸통 느린 숨쉬기.
- [ ] **Step 2: working.svg** — 보라 책을 들고 책장 넘기는 느낌(책 페이지 `<path>` skewY 왕복 애니), 팔 미세 상하, 집중 눈썹.
- [ ] **Step 3: happy.svg** (attention) — 통통 튐(`@keyframes hop` translateY 왕복), 눈 반달(호선), 볼터치 진하게, 머리 위 반짝 `sparkle`(scale+opacity), 책 살짝 듦.
- [ ] **Step 4: notification.svg** — 머리 위 느낌표(`!`) 뿅(scale in), 몸통 좌우 살짝 흔들(`@keyframes wiggle` rotate ±3°), 눈 크게.
- [ ] **Step 5: sleeping.svg** — 눈 감음(호선 아래로), 책 덮어 무릎에, 머리 위 `zzz` 위로 흘러가며 페이드(`@keyframes drift`), 아주 느린 호흡.
- [ ] **Step 6: waking.svg** — 몸통 기지개(scaleY 1→1.08→1), 눈 반쯤 뜸, 짧게 1회성 흐름이지만 SVG는 loop이므로 은은한 반복.
- [ ] **Step 7: 파싱·회귀 확인** — `node --test test/theme-gromo-cloud.test.js`(이제 7개 SVG 전부 viewBox 검사 통과) + `npm test` 회귀 0.
- [ ] **Step 8: 앱 육안 검증** — 각 상태 확인:
  - notification: 실제로 아무 세션에서 권한 요청 유발(예: cwd 밖 Read를 정책 bubble로 두고) → 구름이 느낌표
  - working/thinking: 에이전트 작업 중 관찰
  - happy: 작업 완료 시
  - sleeping/waking: 60초 유휴 후 → 마우스 움직여 깨우기
  - 애매하면 clawd의 상태 강제 수단(트레이/디버그가 있으면 사용, 없으면 자연 발생 관찰)
- [ ] **Step 9: 커밋** — `feat: gromo 구름이 나머지 상태 6종 SVG`

---

### Task 3: 마감 검증 + 문서

**Files:**
- Modify: `themes/gromo-cloud/theme.json`(필요 시 미세 조정), 없으면 문서만
- Create: `themes/gromo-cloud/README.md`(짧게 — 출처·재해석·라이선스 주의)

- [ ] **Step 1: 스키마 교차 검증** — 저장소의 `src/theme-schema.js`로 gromo theme.json을 검증하는 일회성 확인(`node -e`로 loadThemeSchema/validate 호출; 함수명은 theme-schema.js에서 확인). 실패 필드 있으면 수정.
- [ ] **Step 2: 라이선스/출처 README** — 구름이는 gromo(재영님 소유) 마스코트의 SVG 재해석임을 명시. clawd는 AGPL-3.0이나 이 테마 에셋은 재영님 저작. 한 문단.
- [ ] **Step 3: 전체 회귀** — `npm test` 최종.
- [ ] **Step 4: 커밋** — `docs: gromo 구름이 테마 README + 스키마 검증`

---

## Self-Review 결과

- **Spec coverage**: 캐릭터 디자인(Task1 실루엣+색), 상태 7종(Task1 idle + Task2 6종), 테마 구조/theme.json(Task1), 아이트래킹 계약(Task1 Step4 + 테스트), 검증 방식(각 Task 앱 육안 + Task3 스키마), 에러 처리(error→attention fallback, theme.json), 범위 밖(멀티세션 tier 제외) — 전부 태스크에 매핑됨.
- **Placeholder scan**: SVG 아트는 좌표를 계획에 다 박기 불가하나, 각 상태의 요소·애니·id 요구사항을 구체 명시하고 Task1이 공유 실루엣을 확정하는 구조 — "TBD" 없음. 검증 테스트는 전체 코드 제시.
- **Type consistency**: 아이트래킹 id(`eyes-js`/`body-js`/`shadow-js`)가 스펙·theme.json·idle SVG·테스트에서 일치. viewBox `0 0 220 200`가 전 파일·테스트·theme.json 일치. states 키(idle/thinking/working/attention/notification/error/sleeping/waking)가 theme.json·파일명·Task2와 일치.
