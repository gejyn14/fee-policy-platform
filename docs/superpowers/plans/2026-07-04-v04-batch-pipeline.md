# v0.4 배치 플로우 파이프라인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신규 탭 "배치 플로우" — [배치 실행] 버튼 하나로 6개 정형화 배치 잡(①룰 발효/만료 →②지표 재산정 →③종목 동기화 →④협수 조건 평가 →⑤바인딩 재계산 →⑥지배관계 재검증)을 실제 엔진 호출로 순차 실행하고, 파이프라인 뷰 + 잡별 드릴다운(before→after 델타)으로 시연. 배치는 실제 store를 변경.

**Architecture:** 순수 도메인 헬퍼(evalCondition 이동+isTarget 조건 게이트, nudgeMetrics, classifyLifecycle, revalidateDominance)를 TDD로 얹고, store에 6개 배치 잡 액션(각 `BatchJobResult` 반환, ①~④는 rebind 안 함·⑤가 유일 rebind)을 추가. 화면(BatchOps.tsx)은 액션을 순차 호출·수집해 그리기만. 스펙: `docs/superpowers/specs/2026-07-04-v04-batch-pipeline-design.md` **먼저 읽을 것**.

**Tech Stack:** 기존 동일(Vite+React18+TS+zustand+Vitest). 신규 의존성 금지.

## Global Constraints

- UI 문구 전부 한국어. `src/domain/`은 React-free(store/react import 금지). 신규 의존성 금지. **등급을 수수료 결정에 쓰지 않음(v0.3.1 연속).**
- 결정성: `Math.random`/`Date.now`/인자 없는 `new Date()` 금지 — 시드/고정값 사용. 기준일 `TODAY='2026-07-04'`.
- 각 태스크 완료 시 `npx vitest run` + `npm run build` 둘 다 green. 커밋 메시지 끝에 `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **기존 66 테스트 무회귀**: v0.4는 의도적 동작 변경(협수 조건 게이트)을 포함하나 확인 결과 기존 테스트는 영향 없음 — (a) `evalCondition`은 store에서 re-export 유지, (b) 재시드는 A-1002만(A-1001 불변), (c) 조건 없는 룰의 isTarget 불변. **기존 단언 조정 금지**(정말로 낡은 동작을 검증하는 게 드러나면 그때만, 이유를 커밋에 명시).
- 상태 모델: 배치 잡은 실제 store 변경. `[초기화]`=기존 `reset()`.
- 병렬 실행 시 파일 겹침·에이전트 커밋 금지 관례. 이번은 T1→T6 순차(의존 체인).

## 파일 구조

```
src/domain/eligibility.ts    # evalCondition 이동(순수) — 신규 (T1)
src/domain/binding.ts        # isTarget에 조건 하드 게이트 (T1)
src/domain/metrics.ts        # nudgeMetrics (순수) — 신규 (T2)
src/domain/lifecycle.ts      # classifyLifecycle (순수) — 신규 (T2)
src/domain/dominance.ts      # revalidateDominance 추가 (T2)
src/domain/types.ts          # BatchChange / BatchJobResult (T3)
src/store/mock.ts            # 시드: A-1002 재시드 + ① 발효/만료 룰 (T3)
src/store/useStore.ts        # evalCondition re-export(T1) + 배치 잡 액션 6종(T4)
src/screens/BatchOps.tsx     # 파이프라인 + 드릴다운 — 신규 (T5)
src/App.tsx                  # 탭 '배치 플로우' (T5)
src/styles.css               # 파이프라인/잡카드/화살표 — 추가만 (T5)
README.md                    # 시연 시나리오 (T6)
```

---

### Task 1: evalCondition 도메인 이동 + isTarget 조건 게이트 (TDD)

**Files:**
- Create: `src/domain/eligibility.ts`
- Modify: `src/domain/binding.ts`, `src/store/useStore.ts`
- Test: `src/domain/binding.test.ts` (추가)

**Interfaces:**
- Produces: `export function evalCondition(rule: FeeRule, acct: Account): boolean` (from `src/domain/eligibility.ts`). `isTarget`는 시그니처 불변, 동작만 확장.
- `src/store/useStore.ts`는 `export { evalCondition } from '../domain/eligibility';` 로 re-export(기존 `useStore.test.ts`/`Negotiated.tsx` 무회귀).

- [ ] **Step 1: 현재 코드 확인** — `src/store/useStore.ts:15-19`의 `evalCondition`(순수 함수: `rule.condition` 없으면 true, 있으면 metric 값 ≥ threshold)와 `src/domain/binding.ts:14-21`의 `isTarget`을 정독.

- [ ] **Step 2: 실패 테스트 추가** — `src/domain/binding.test.ts`에 describe 추가(기존 헬퍼 `rule`/`acct` 재사용):

```ts
import { isTarget } from './binding';

describe('isTarget 조건 게이트', () => {
  // acct: metric6mAsset 0 (기존 헬퍼). 조건 5억이면 미충족.
  const acctRich = { ...acct, metric6mAsset: 600_000_000 };
  const negoCond = rule({ id: 'R-COND', type: 'NEGOTIATED', applyMode: '신청형',
    condition: { metric: '6개월평균자산', threshold: 500_000_000, action: '승인후연장' } });
  const enr = [{ accountId: acct.id, ruleId: 'R-COND', enrolledAt: '2026-01-02', channel: '지점' }];

  it('condition 미충족이면 신청했어도 대상 아님', () => {
    expect(isTarget(negoCond, acct, enr)).toBe(false);        // 자산 0 < 5억
  });
  it('condition 충족 + 신청이면 대상', () => {
    expect(isTarget(negoCond, acctRich, enr)).toBe(true);     // 6억 ≥ 5억
  });
  it('condition 충족이어도 신청 없으면 대상 아님', () => {
    expect(isTarget(negoCond, acctRich, [])).toBe(false);     // 신청+조건 둘 다 필요
  });
  it('condition 없는 룰은 기존 로직 그대로', () => {
    const evt = rule({ id: 'R-NC', type: 'EVENT', applyMode: '일괄적용형' });
    expect(isTarget(evt, acct, [])).toBe(true);
  });
});
```

- [ ] **Step 3: 실패 확인** — `npx vitest run src/domain/binding.test.ts` → 조건 게이트 신규 케이스 중 미충족/충족 케이스 FAIL(아직 게이트 없음), 나머지 통과.

- [ ] **Step 4: 구현** —
  1. `src/domain/eligibility.ts` 생성, `evalCondition`을 이동(내용 동일):
  ```ts
  import type { Account, FeeRule } from './types';
  export function evalCondition(rule: FeeRule, acct: Account): boolean {
    if (!rule.condition) return true;
    const value = rule.condition.metric === '6개월평균자산' ? acct.metric6mAsset : acct.metric6mVolume;
    return value >= rule.condition.threshold;
  }
  ```
  2. `src/domain/binding.ts`: `import { evalCondition } from './eligibility';` 추가. `isTarget` 맨 앞에 하드 게이트:
  ```ts
  export function isTarget(rule: FeeRule, acct: Account, enrollments: Enrollment[]): boolean {
    if (rule.condition && !evalCondition(rule, acct)) return false;   // 조건 하드 게이트 (신청+조건)
    if (rule.type === 'BASE') return true;
    // ...기존 그대로...
  }
  ```
  3. `src/store/useStore.ts`: 기존 `evalCondition` 함수 정의를 삭제하고 `export { evalCondition } from '../domain/eligibility';`로 교체. `useStore.ts` 내부에서 `evalCondition`을 쓰는 곳이 있으면 import로 대체.

- [ ] **Step 5: 전체 통과** — `npx vitest run` → 기존 66 + 신규 4 = 70 통과(기존 단언 무수정, 특히 `useStore.test.ts`의 evalCondition 테스트가 re-export로 통과), `npm run build` clean.

- [ ] **Step 6: 커밋** — `git commit -m "feat: evalCondition 도메인 이동 + isTarget 조건 하드 게이트(신청+조건)"`

---

### Task 2: 순수 배치 헬퍼 (nudgeMetrics · classifyLifecycle · revalidateDominance) (TDD)

**Files:**
- Create: `src/domain/metrics.ts`, `src/domain/lifecycle.ts`
- Modify: `src/domain/dominance.ts`
- Test: `src/domain/metrics.test.ts`, `src/domain/lifecycle.test.ts`, `src/domain/dominance.test.ts`(추가)

**Interfaces:**
- Produces:
```ts
// metrics.ts — 결정적 지표 증분(신규 체결 유입 흉내). Math.random/Date 금지.
export function nudgeMetrics(acct: Account): { metric6mAsset: number; metric6mVolume: number };
// lifecycle.ts — 오늘 기준 룰 상태 전환 판정
export function classifyLifecycle(rule: FeeRule, today: string): 'activate' | 'expire' | 'none';
// dominance.ts — 활성 EVENT/NEGO를 같은 상품군 BASE 대비 재검증
export function revalidateDominance(rules: FeeRule[], schedules: FeeSchedule[], today: string): { rule: FeeRule; ok: boolean }[];
```

- [ ] **Step 1: 실패 테스트 — metrics** (`src/domain/metrics.test.ts` 신규):
```ts
import { it, expect, describe } from 'vitest';
import { nudgeMetrics } from './metrics';
import type { Account } from './types';
const a = (asset: number): Account => ({ id: 'A', name: 'a', grade: 'GOLD', dormantReturned: false, metric6mAsset: asset, metric6mVolume: asset * 2 });

describe('nudgeMetrics', () => {
  it('결정적: 같은 입력 같은 출력', () => {
    expect(nudgeMetrics(a(490_000_000))).toEqual(nudgeMetrics(a(490_000_000)));
  });
  it('증가하며 4.9억을 5억 위로 넘긴다(캐스케이드 트리거)', () => {
    const r = nudgeMetrics(a(490_000_000));
    expect(r.metric6mAsset).toBeGreaterThan(500_000_000);
    expect(r.metric6mAsset).toBeGreaterThan(490_000_000);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/domain/metrics.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: 구현 metrics** —
```ts
import type { Account } from './types';
// 신규 체결 유입을 흉내낸 결정적 +5% 증분 (원 단위 반올림).
export function nudgeMetrics(acct: Account): { metric6mAsset: number; metric6mVolume: number } {
  return {
    metric6mAsset: Math.round(acct.metric6mAsset * 1.05),
    metric6mVolume: Math.round(acct.metric6mVolume * 1.05),
  };
}
```

- [ ] **Step 4: 실패 테스트 — lifecycle** (`src/domain/lifecycle.test.ts` 신규, 헬퍼는 자체 정의):
```ts
import { it, expect, describe } from 'vitest';
import { classifyLifecycle } from './lifecycle';
import type { FeeRule } from './types';
const r = (over: Partial<FeeRule>): FeeRule => ({ id: 'R', name: 'r', type: 'EVENT', status: '활성', applyMode: '일괄적용형',
  startDate: '2026-01-01', endDate: '2026-12-31', scope: { assetClass: '국내주식', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
  scheduleId: 'S', warnings: { dominance: true, reverseMargin: false }, createdBy: 't', log: [], ...over });

describe('classifyLifecycle (today=2026-07-04)', () => {
  it('승인대기 + window 안이면 activate', () => {
    expect(classifyLifecycle(r({ status: '승인대기', startDate: '2026-07-01', endDate: '2026-12-31' }), '2026-07-04')).toBe('activate');
  });
  it('활성 + endDate 지났으면 expire', () => {
    expect(classifyLifecycle(r({ status: '활성', endDate: '2026-06-30' }), '2026-07-04')).toBe('expire');
  });
  it('활성 + window 안이면 none', () => {
    expect(classifyLifecycle(r({ status: '활성' }), '2026-07-04')).toBe('none');
  });
  it('승인대기 + 미래 시작이면 none', () => {
    expect(classifyLifecycle(r({ status: '승인대기', startDate: '2026-08-01' }), '2026-07-04')).toBe('none');
  });
});
```

- [ ] **Step 5: 구현 lifecycle** —
```ts
import type { FeeRule } from './types';
export function classifyLifecycle(rule: FeeRule, today: string): 'activate' | 'expire' | 'none' {
  const inWindow = rule.startDate <= today && today <= rule.endDate;
  if (rule.status === '승인대기' && inWindow) return 'activate';
  if (rule.status === '활성' && today > rule.endDate) return 'expire';
  return 'none';
}
```

- [ ] **Step 6: 실패 테스트 — revalidateDominance** (`src/domain/dominance.test.ts`에 추가). 기존 파일의 헬퍼/`dominates` import 확인 후, 활성 EVENT가 같은 상품군 BASE보다 전 구간 저렴하면 ok=true인 케이스와, BASE 없는 상품군은 검증 스킵(포함 안 함) 케이스:
```ts
import { revalidateDominance } from './dominance';
describe('revalidateDominance', () => {
  it('활성 EVENT가 BASE보다 싸면 ok=true, BASE는 목록에서 제외', () => {
    // flat BASE 100 vs EVENT 50 (같은 국내주식). 헬퍼는 이 파일의 기존 스타일 재사용.
    // (실제 스케줄/룰 구성은 기존 dominance.test.ts 패턴을 따를 것)
    // 기대: 결과에 EVENT 1건, ok=true. BASE 룰은 결과에 없음.
  });
});
```
(구현자: 기존 `dominance.test.ts`의 스케줄/probe 패턴을 그대로 재사용해 위 의도대로 구체화. BASE 요율표는 `schedules`에서 같은 assetClass의 BASE 룰 scheduleId로 찾음.)

- [ ] **Step 7: 구현 revalidateDominance** (`src/domain/dominance.ts`에 추가) —
```ts
import { isTarget } from './binding'; // 순환 주의: dominance는 binding을 import하지 않음. 아래는 binding에 의존하지 않는 구현.
// 활성 EVENT/NEGO 각각을 같은 assetClass의 BASE 요율표 대비 dominates로 재검증.
export function revalidateDominance(rules: FeeRule[], schedules: FeeSchedule[], today: string): { rule: FeeRule; ok: boolean }[] {
  const active = rules.filter((r) => r.status === '활성' && r.startDate <= today && today <= r.endDate);
  const schedOf = (id: string) => schedules.find((s) => s.id === id)!;
  const baseOf = (assetClass: string) => active.find((r) => r.type === 'BASE' && r.scope.assetClass === assetClass);
  const result: { rule: FeeRule; ok: boolean }[] = [];
  for (const r of active) {
    if (r.type === 'BASE') continue;
    const base = baseOf(r.scope.assetClass);
    if (!base) continue; // 비교 대상 BASE 없으면 스킵
    // 대표 probe: 해당 상품군의 표본 체결. dominance.ts의 기존 probePrices/dominates 재사용.
    // dominates(candidate, incumbent, sample)가 전 구간 저렴 여부를 반환하는 기존 시그니처를 사용.
    const ok = dominatesSchedule(schedOf(r.scheduleId), schedOf(base.scheduleId)); // ← 아래 주: 기존 dominates를 감싸 구현
    result.push({ rule: r, ok });
  }
  return result;
}
```
**주(중요):** `src/domain/dominance.ts`의 기존 `dominates`/`probePrices` **실제 시그니처를 먼저 확인**하고 그에 맞춰 `dominatesSchedule` 비교를 구체화할 것(위는 골격). `binding.ts`를 import하지 말 것(순환). 필요한 sample Execution은 dominance.ts 기존 패턴대로 구성. `FeeRule`/`FeeSchedule` 타입 import 추가.

- [ ] **Step 8: 전체 통과 & 커밋** — `npx vitest run`(70 + 신규) green, `npm run build` clean. `git commit -m "feat: 배치 순수 헬퍼 nudgeMetrics·classifyLifecycle·revalidateDominance (TDD)"`

---

### Task 3: 배치 기반 — 결과 타입 + mock 시드

**Files:**
- Modify: `src/domain/types.ts`, `src/store/mock.ts`
- Test: `src/store/useStore.test.ts`(무회귀 재확인 — 신규 단언 추가는 선택)

**Interfaces:**
- Produces (types.ts):
```ts
export interface BatchChange { label: string; detail: string }
export interface BatchJobResult { summary: string; changes: BatchChange[] }
```

- [ ] **Step 1: 타입 추가** — `src/domain/types.ts` 끝에 `BatchChange`/`BatchJobResult` 추가.

- [ ] **Step 2: mock 재시드 — A-1002** — `src/store/mock.ts`의 A-1002 `metric6mAsset`를 `120_000_000` → **`490_000_000`**(4.9억, 협수 문턱 5억 바로 아래)로 변경. (metric6mVolume은 그대로 두거나 비례 조정 — 협수 조건은 평균자산 기준이므로 asset만으로 충분.) 주석으로 "배치 ② 캐스케이드 대상: nudge(+5%)로 5.145억이 되어 5억 초과" 명시.

- [ ] **Step 3: mock 시드 — ① 발효/만료 대상 룰 2개** — `src/store/mock.ts`의 `mockRules`에 추가(기존 BASE 국내주식 스케줄 `FS-BASE-STOCK-KR`보다 저렴한 스케줄이 필요하면 `mockSchedules`에도 1개 추가):
```ts
// ① 발효 대상: 오늘(2026-07-04) window에 들지만 아직 승인대기
{
  id: 'RULE-EVENT-KR-PROMO', name: '국내주식 여름 프로모션(발효 대기)',
  type: 'EVENT', status: '승인대기', applyMode: '일괄적용형',
  startDate: '2026-07-01', endDate: '2026-09-30',
  scope: { assetClass: '국내주식', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
  scheduleId: 'FS-EVENT-KR-PROMO',
  warnings: { dominance: true, reverseMargin: false }, createdBy: '마케팅팀', log: ['2026-06-28 기안 → 승인대기'],
},
// ① 만료 대상: 활성이지만 endDate가 오늘 이전
{
  id: 'RULE-EVENT-KR-SPRING', name: '국내주식 봄 이벤트(만료 대상)',
  type: 'EVENT', status: '활성', applyMode: '일괄적용형',
  startDate: '2026-03-01', endDate: '2026-06-30',
  scope: { assetClass: '국내주식', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
  scheduleId: 'FS-EVENT-KR-PROMO',
  warnings: { dominance: true, reverseMargin: false }, createdBy: '마케팅팀', log: ['2026-02-25 기안 → 활성'],
},
```
그리고 `mockSchedules`에 국내주식용 저렴 스케줄 추가(BASE 국내주식보다 싸게 — 발효 후 최저가 경쟁에서 이기도록):
```ts
{ id: 'FS-EVENT-KR-PROMO', name: 'EVENT 국내주식 프로모션 요율', components: [
  { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 3 },
  { name: '거래소/예탁원 수수료', kind: '유관기관', payer: '고객부과', rateType: '정률', rateBp: 0.5 },
  { name: '증권거래세', kind: '세금', payer: '고객부과', rateType: '정률', rateBp: 15 },
] },
```
**시드 안전성:** 승인대기 룰은 rebindAccount의 active 필터(status==='활성')에서 제외되고, 만료 룰은 window 필터(today<=endDate)에서 제외되므로 **배치 실행 전 기존 바인딩·테스트에 영향 없음**(계획 §Global 무회귀 근거).

- [ ] **Step 4: 무회귀 확인** — `npx vitest run`(70 유지) + `npm run build` clean. 특히 `e2e-workflow.test.ts`(A-1001 CME:6A)·`useStore.test.ts`(evalCondition·reset bindings 비어있지 않음)가 그대로 통과하는지 확인. A-1001은 8.5억이라 협수 유지, 신규 시드 룰은 배치 전 비활성.

- [ ] **Step 5: 커밋** — `git commit -m "feat: 배치 결과 타입 + mock 시드(A-1002 문턱 근처·발효/만료 룰)"`

---

### Task 4: 배치 잡 액션 6종 (store) — 각 BatchJobResult 반환 (TDD)

**Files:**
- Modify: `src/store/useStore.ts`
- Test: `src/store/useStore.test.ts`(추가)

**Interfaces:**
- Consumes: `nudgeMetrics`/`classifyLifecycle`/`revalidateDominance`(T2), `evalCondition`(T1), `rebindAccount`(기존), `syncFromLedger` 내부 로직, `BatchJobResult`(T3).
- Produces (State에 추가):
```ts
batchActivateExpireRules(): BatchJobResult;   // ① rebind 안 함
batchRecomputeMetrics(): BatchJobResult;      // ② rebind 안 함
batchSyncInstruments(): BatchJobResult;       // ③ rebind 안 함 (staged)
batchEvalNegotiations(): BatchJobResult;      // ④ 자동연장/해지후보, rebind 안 함
batchRebind(): BatchJobResult;                // ⑤ 유일 rebind, before/after diff
batchRevalidateDominance(): BatchJobResult;   // ⑥ report only
```

**설계 원칙:** ①~④·⑥은 `bindings`를 재계산하지 않는다(도메인 상태만 변경/보고). **⑤ `batchRebind`만** `allBindings`로 rebind. 기존 액션(approveRule/syncFromLedger 등)은 변경하지 않음(각자 rebind 유지). ③은 기존 `syncFromLedger`의 유입 로직만 재사용하되 rebind는 생략하는 별도 액션.

- [ ] **Step 1: 실패 테스트** — `src/store/useStore.test.ts`에 describe 추가. reset 후 시나리오(캐스케이드):
```ts
describe('배치 잡', () => {
  beforeEach(() => useStore.getState().reset());

  it('① 발효/만료: 승인대기→활성, 만료 활성→종료', () => {
    const res = useStore.getState().batchActivateExpireRules();
    const rules = useStore.getState().rules;
    expect(rules.find(r => r.id === 'RULE-EVENT-KR-PROMO')!.status).toBe('활성');
    expect(rules.find(r => r.id === 'RULE-EVENT-KR-SPRING')!.status).toBe('종료');
    expect(res.summary).toContain('발효');
  });

  it('② 지표 재산정: A-1002 자산이 5억을 넘는다', () => {
    useStore.getState().batchRecomputeMetrics();
    const a = useStore.getState().accounts.find(x => x.id === 'A-1002')!;
    expect(a.metric6mAsset).toBeGreaterThan(500_000_000);
  });

  it('④+⑤ 캐스케이드: 지표 재산정 후 A-1002가 해외주식 협수 자격을 얻어 바인딩에 반영', () => {
    const s = useStore.getState();
    s.batchRecomputeMetrics();     // A-1002 → 5.145억
    s.batchEvalNegotiations();     // 조건 충족 → 연장/자격
    s.batchRebind();               // 수렴
    // A-1002의 해외주식(XNAS 등) 바인딩 출처가 협의수수료 룰
    const b = useStore.getState().bindings.find(x => x.accountId === 'A-1002' && x.scheduleId === 'FS-NEGO-STOCK-US');
    expect(b).toBeTruthy();
  });

  it('⑤ batchRebind는 before/after 변경 건수를 델타로 반환', () => {
    const s = useStore.getState();
    s.batchRecomputeMetrics(); s.batchEvalNegotiations();
    const res = s.batchRebind();
    expect(res.changes.length).toBeGreaterThan(0);
  });

  it('⑥ 지배관계 재검증: 위반 없으면 summary에 위반 0', () => {
    const res = useStore.getState().batchRevalidateDominance();
    expect(res.summary).toMatch(/위반\s*0|이상\s*없/);
  });
});
```
(구현자: A-1002가 실제로 보유하는 해외주식 product의 scopeKey는 마스터데이터에 의존하므로, 테스트는 `scheduleId === 'FS-NEGO-STOCK-US'`로 협수 적용 여부를 검증. 만약 A-1002가 해외주식 product 바인딩을 갖지 않는 구조라면, 해당 계좌×해외주식이 바인딩 대상이 되도록 최소 조건을 확인하고 테스트를 그 scopeKey로 구체화.)

- [ ] **Step 2: 실패 확인** — `npx vitest run src/store/useStore.test.ts` → 신규 배치 케이스 FAIL(액션 없음).

- [ ] **Step 3: 구현** — `useStore.ts`에 액션 6종 추가. 골격:
```ts
batchActivateExpireRules: () => {
  const changes: BatchChange[] = [];
  set((s) => {
    const rules = s.rules.map((r) => {
      const c = classifyLifecycle(r, TODAY);
      if (c === 'activate') { changes.push({ label: r.id, detail: `발효: 승인대기 → 활성 (${r.name})` });
        return { ...r, status: '활성' as const, log: [...r.log, `${TODAY} 발효(배치) → 활성`] }; }
      if (c === 'expire') { changes.push({ label: r.id, detail: `만료: 활성 → 종료 (${r.name})` });
        return { ...r, status: '종료' as const, log: [...r.log, `${TODAY} 만료(배치) → 종료`] }; }
      return r;
    });
    return { rules };   // rebind 안 함
  });
  const act = changes.filter(c => c.detail.startsWith('발효')).length;
  const exp = changes.filter(c => c.detail.startsWith('만료')).length;
  return { summary: `발효 ${act} · 만료 ${exp}`, changes };
},

batchRecomputeMetrics: () => {
  const changes: BatchChange[] = [];
  set((s) => {
    const accounts = s.accounts.map((a) => {
      const n = nudgeMetrics(a);
      if (n.metric6mAsset !== a.metric6mAsset) changes.push({ label: a.id,
        detail: `6개월평균자산 ${a.metric6mAsset.toLocaleString()} → ${n.metric6mAsset.toLocaleString()}` });
      return { ...a, ...n };
    });
    return { accounts };
  });
  return { summary: `지표변경 ${changes.length}`, changes };
},

batchSyncInstruments: () => {
  let added = 0; const changes: BatchChange[] = [];
  set((s) => {
    const batch = NEW_LISTING_POOL.slice(s.syncCursor, s.syncCursor + SYNC_BATCH_SIZE);
    added = batch.length;
    if (batch.length === 0) return {};
    batch.forEach((i) => changes.push({ label: i.code, detail: `신규 상장: ${i.name} (${i.exchange})` }));
    const instruments = [...s.instruments, ...batch];
    return { instruments, products: deriveProducts(instruments), syncCursor: s.syncCursor + batch.length }; // rebind 안 함
  });
  return { summary: `신규 품목 ${added}`, changes };
},

batchEvalNegotiations: () => {
  const changes: BatchChange[] = [];
  set((s) => {
    const rules = s.rules.map((r) => {
      if (r.type !== 'NEGOTIATED' || !r.condition) return r;
      // 상품군(룰)별 처리: 이 협수의 대상(신청 계좌들)에 대해 조건 재평가
      const enrolledAccts = s.accounts.filter((a) => s.enrollments.some((e) => e.accountId === a.id && e.ruleId === r.id));
      let anyMet = false;
      for (const a of enrolledAccts) {
        const met = evalCondition(r, a);
        changes.push({ label: `${a.id}·${r.scope.assetClass}`,
          detail: met ? `조건 충족 → 자격 유지/연장` : `조건 미충족 → 해지 후보` });
        if (met) anyMet = true;
      }
      // 조건 유지 계좌가 있으면 자동 연장(승인후연장)
      return anyMet ? { ...r, endDate: extendOneYear(r.endDate), log: [...r.log, `${TODAY} 배치 자동연장`] } : r;
    });
    return { rules };
  });
  const met = changes.filter(c => c.detail.includes('충족')).length;
  const unmet = changes.filter(c => c.detail.includes('미충족')).length;
  return { summary: `자격 유지 ${met} · 해지후보 ${unmet}`, changes };
},

batchRebind: () => {
  const before = new Map(useStore.getState().bindings.map((b) => [`${b.accountId}|${b.scopeKey}`, b.scheduleId]));
  set((s) => ({ bindings: allBindings(s) }));
  const after = useStore.getState().bindings;
  const changes: BatchChange[] = [];
  for (const b of after) {
    const key = `${b.accountId}|${b.scopeKey}`;
    const prev = before.get(key);
    if (prev !== b.scheduleId) changes.push({ label: `${b.accountId} ${b.scopeKey}`,
      detail: `${prev ?? '(신규)'} → ${b.scheduleId}` });
    before.delete(key);
  }
  return { summary: `바인딩 변경 ${changes.length}`, changes };
},

batchRevalidateDominance: () => {
  const s = useStore.getState();
  const res = revalidateDominance(s.rules, s.schedules, TODAY);
  const violations = res.filter((r) => !r.ok);
  const changes: BatchChange[] = res.map((r) => ({ label: r.rule.id,
    detail: r.ok ? `BASE 대비 전 구간 저렴 ✓` : `⚠ BASE보다 비싼 구간 존재` }));
  return { summary: `재검증 ${res.length} · 위반 ${violations.length}`, changes };
},
```
헬퍼 `extendOneYear(dateStr): string` — 문자열 연도 +1(예: `'2026-12-31'`→`'2027-12-31'`). Date 객체 금지, 문자열 조작으로. import 추가: `nudgeMetrics`, `classifyLifecycle`, `revalidateDominance`, `evalCondition`(이미), `BatchChange`/`BatchJobResult`, `NEW_LISTING_POOL`/`deriveProducts`/`SYNC_BATCH_SIZE`(이미 있음). State 인터페이스에 6개 액션 시그니처 추가.

- [ ] **Step 4: 통과 확인** — `npx vitest run` 전체 green(캐스케이드 테스트 포함), `npm run build` clean.

- [ ] **Step 5: 커밋** — `git commit -m "feat: 배치 잡 액션 6종 (발효·지표·동기화·협수·rebind·지배재검증)"`

---

### Task 5: 화면 BatchOps.tsx + 탭 + 스타일

**Files:**
- Create: `src/screens/BatchOps.tsx`
- Modify: `src/App.tsx`, `src/styles.css`(추가만)

**Interfaces:**
- Consumes: `useStore()`의 배치 액션 6종 + `reset`, `BatchJobResult`.

- [ ] **Step 1: 잡 정의 + 순차 실행** — BatchOps 컴포넌트. 잡 메타 배열(고정 순서):
```ts
const JOBS = [
  { key: 'lifecycle', title: '① 룰 발효/만료', run: 'batchActivateExpireRules' },
  { key: 'metrics',   title: '② 지표 재산정', run: 'batchRecomputeMetrics' },
  { key: 'sync',      title: '③ 종목 동기화', run: 'batchSyncInstruments' },
  { key: 'nego',      title: '④ 협수 조건 평가', run: 'batchEvalNegotiations' },
  { key: 'rebind',    title: '⑤ 바인딩 재계산', run: 'batchRebind' },
  { key: 'dominance', title: '⑥ 지배관계 재검증', run: 'batchRevalidateDominance' },
] as const;
```
state: `results: Record<string, BatchJobResult>`, `running: string | null`(현재 실행 중 key), `openKey: string | null`(드릴다운). `[배치 실행]` 클릭 시 async로 순서대로: `setRunning(key)` → 짧은 딜레이(`await new Promise(r => setTimeout(r, 400))`) → 액션 호출 → `results[key]=res` 저장. 마지막에 `setRunning(null)`. **주의:** zustand 액션은 `useStore.getState().<action>()`로 호출(순차 최신 상태 보장). `[초기화]` → `reset()` + results/running/openKey 리셋.

- [ ] **Step 2: 파이프라인 뷰 렌더** — JOBS를 카드로 세로 나열, 카드 사이에 트리거 화살표(`<div className="batch-arrow">↓</div>`). 각 카드 상태: 미실행(대기)/실행중(`.batch-running`)/완료(`.batch-done`) + 완료 시 `res.summary` 표시. 완료 카드 클릭 → `openKey` 토글.
- [ ] **Step 3: 드릴다운** — `openKey`인 잡의 `results[openKey].changes`를 미니 테이블(label/detail)로. 변경 0건이면 "변경 없음".
- [ ] **Step 4: 안내/빈 상태** — 실행 전 "배치 실행을 누르면 6개 잡이 순차로 돌며 실제 상태를 갱신합니다." 실행 후 "대시보드·계좌 조회·협수 관리가 실제로 갱신되었습니다(크로스스크린)." 문구.
- [ ] **Step 5: App.tsx 탭** — `import BatchOps from './screens/BatchOps';`, `TABS`에 `'배치 플로우'` 추가(위치: 마지막 권장), 렌더 라인 추가.
- [ ] **Step 6: styles.css 추가**(기존 규칙 수정 금지) — `.batch-step`/`.batch-running`/`.batch-done`/`.batch-arrow`/`.batch-summary` 등. 기존 팔레트·변수 확인해 톤 맞춤.
- [ ] **Step 7: 검증 & 커밋** — `npx vitest run` 유지 + `npm run build` clean + dev 서버에서 [배치 실행] → ①~⑥ 순차 진행, ④→⑤에서 A-1002 해외주식 협수 적용 확인, [초기화] 복구 확인, 대시보드 바인딩 수 변화 확인. `git commit -m "feat: 배치 플로우 화면(파이프라인+드릴다운)"`

---

### Task 6: README + 최종 검증

**Files:**
- Modify: `README.md`

- [ ] **Step 1** — 시연 시나리오에 "배치 플로우" 단계 추가: [배치 실행]로 6개 잡 순차 → 트리거 캐스케이드(② 지표 상승 → ④ A-1002 협수 자격 → ⑤ 바인딩 반영), 잡 클릭 드릴다운, 실제 store 변경(대시보드 갱신). v0.4 요약 문단 추가. 등급 pivot 없음·협수 자격=신청+조건 명시.
- [ ] **Step 2** — 설계 문서 목록에 v0.4 스펙 링크 추가. `npx vitest run` + `npm run build` + 시나리오 통주. `git commit -m "docs: v0.4 README"`

---

## Self-Review 결과

- 스펙 커버리지: §1 화면(파이프라인+드릴다운)→T5, §2 6개 잡→T4(+헬퍼 T1/T2), §3.2 rebind 분리→T4 설계원칙, §3.3 조건 게이트→T1, §3.4 시드→T3, §3.5 nudge→T2, §3.6 재검증→T2, §5 검증→각 태스크, §7 결정 반영(탭명/자격/시드/⑥). 누락 없음.
- 타입 일관성: `BatchJobResult`/`BatchChange` T3 정의 = T4/T5 소비. 배치 액션명 6종 T4 정의 = T5 JOBS.run 참조 동일.
- 주의(구현자): (1) T2 revalidateDominance는 `dominance.ts`의 **실제 dominates/probePrices 시그니처 확인 후** 구체화, binding.ts import 금지(순환). (2) T4 캐스케이드 테스트의 A-1002 해외주식 scopeKey는 마스터데이터 의존 — `scheduleId==='FS-NEGO-STOCK-US'`로 검증하되 A-1002가 해외주식 바인딩을 갖는지 먼저 확인. (3) 기존 66→70(T1) 이후 태스크마다 그린 유지, 기존 단언 무수정.
