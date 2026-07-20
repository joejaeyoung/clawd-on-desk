# gromo 구름이 펫 테마 설계

**작성일**: 2026-07-20
**작성자**: 조재영 (+ Claude)
**상태**: 승인됨 (구현 계획 대기)

## 배경과 목표

clawd 기본 캐릭터(픽셀 게)를 재영님 프로젝트 gromo의 마스코트 "구름이"로 교체해
"내 펫" 정체성을 준다. gromo는 집중시간 관리 앱이라 마스코트는 **책 읽는 구름**이다
(원본: `phone/assets/app-icons/app-logo-*.png` — 흰 뭉게구름 몸통, 굵은 검은 눈썹,
점 눈, 분홍 볼터치, 검은 짧은 팔, 보라색 책+금색 책갈피, 3D 렌더 스타일).

이미지 생성 도구가 없으므로 **SVG 벡터로 코드 제작**한다. 원본 3D 렌더를 100% 재현하는
대신 정체성 요소(구름 실루엣·눈썹·점눈·볼터치·팔·보라 책)를 살린 플랫 벡터 + 부드러운
그라데이션으로 재해석한다. clawd는 상태 파일로 SVG를 지원하고, idle 아이트래킹은 SVG가
필수라 궁합이 좋다.

## 캐릭터 디자인

- **몸통**: 뭉게구름 실루엣(둥근 돌기 여러 개). 흰색~연회색 방사형 그라데이션으로 볼륨.
- **얼굴**: 굵은 검은 눈썹(표정의 핵심), 검은 점 눈(아이트래킹 대상), 분홍 볼터치 2개.
- **팔**: 검은색 짧은 팔 2개. 상태에 따라 책을 들거나 무릎에 얹거나 만세.
- **소품**: 보라색 책(#7C6FD6 계열) + 금색 책갈피. 집중/공부 정체성.
- **스타일 토큰**: gromo 보라(#7C6FD6)를 액센트로, 구름 흰색(#F8F8FB), 볼터치 분홍(#F4A9B8),
  눈썹·팔·눈 먹색(#2B2B33). clawd cloudling 테마와 구별되게 gromo 색을 쓴다.

## 상태 애니메이션 (7종, 전부 SVG)

애니메이션은 SVG 내부 CSS `@keyframes`(`<style>` 블록) 또는 SMIL `<animate>`로 구현.
Electron(Chromium)이 둘 다 렌더한다. 각 상태는 독립 `.svg` 파일 1개.

| 상태 | 트리거 | 동작 | 아이트래킹 |
|---|---|---|---|
| `idle` | 평상시 | 숨쉬기(몸통 상하 미세 스케일), 눈 깜빡 | **필수**(눈·몸·그림자 커서 추적) |
| `thinking` | AI 추론 중 | 책 응시, 눈썹 씰룩, 물음표 점멸 | 불필요 |
| `working` | 도구 실행 중 | 책장 넘김/집중, 팔 미세 움직임 | 불필요 |
| `attention`(happy) | 작업 완료 | 통통 튐 + 반짝(sparkle), 책 살짝 듦 | 불필요 |
| `notification` | 권한 요청·알림 | 느낌표 뿅 + 고개 듦, 살짝 흔들 | 불필요 |
| `sleeping` | 유휴(60s) | 눈 감고 zzz, 책 덮음, 느린 호흡 | 불필요 |
| `waking` | 깨어남 | 기지개(몸통 늘어남), 눈 뜸 | 불필요 |

`error`는 `attention`으로 fallback(별도 파일 없이 theme.json `fallbackTo`).
멀티세션 tier(building/juggling)는 이번 범위 밖 — `working`/`attention`으로 자연 degrade.

## 테마 파일 구조

```
themes/gromo-cloud/
├── theme.json          # schemaVersion 1, 메타 + viewBox + layout + states + eyeTracking
└── assets/
    ├── idle-follow.svg # 아이트래킹 (eyes-js, body-js, shadow-js id 필수)
    ├── thinking.svg
    ├── working.svg
    ├── happy.svg       # attention
    ├── notification.svg
    ├── sleeping.svg
    └── waking.svg
```

- **theme.json 규격**(template 준수): `viewBox`(논리 캔버스, 전 에셋 동일 종횡비),
  `layout`(contentBox/centerX/baselineY/visibleHeightRatio), `eyeTracking`(enabled,
  states:["idle"], ids:{eyes,body,shadow}, shadowOrigin), `sleepSequence.mode`.
- **아이트래킹 계약**: `idle-follow.svg`는 `id="eyes-js"`(눈 그룹), `id="body-js"`(몸통
  그룹), `id="shadow-js"`(그림자)를 반드시 포함. clawd 런타임이 이 id로 커서 추적 변환을 건다.
- 번들 테마로 `themes/`에 커밋 → Settings → 테마에서 "gromo 구름이" 선택. 기본 clawd 게는 유지.

## 제작·검증 방식

1. 각 상태 SVG를 코드로 작성. viewBox·색 토큰·구름 실루엣을 공유 기준으로 통일.
2. `theme.json` 작성 — template 필드 규격 준수, 기존 calico/cloudling theme.json 대조.
3. 서브에이전트 리뷰: theme.json 스키마 정합성, idle의 필수 id 존재, viewBox 종횡비 일치,
   SVG 파싱 유효성(각 파일 `xmllint`/`node` 파싱).
4. 앱에서 검증: Settings → 테마 → gromo 구름이 선택 → idle 눈 추적, 실제 권한 요청 시
   notification, 완료 시 happy, 유휴 시 sleeping을 실기기에서 육안 확인.

## 에러 처리

- 잘못된 SVG/누락 상태 → clawd 테마 로더가 idle로 degrade(theme.json fallbackTo 활용).
- 아이트래킹 id 누락 시 눈 추적만 실패하고 정적 표시 — 리뷰 체크리스트로 방지.
- 테마 선택은 기존 clawd 테마 전환 메커니즘 재사용(신규 코드 없음). 문제 시 기본 테마로 복귀.

## 범위 밖 (이번 스펙 제외)

- 멀티세션 tier 전용 애니(building/conducting) — working/juggling으로 degrade.
- 커스텀 사운드 — 기존 테마 사운드 또는 무음.
- 원본 3D 렌더 픽셀 재현 — 플랫 벡터 재해석으로 대체(승인됨).

## 미결 사항

- 없음. 구현 계획으로 진행.
