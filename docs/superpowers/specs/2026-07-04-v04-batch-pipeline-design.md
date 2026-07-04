# v0.4 — "야간 배치" 정형화 파이프라인 설계 (초안)

- 작성일: 2026-07-04
- 상태: **설계 확정** (열린 결정 전부 해소 — §7). 계획 작성 단계로 이행. 구현은 사용자 승인 후.
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

## 1. 화면 — 신규 탭 "배치 플로우"

**상단 파이프라인 뷰**: `[배치 실행]` 버튼. 누르면 6개 잡이 의존 순서대로 순차 실행되며 각 잡 카드가
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
| ④ | 협의수수료 조건 평가 | (상품군별) `evalCondition` 재평가 → 조건 유지 자동연장 / 미충족 해지후보 | (계좌×상품군) 신규자격·상실·연장 |
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

### 3.3 협수 자격 lifecycle을 조건에 연결 (핵심 도메인 변경, TDD)
새 targeting 모델의 실체. **협수 자격 = 신청 + 조건**, 그리고 **상품군(룰)별로 관리**(각 협수 룰이
assetClass로 scope). 현재 `isTarget`은 신청형을 enrollment로만 판정하고 `condition`을 무시함(6개월
지표는 협수관리 게이지 표시용에 그침). v0.4에서:

- **최초 자격**: 신청(enrollment) → 조건 확인(evalCondition) → 승인. `isTarget`에서 **condition이 있는
  협수는 `enrollment 존재 AND evalCondition(rule, acct)` 둘 다**를 요구. (신청 UI 자체는 v0.4 범위 외 —
  mock enrollment가 "신청·승인된 상태"를 대표.) condition 없는 순수 개별협의 협수는 기존대로 enrollment만.
- **연장(batch ④)**: 이미 자격 있는 (계좌×상품군)을 야간 재평가 → 조건 유지면 **자동 연장**
  (`extendNegotiated`), 미충족이면 **해지 후보** 플래그.
- **처리 단위 = 상품군(룰)별**: 각 조건형 협수 룰(assetClass scope)을 그 대상 계좌들에 대해 평가하고
  (계좌×상품군) 단위로 자격 결과를 보고. 계좌 하나를 전 상품군에 뭉뚱그리지 않음.
- **evalCondition을 도메인으로 이동**: 현재 `src/store/useStore.ts`의 순수 함수 `evalCondition`을
  `src/domain/`으로 옮겨 `isTarget`이 store에 의존하지 않고 쓰게 함(React-free 유지). store는 재-export로
  기존 소비자(Negotiated.tsx) 무회귀.
- **캐스케이드**: A-1002가 조건 문턱 아래 → ②가 지표를 올려 5억 초과 → ④가 자동 연장(자격 획득/유지) →
  ⑤ rebind가 그 (계좌×상품군)에 협수를 실제 적용.
- **무회귀**: 기존 binding.test.ts의 isTarget 테스트는 condition 없는 룰만 쓰므로 영향 없음(계획서에서
  재확인). 앱 레벨에선 A-1002가 재시드 전까지 협수 탈락할 수 있으나 이는 의도된 새 모델.

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

## 7. 결정 (전부 확정)

1. **탭 이름**: **"배치 플로우"**. 버튼 "[배치 실행]".
2. **협수 조건 게이트**: **신청 + 조건 둘 다** (§3.3). 최초는 신청→조건확인→승인, 연장은 조건 충족 시
   자동 연장, 처리는 상품군(룰)별. condition 없는 협수는 enrollment만.
3. **② 캐스케이드 대상**: **A-1002를 문턱(5억) 바로 아래로 재시드**(metric6mAsset ≈ 4.9억) →
   ② nudge가 5억 초과 → ④ 자격 획득 → ⑤ 협수 적용. (해지 측 시연이 필요하면 다른 계좌를 문턱 살짝
   위→아래로 dip시키는 건 계획 재량.)
4. **⑥ 지배관계 재검증**: **위반을 조작하지 않는다.** 활성 EVENT/NEGO를 BASE 대비 전수 재검증한
   결과 리스트를 드릴다운에 노출(오늘 데이터는 전부 통과 ✓). "매일 자동 재검증하고 이상 없음을 확인"이
   정직한 시연 포인트 — 억지 위반 시드는 플랫폼의 '정직한 실제 로직' 원칙에 어긋나므로 배제.

**브랜치 처리(별도 확정)**: v0.3/v0.3.1이 얹힌 `feature/v0.2-instrument-master`를 **그대로 유지**
(머지·폐기 안 함). v0.4도 같은 브랜치에서 계속 — 프로토타입 증분이 앞으로 쌓이는 흐름, 원격 없음, 언제든
되돌릴 수 있음. (사용자 "알아서" 위임.)
