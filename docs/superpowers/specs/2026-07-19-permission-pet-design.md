# 만능 권한 펫 — clawd-on-desk 얇은 포크 설계

**작성일**: 2026-07-19
**작성자**: 조재영 (+ Claude)
**상태**: 승인됨 (구현 계획 대기)

## 배경과 목표

Claude Code·Codex 등 여러 AI CLI를 동시에 돌릴 때 권한 요청을 놓치지 않고,
그 자리에서 허용/거부하고, 어느 세션(특히 Orca 워크트리)의 요청인지 즉시 알 수 있는
데스크탑 펫을 만든다. 처음부터 만들지 않고 [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk)
(AGPL-3.0, Electron)를 얇게 포크한다 — 권한 버블·멀티 에이전트 훅·테마 시스템이 이미 있으므로
부족한 부분만 패치한다.

**요구사항 대비 clawd 현황:**

| 요구사항 | clawd 현황 | 작업 |
|---|---|---|
| 권한 버블 허용/거부 + 다중 요청 큐 | ✅ 있음 (스택 레이아웃, Ctrl+Shift+Y/N) | 없음 |
| Codex 등 멀티 에이전트 알림 | ✅ 있음 (Claude Code·Codex·opencode 등 HTTP 훅) | 없음 |
| 도구별 권한 정책 (세션/디렉토리/전역) | ❌ 없음 (하드코딩 Task* 통과만) | **패치 ①** |
| macOS 알림센터 + 사운드 | ❌ 알림센터 없음 (커스텀 사운드만) | **패치 ②** |
| Orca 세션 명시 | ⚠️ cwd 폴더명 + 세션ID 3자만 | **패치 ③** |
| 정책 설정 UI (뎁스 얕게) | ❌ 없음 | **패치 ④** |
| 나만의 캐릭터 | ✅ 테마 시스템 (코드 수정 불필요) | **콘텐츠 ⑤** |

## 저장소 전략

- git 히스토리 유지. `~/SoftwareMaestro/pet/`에 클론 완료, 리모트 구성:
  - `upstream` = rullerzhou-afk/clawd-on-desk (주기적 머지로 업데이트 수용)
  - `origin` = 재영님 GitHub 새 저장소 (GitHub Fork 버튼 미사용 → private 가능)
- 커스텀 커밋은 `main`에 쌓는다. upstream 머지 비용을 낮추기 위해 **기존 파일 수정은
  최소화하고 신규 모듈 파일로 격리**한다.
- **AGPL-3.0 의무**: LICENSE·NOTICE.md·원저작자 표기 유지. 공개 배포 시 파생물도 AGPL-3.0.
- 멘토링 폴더의 기존 클론(`멘토링/clawd-on-desk`)은 참고용으로 그대로 둔다.

## 패치 ① — 권한 정책 엔진 (`src/permission-policy.js` 신규)

### 도구 정규화

에이전트마다 도구명이 다르므로 (Claude Code `Read`/`Bash`, Codex `read_file`/`bash_command`,
opencode `open_file`/`run_shell_command`) 공통 종류로 매핑한다:

- 종류: `read` / `edit` / `exec` / `network` / `other` 5가지
- 에이전트별 매핑 테이블 (예: `Read`·`read_file`·`open_file` → `read`)
- 매핑에 없는 도구는 `other`

### 정책 값과 해석 순서

정책 값: `자동 허용` / `버블 표시` / `자동 거부`. 기본값은 **버블 표시**
(자동 허용은 사용자가 명시적으로 켠 것만 — 하드코딩 디폴트 없음).

해석 순서 (구체적인 것이 이김):

1. **세션별 오버라이드** — 메모리에만 존재, 세션 종료 시 소멸
2. **디렉토리 규칙** — 요청 `cwd`와 규칙 경로의 최장 접두사 매칭
3. **전역 정책**
4. 기본값 (버블 표시)

### 끼우는 지점

`src/server-route-permission.js`의 버블 생성 직전(기존 `PASSTHROUGH_TOOLS` 검사 지점,
line 615 근처) 한 곳에서 정책 평가:

- `자동 허용` → 기존 `sendPermissionResponse(res, "allow")` 경로 재사용
- `자동 거부` → deny 응답
- `버블 표시` → 기존 흐름 그대로

### 안전 원칙 (fail-safe)

정책 평가 중 오류, `cwd` 부재, 알 수 없는 도구/에이전트 → **무조건 버블로 폴백**.
어떤 오류 경로에서도 자동 허용이 발생하지 않는다.

### 영속화

- 전역·디렉토리 규칙: 기존 `clawd-prefs.json` 스키마(`src/prefs.js`) 확장
  — `toolPolicies: { global: {read: "...", ...}, directories: [{path, policies}] }`
- 세션 오버라이드: 저장하지 않음 (메모리 전용)

## 패치 ② — macOS 알림센터 + 사운드

- 버블 생성 시 Electron `Notification` 발송
  - 제목: `[에이전트] 세션 라벨` / 본문: 도구 종류 + 요청 요약
  - 클릭 시 clawd 창 포커스
- 사운드는 기존 `playSound` 경로(10초 쿨다운 포함) 재사용, 권한 요청 전용 사운드 키 추가
- 설정에서 알림센터/사운드 각각 on/off
- **자동 허용/거부된 요청은 알림·사운드 없이 조용히 처리**

## 패치 ③ — Orca 세션 라벨

- 권한 요청의 `cwd`가 Orca 워크트리 경로 아래면 `orca` CLI로 워크트리/카드 이름 조회
  (TTL 캐시로 호출 최소화)
- 버블 헤더·HUD 세션 행에 표시 — 예: `codex · orca:league-batch-3`
- Orca 미설치·조회 실패 시 기존 폴더명 + 세션ID 폴백

## 패치 ④ — 설정/버블/HUD UI

뎁스 원칙: 전역·세션은 0~1클릭, 디렉토리 규칙만 2뎁스 허용.

- **전역** (1뎁스): Settings → "권한 정책" 패널 — 도구 종류 5행 × 정책 드롭다운 그리드 한 화면
- **디렉토리 규칙** (2뎁스): 같은 패널 하단 리스트 — `[경로] [도구별 미니 그리드] [삭제]`,
  "+ 규칙 추가"로 폴더 선택
- **세션별** (0~1뎁스): 권한 버블 허용 버튼 옆 ▾ → `이번만 / 이 세션은 항상 / 전역으로 항상`
- **HUD**: 세션 행에 활성 오버라이드 뱃지 (예: `read✓ exec✗`), 클릭으로 해제

## 콘텐츠 ⑤ — AI 생성 캐릭터 테마

- AI 이미지 생성으로 픽셀 캐릭터 제작 → 상태별 GIF
- 최소 상태 7종: idle·thinking·typing·notification·happy·error·sleeping (나머지는 idle 재사용)
- `themes/<이름>/theme.json` (schemaVersion 1) — 코드와 독립, 병렬 진행 가능
- 사운드 파일도 테마 `sounds` 필드로 함께 정의 가능

## 에러 처리

- 정책 엔진 오류 → 버블 폴백 (위 fail-safe)
- Orca CLI 부재/실패 → 폴더명 폴백
- 알림센터 권한 거부 → 버블·사운드는 정상 동작
- prefs 파일 손상 → 기존 clawd 스키마 검증이 기본값 복원

## 테스트

- 도구 정규화·정책 해석: repo 기존 node 테스트 방식으로 단위 테스트 추가
- e2e: 실제 Claude Code·Codex 세션으로 수동 검증
  - Read 자동 허용 (버블 없이 통과, 로그 확인)
  - Bash 버블 표시 + 알림센터 발송
  - 세션 오버라이드 소멸 (세션 재시작 후)
  - 디렉토리 규칙 우선순위 (phone/ 전용 규칙 vs 전역)

## 구현 순서

1. 포크 + 소스 실행 확인 (`npm install && npm start`)
2. 정책 엔진 + prefs 스키마 + 설정 UI (패치 ①④)
3. macOS 알림센터 + 사운드 (패치 ②)
4. Orca 세션 라벨 (패치 ③)
5. 캐릭터 테마 (콘텐츠 ⑤ — 2~4와 병렬 가능)

## 미결 사항

- 프로젝트 이름 (현재 디렉토리명 `pet`, 가칭)
- origin 저장소 생성 (재영님 GitHub, private 여부 결정)
