# v0.4 — "야간 배치" 정형화 파이프라인 설계 (초안)

- 작성일: 2026-07-04
- 상태: **초안 — 사용자 검토 대기** (구현 착수 전)
- 전제: v0.3.1(branch feature/v0.2-instrument-master, `a45d775`) 위에 증분
- 목적: 이 플랫폼이 실제 운영되려면 필요한 **정기·이벤트성 배치**를, 버튼 하나로 실제 엔진을 호출해
  진짜 before/after 델타와 함께 단계별로 시연. "룰 등록 → 최저가 바인딩 자동 산출 → 원장은 조회만"
  구조를 살아있게 유지하는 야간 파이프라인을 보여준다.

## 확정된 설계 결정 (사용자 승인 완료)

- **연출 = 둘 다**: 메인은 오케스트레이션 파이프라인(버튼 하나 → 6개 잡 순차, 트리거 화살표),
  각 잡 클릭 시 드릴다운(변경 행 단위 before→after).
- **스코프 = 엔진백드 6종**: 전부 실제 도메인 함수 호출 · 진짜 델타.
- **상태 = 실제 store 변경**: 배치가 store를 진짜로 변경 → 대시보드·계좌조회·협수관리가 실제로 갱신됨
  (크로스스크린 데모). `[초기화]`로 mock 리셋.
- **등급 pivot 없음 (v0.3.1 연속)**: 등급은 수수료 결정에 안 쓰임. 대상은 룰이 스스로 선언
  (전체/지정계좌/**조건**/신청/휴면복귀)하고 경쟁. 6개월 지표는 **룰의 자격 조건**으로서 유효.

## 1. 화면 — 신규 탭 "야간 배치"

**상단 파이프라인 뷰**: `[야간 배치 실행]` 버튼. 누르면 6개 잡이 의존 순서대로 순차 실행되며 각 잡 카드가
대기 → 실행중(진행 표시) → 완료로 전환. 잡 사이에 트리거 화살표(↓)가 드러나 "앞 잡이 뒷 잡을 깨운다"를
표현. 완료 카드에 한 줄 델타 요약(예: `지표변경 1 · 협수자격 +1`). 화면이 순차 렌더되도록 잡을
await + 짧은 딜레이로 오케스트레이션(앱 코드이므로 setTimeout 허용).

**하단 드릴다운**: 완료된 잡 카드를 클릭하면 그 잡의 상세 변경 내역(BatchChange 행). 예: ⑤ 바인딩
재계산 클릭 → `A-1002 XNAS:AAPL  BASE 해외주식 → 협의수수료 해외주식 (조건 충족)`.

`[초기화]` = `reset()` 호출로 mock 상태 복귀.

빈/무변경 처리: 잡이 아무것도 안 바꾸면 카드에 "변경 없음" 표시(예: ⑥ 위반 없음).

## 2. 6개 잡 — 엔진 매핑 · 델타 · 의존 순서

의존: ①②③(상류 도메인 변경) → ④(갱신된 지표로 협수 자격 평가) → ⑤(모든 변경 수렴, **유일한 rebind**)
→ ⑥(최종 활성 집합 검증).

| 순서 | 잡 | 실제 로직 | 표시 델타 |
|---|---|---|---|
| ① | 룰 발효/만료 | 오늘 기준 룰 window로 status 전환 (승인대기·활성 → 활성/종료) | 발효 N · 만료 M (룰ID) |
| ② | 지표 재산정 | 결정적 nudge로 6개월 지표 갱신 (등급 아님) | 계좌별 지표 before→after |
| ③ | 종목 마스터 동기화 | `syncFromLedger` (신규 상장 유입) | 신규 품목 N |
| ④ | 협의수수료 조건 평가 | `evalCondition`으로 조건형 협수 자격 재평가 → 승인후연장/해지후보 | 신규자격·상실·연장 |
| ⑤ | **바인딩 재계산** | `rebindAll` — ①~④ 결과가 여기서 수렴 | 변경·신규·삭제 바인딩 수 + 샘플 행 |
| ⑥ | 지배관계 재검증 | 활성 EVENT/NEGO 요율표를 BASE 대비 `dominates` 재확인 | 위반 룰(있으면) |

## 3. 도메인/스토어 변경

### 3.1 잡 결과 계약 (신규 타입, src/domain/types.ts 또는 store)
```ts
export interface BatchChange { label: string; detail: string }   // 변경 1행 (드릴다운)
export interface BatchJobResult { summary: string; changes: BatchChange[] }
```
각 잡은 store 액션으로 **store를 변경하고 BatchJobResult를 반환**. 화면이 순서대로 호출·수집.

### 3.2 rebind 분리 (중요, 동작 안전)
현재 `syncFromLedger`/`approveRule`/`extendNegotiated`/`registerInstruments`는 내부에서
`allBindings`를 함께 계산함. 배치에서는 **①②③④가 도메인 변경만 스테이징하고 ⑤가 유일한 rebind**로
모든 변경을 흡수하도록, 각 배치 잡 액션은 rebind를 하지 **않는** 변형을 사용. 기존 액션(대시보드/위저드
경로)의 동작은 그대로 유지(회귀 없음) — 배치 전용 경로만 분리.

### 3.3 조건형 협수 자격을 `isTarget`에 연결 (핵심 도메인 변경, TDD)
새 targeting 모델의 실체. 현재 `isTarget`은 신청형을 enrollment로만 판정하고 `condition`을 무시함
(6개월 지표는 협수관리 화면 게이지 표시용에 그침). v0.4에서:

- **룰에 `condition`이 있으면 `isTarget`은 `evalCondition(rule, acct)`를 하드 게이트로 요구**한다.
  즉 조건 미충족 계좌는 후보에서 제외. 조건이 없는 룰은 기존 로직 그대로(무회귀).
- 이로써 ②가 지표를 올려 계좌가 문턱을 넘으면 → ④가 자격 부여로 보고 → ⑤ rebind가 그 계좌에 협수를 실제
  적용하는 **캐스케이드**가 성립.
- **주의(확인 필요)**: 기존 mock의 RULE-NEGO-STOCK-US는 condition(평균자산 ≥ 5억) + 신청형이며
  A-1001(8.5억)·A-1002(1.2억)에 enrollment가 있음. 이 변경 후 A-1002(1.2억)는 조건 미충족으로 협수
  탈락하게 됨 — 이는 의도된 새 모델이며 ②의 데모 대상. 기존 binding.test.ts의 isTarget 테스트는
  condition 없는 룰만 쓰므로 무회귀(계획 단계에서 재확인).

### 3.4 mock 시드 조정 (가시적 델타용)
- **① 용**: 오늘(2026-07-04) window에 드는 `승인대기` 룰 1개(→ ①이 발효) + endDate가 오늘 이전인
  `활성` 룰 1개(→ ①이 만료). 최소 시드.
- **② 용**: 캐스케이드 대상 계좌를 협수 문턱(5억) **바로 아래**로 시드(예: A-1002 metric6mAsset
  ≈ 4.9억). nudge가 5억을 넘기도록.
- 시드는 결정적(seed LCG/고정값) — Math.random/Date.now 금지 관례 유지.

### 3.5 지표 nudge (src/domain/metrics.ts, 순수)
`nudgeMetrics(acct, seed): { metric6mAsset, metric6mVolume }` — 계좌ID 기반 결정적 증분(신규 체결
유입 흉내). React-free 순수 함수.

### 3.6 지배관계 재검증 (기존 `dominates` 재사용)
`revalidateDominance(rules, schedules): ruleId[]` — 활성 EVENT/NEGO 각각을 같은 assetClass BASE
요율표 대비 probe grid 전 구간 `dominates` 확인, 위반 룰ID 반환.

## 4. 파일 구조

```
src/domain/metrics.ts        # nudgeMetrics (순수) — 신규
src/domain/binding.ts        # isTarget에 condition 게이트 (TDD)
src/domain/lifecycle.ts      # 룰 발효/만료 window 판정 (순수) — 신규(또는 store 내 헬퍼)
src/store/useStore.ts        # 배치 잡 액션 6종(각 BatchJobResult 반환) + rebind 분리 + ⑤ 델타 diff
src/store/mock.ts            # 시드 조정(① 발효/만료 룰, ② 문턱 근처 계좌)
src/screens/BatchOps.tsx     # 파이프라인 + 드릴다운 — 신규
src/App.tsx                  # 탭 '야간 배치'
src/styles.css               # 파이프라인/잡카드/화살표 (추가만)
```

## 5. 검증

- 도메인 TDD: `isTarget` condition 게이트(충족→후보, 미충족→탈락), `nudgeMetrics` 결정성,
  `revalidateDominance` 위반 판정, 잡별 델타 계약. 기존 66 테스트 무회귀.
- 배치 순차 실행 후 store 상태가 실제 변경되고 대시보드 바인딩 수/협수관리 게이지가 갱신되는지(수동).
- `[초기화]`가 완전 복구하는지.

## 6. 범위 외

- 실제 원장/체결 로그 연동, 잡 스케줄링/크론, 병렬 실행, 실패·롤백·재시도, 잡 이력 영속화.
- 감면 실적 집계(체결 로그 필요) · 원장 정합성 대사(별도 원장 스냅샷 필요) — 다음 증분 후보.

## 7. 열린 결정 (검토 시 확정)

1. **탭 이름**: "야간 배치"(기본) vs "정형화 배치" vs 기타.
2. **③.3 조건 게이트 의미**: "condition 있으면 evalCondition 하드 게이트"(제안) — 신청형과의 결합
   규칙 확정 필요(제안: condition이 있으면 enrollment 무관하게 조건이 우선 게이트).
3. **② 캐스케이드 대상**: A-1002를 문턱 아래로 재시드(제안) vs 다른 계좌 신설.
4. **⑥ 지배관계 재검증**: 현재 mock에선 위반이 없어 "위반 없음"만 뜰 수 있음 — 그대로 둘지(정상 동작
   시연) vs 위반 룰 1개를 의도 시드해 경고를 보여줄지.
