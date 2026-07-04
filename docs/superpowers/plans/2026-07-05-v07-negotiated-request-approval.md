# v0.7 협의수수료 신청·승인 재설계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 협의수수료를 이벤트에서 분리해 "계좌 리스트 신청 → 상품군 기준 자격확인(+영업 bypass) → 요청 → 별도 탭 승인 → 활성 협의" 흐름으로 만든다.

**Architecture:** 별도 요청 엔티티 없이 협의(grant=`NegoException`)에 상태(요청/활성/반려)·자격 필드를 얹는다. 자격은 상품군별 표준 정책(`QualifyPolicy`)으로 판정. NEGOTIATED `FeeRule` 개념을 제거하고 해석의 nego 후보를 활성 grant로 한정한다.

**Tech Stack:** 기존 동일(Vite+React18+TS+zustand+Vitest). 신규 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-07-05-v07-negotiated-request-approval-design.md` **먼저 읽을 것**.

## Global Constraints

- UI 문구 전부 한국어. `src/domain/`은 React-free. 신규 의존성 금지.
- 결정성: `Math.random`/`Date.now`/인자 없는 `new Date()` 금지. 기준일 `TODAY='2026-07-04'`. 유효기간·승인일은 `TODAY`/`extendOneYear`.
- 계좌번호 12자리 숫자 문자열. 주식은 품목 차원 없음(feeKey=거래소·세션·채널), 파생만 품목.
- 각 태스크 완료 시 `npx vitest run` + `npm run build` green. 커밋 trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.
- 파급 큰 태스크(T4 mock 마이그레이션)는 NEGOTIATED 룰 전제를 다른 태스크에서 미리 제거한 뒤 실행.

## 파일 구조

```
src/domain/types.ts        # QualifyPolicy 추가 (T1)
src/domain/qualify.ts      # qualifyOf — 신규 (T1)
src/domain/resolve.ts      # NegoException 확장 + nego 활성만 + 오버레이 EVENT만 (T2)
src/domain/negoExtension.ts# classifyNegoExtension → grant+정책 재작성 (T3)
src/store/useStore.ts      # qualifyPolicies·submit/approve/reject·qualifyStatus, batchEval 제거 (T3,T4,T5)
src/store/mock.ts          # NEGOTIATED 룰·협의 가입이력 제거, 정책·grant·요청 시드 (T4)
src/screens/BatchOps.tsx   # 배치 ④ 제거 (T4)
src/screens/Wizard.tsx     # EVENT 전용(유형·조건 제거) (T6)
src/screens/NegoRequest.tsx# 협의 신청 — 신규 (T7)
src/screens/NegoApproval.tsx# 협의 승인 — 신규 (T8)
src/screens/Negotiated.tsx # 연장 리뷰 적응 (T9)
src/App.tsx                # 탭 추가: 협의 신청·협의 승인 (T7,T8)
```

---

### Task 1: 자격 정책 + qualifyOf (TDD)

**Files:** Modify `src/domain/types.ts`; Create `src/domain/qualify.ts`, `src/domain/qualify.test.ts`

**Interfaces (Produces):**
- `interface QualifyPolicy { assetClass: AssetClass; metric: NegotiatedCondition['metric']; threshold: number }`
- `qualifyOf(policies: QualifyPolicy[], assetClass: AssetClass, acct: Account): { met: boolean; policy: QualifyPolicy | null }`

- [ ] **Step 1: 타입 추가** — `src/domain/types.ts`의 `NegotiatedCondition` 정의 아래에:

```ts
export interface QualifyPolicy { assetClass: AssetClass; metric: NegotiatedCondition['metric']; threshold: number }
```

- [ ] **Step 2: 실패 테스트** — `src/domain/qualify.test.ts`:

```ts
import { it, expect, describe } from 'vitest';
import { qualifyOf } from './qualify';
import type { Account, QualifyPolicy } from './types';

const acct = (asset: number, vol = 0): Account =>
  ({ id: 'A', name: 'a', grade: 'GOLD', dormantReturned: false, metric6mAsset: asset, metric6mVolume: vol });
const pol: QualifyPolicy[] = [{ assetClass: '해외주식', metric: '6개월평균자산', threshold: 500_000_000 }];

describe('qualifyOf', () => {
  it('충족', () => { expect(qualifyOf(pol, '해외주식', acct(600_000_000)).met).toBe(true); });
  it('미충족', () => { expect(qualifyOf(pol, '해외주식', acct(400_000_000)).met).toBe(false); });
  it('정책 없으면 기준 없음 → met true, policy null', () => {
    const r = qualifyOf(pol, '국내주식', acct(0));
    expect(r.met).toBe(true); expect(r.policy).toBeNull();
  });
});
```

- [ ] **Step 3: 실패 확인** — `npx vitest run src/domain/qualify.test.ts` → FAIL(미정의)

- [ ] **Step 4: 구현** — `src/domain/qualify.ts`:

```ts
import type { Account, AssetClass, QualifyPolicy } from './types';

export function qualifyOf(policies: QualifyPolicy[], assetClass: AssetClass, acct: Account): { met: boolean; policy: QualifyPolicy | null } {
  const policy = policies.find((p) => p.assetClass === assetClass) ?? null;
  if (!policy) return { met: true, policy: null };
  const v = policy.metric === '6개월평균자산' ? acct.metric6mAsset : acct.metric6mVolume;
  return { met: v >= policy.threshold, policy };
}
```

- [ ] **Step 5: 통과 + 커밋** — `npx vitest run src/domain/qualify.test.ts` → PASS

```bash
git add src/domain/types.ts src/domain/qualify.ts src/domain/qualify.test.ts
git commit -m "feat: 협의 자격 정책(QualifyPolicy) + qualifyOf"
```

---

### Task 2: 협의(grant) 상태·자격 필드 확장 + 해석 정리

**Files:** Modify `src/domain/resolve.ts`, `src/store/mock.ts`, `src/store/useStore.ts`, `src/domain/resolve.test.ts`

**Interfaces (Produces):** 확장된 `NegoException`(아래). `resolve`의 nego 후보 = `status==='활성'`만. `buildScopeIndex` = `type==='EVENT'`만.

- [ ] **Step 1: NegoException 확장** — `src/domain/resolve.ts`의 인터페이스 교체:

```ts
export interface NegoException {
  accountId: string; scope: ScopeSelector; scheduleId: string;
  validFrom: string; validTo: string;
  status: '요청' | '활성' | '반려';
  qualify: '충족' | '예외';               // 예외 = 영업 bypass
  reason?: string;                        // bypass/반려 사유
  requestId: string;
  requestedBy: string; requestedAt: string;
  approvedAt?: string;
}
```

- [ ] **Step 2: 해석에 상태·유형 필터** — 같은 파일 `resolve`의 nego 루프와 `buildScopeIndex` 수정:

```ts
// buildScopeIndex
const overlays = rules.filter((r) => r.type === 'EVENT' && r.status === '활성');
```
```ts
// resolve nego 루프
for (const n of nego)
  if (n.accountId === acct.id && n.status === '활성' && n.validFrom <= today && today <= n.validTo && scopeMatchesKey(n.scope, key))
    cands.push({ rule: null, schedule: schedOf(n.scheduleId), source: 'nego' });
```

- [ ] **Step 3: 기존 grant 리터럴 갱신** — `src/store/mock.ts`의 `mockNego` 두 항목에 신규 필드 추가:

```ts
export const mockNego: NegoException[] = [
  { accountId: '110000001001',
    scope: { assetClass: '해외주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-NEGO-STOCK-US', validFrom: '2026-01-10', validTo: '2026-07-31',
    status: '활성', qualify: '충족', requestId: 'REQ-SEED-1', requestedBy: 'PB팀-오세훈', requestedAt: '2026-01-05', approvedAt: '2026-01-10' },
  { accountId: '110000001003',
    scope: { assetClass: '해외주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-NEGO-STOCK-US', validFrom: '2026-01-10', validTo: '2026-07-31',
    status: '활성', qualify: '충족', requestId: 'REQ-SEED-1', requestedBy: 'PB팀-오세훈', requestedAt: '2026-01-05', approvedAt: '2026-01-10' },
];
```

- [ ] **Step 4: 스토어 grant 푸시 갱신(임시 그린용)** — `src/store/useStore.ts`에서 `nego.push(...)` 두 곳(`batchEvalNegotiations`·`applyNegoExtension`)에 신규 필드 추가해 컴파일 유지. 예:

```ts
nego.push({ accountId: c.accountId, scope: rule.scope, scheduleId: rule.scheduleId, validFrom: TODAY, validTo: extendOneYear(rule.endDate),
  status: '활성', qualify: '충족', requestId: `LEGACY-${c.accountId}`, requestedBy: '배치', requestedAt: TODAY, approvedAt: TODAY });
```
(batchEvalNegotiations의 push도 동일 패턴으로. 이 두 액션은 T4에서 제거/대체되나, 여기선 컴파일 그린만 유지.)

- [ ] **Step 5: resolve 테스트 갱신 + 요청 grant 무시 케이스** — `src/domain/resolve.test.ts`의 nego 리터럴 두 곳(`describe('resolve', ...)`)에 신규 필드 추가하고, 요청 상태 무시 테스트 추가. nego 리터럴 예:

```ts
const nego: NegoException[] = [{ accountId: acct.id, scope: scope({ channels: '*' }), scheduleId: 'S-NEGO', validFrom: '2026-01-01', validTo: '2026-12-31',
  status: '활성', qualify: '충족', requestId: 'R1', requestedBy: 't', requestedAt: '2026-01-01' }];
```
추가 테스트(`describe('resolve', ...)` 안):

```ts
it('요청/반려 상태 grant는 해석에서 제외', () => {
  const nego: NegoException[] = [{ accountId: acct.id, scope: scope({ channels: '*' }), scheduleId: 'S-NEGO', validFrom: '2026-01-01', validTo: '2026-12-31',
    status: '요청', qualify: '충족', requestId: 'R1', requestedBy: 't', requestedAt: '2026-01-01' }];
  const r = resolve(acct, key({ channel: 'MTS' }), [base, evt], schedules, nego, idx(), '2026-07-04', []);
  expect(r!.source).toBe('event');   // 요청 grant 무시 → 이벤트가 승자
});
```
(schedules에 S-NEGO(sched('S-NEGO', 30)) 이미 있음. 없으면 추가.)

- [ ] **Step 6: 실행** — `npx vitest run` → green(기존 nego 관련 테스트가 새 필드로 통과), `npm run build` → green

- [ ] **Step 7: 커밋**

```bash
git add src/domain/resolve.ts src/store/mock.ts src/store/useStore.ts src/domain/resolve.test.ts
git commit -m "feat: 협의 grant 상태·자격 필드 확장 + 해석은 활성 grant·EVENT 오버레이만"
```

---

### Task 3: 연장 리뷰를 grant+정책 기반으로 재작성

**Files:** Modify `src/domain/negoExtension.ts`, `src/domain/negoExtension.test.ts`, `src/store/useStore.ts`

**Interfaces (Produces):**
- `classifyNegoExtension(nego: NegoException[], accounts: Account[], policies: QualifyPolicy[]): ExtGroup[]` — 시그니처 변경(rules·enrollments 제거).
- `ExtStatus = '유지' | '탈락'` (신규 제거 — 신규는 신청 흐름).
- store: `qualifyPolicies: QualifyPolicy[]` 상태 추가, `reviewNegoExtension`/`applyNegoExtension`가 새 시그니처 사용.

- [ ] **Step 1: negoExtension.ts 재작성** — 활성 grant를 상품군(주식)/품목(파생)로 묶고 정책 재평가:

```ts
import type { Account, QualifyPolicy } from './types';
import type { NegoException } from './resolve';
import { isDerivative } from './feeKey';
import { qualifyOf } from './qualify';

export type ExtStatus = '유지' | '탈락';
export interface ExtCandidate { accountId: string; accountName: string; status: ExtStatus; detail: string }
export interface ExtGroup { axis: '상품군' | '품목'; groupKey: string; endDate: string; candidates: ExtCandidate[]; counts: { 유지: number; 탈락: number } }

export function classifyNegoExtension(nego: NegoException[], accounts: Account[], policies: QualifyPolicy[]): ExtGroup[] {
  const active = nego.filter((n) => n.status === '활성');
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const groups = new Map<string, ExtGroup>();
  for (const g of active) {
    const acct = acctById.get(g.accountId);
    if (!acct) continue;
    const ac = g.scope.assetClass;
    const deriv = isDerivative(ac);
    const axis: '상품군' | '품목' = deriv ? '품목' : '상품군';
    const groupKey = deriv ? (g.scope.products === '*' ? `${ac} 전체 품목` : (g.scope.products as string[]).join(',')) : ac;
    const key = `${axis}:${groupKey}`;
    // 예외(영업 bypass) 건은 유지(수동 검토), 그 외는 정책 재평가
    const met = qualifyOf(policies, ac, acct).met;
    const status: ExtStatus = g.qualify === '예외' ? '유지' : (met ? '유지' : '탈락');
    const detail = g.qualify === '예외' ? '영업예외(수동 검토)' : (met ? '자격 충족' : '자격 미충족 → 해지 대상');
    const grp = groups.get(key) ?? { axis, groupKey, endDate: g.validTo, candidates: [], counts: { 유지: 0, 탈락: 0 } };
    grp.candidates.push({ accountId: g.accountId, accountName: acct.name, status, detail });
    grp.counts[status] += 1;
    groups.set(key, grp);
  }
  return [...groups.values()];
}
```

- [ ] **Step 2: negoExtension.test.ts 재작성** — grant+정책 픽스처로:

```ts
import { it, expect, describe } from 'vitest';
import { classifyNegoExtension } from './negoExtension';
import type { Account, QualifyPolicy, ScopeSelector } from './types';
import type { NegoException } from './resolve';

const acct = (id: string, name: string, asset: number): Account =>
  ({ id, name, grade: 'GOLD', dormantReturned: false, metric6mAsset: asset, metric6mVolume: 0 });
const scope = (over: Partial<ScopeSelector> = {}): ScopeSelector =>
  ({ assetClass: '해외주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [], ...over });
const grant = (accountId: string, over: Partial<NegoException> = {}): NegoException =>
  ({ accountId, scope: scope(), scheduleId: 'S', validFrom: '2026-01-01', validTo: '2026-07-31',
    status: '활성', qualify: '충족', requestId: 'R', requestedBy: 't', requestedAt: '2026-01-01', ...over });
const pol: QualifyPolicy[] = [{ assetClass: '해외주식', metric: '6개월평균자산', threshold: 500_000_000 }];

describe('classifyNegoExtension', () => {
  const accounts = [acct('A', '유지', 800_000_000), acct('B', '탈락', 30_000_000), acct('C', '예외', 10_000_000)];
  it('충족 유지 / 미충족 탈락 / 예외 유지', () => {
    const nego = [grant('A'), grant('B'), grant('C', { qualify: '예외', reason: '영업' })];
    const g = classifyNegoExtension(nego, accounts, pol);
    const byId = Object.fromEntries(g[0].candidates.map((c) => [c.accountId, c.status]));
    expect(byId).toEqual({ A: '유지', B: '탈락', C: '유지' });
    expect(g[0].counts).toEqual({ 유지: 2, 탈락: 1 });
  });
  it('파생은 품목 축', () => {
    const dg = classifyNegoExtension([grant('A', { scope: scope({ assetClass: '해외파생', products: ['6A'] }) })], [acct('A', 'a', 0)], []);
    expect(dg[0].axis).toBe('품목'); expect(dg[0].groupKey).toBe('6A');
  });
});
```

- [ ] **Step 3: store 갱신** — `src/store/useStore.ts`:
  - import: `import { classifyNegoExtension, type ExtGroup } from '../domain/negoExtension';` 유지. `import { qualifyOf } from '../domain/qualify';`, `import type { QualifyPolicy } from '../domain/types';` 추가.
  - State에 `qualifyPolicies: QualifyPolicy[];` 추가, `reset`/초기화에 `qualifyPolicies: mockQualifyPolicies`(T4에서 시드) — T3에서는 우선 빈 배열 `[]`로 두고 T4에서 시드 연결. (그린 유지)
  - `reviewNegoExtension`을 `classifyNegoExtension(s.nego, s.accounts, s.qualifyPolicies)`로.
  - `applyNegoExtension`을 유지=연장(validTo=extendOneYear(TODAY))·탈락=해지(status '반려' 또는 제거)로 재작성:

```ts
applyNegoExtension: (): { summary: string; 유지: number; 탈락: number } => {
  const s0 = useStore.getState();
  const groups = classifyNegoExtension(s0.nego, s0.accounts, s0.qualifyPolicies);
  const 유지Ids = new Set<string>(); const 탈락Ids = new Set<string>();
  for (const g of groups) for (const c of g.candidates) (c.status === '유지' ? 유지Ids : 탈락Ids).add(c.accountId);
  set((s) => ({
    nego: s.nego.map((n) => n.status === '활성' && 유지Ids.has(n.accountId) ? { ...n, validTo: extendOneYear(TODAY) }
      : n.status === '활성' && 탈락Ids.has(n.accountId) ? { ...n, status: '반려' as const, reason: '연장 자격 미충족' } : n),
  }));
  유지Ids.forEach((id) => resolveCache.invalidateAccount(id));
  탈락Ids.forEach((id) => resolveCache.invalidateAccount(id));
  return { summary: `연장(유지) ${유지Ids.size} · 해지(탈락) ${탈락Ids.size}`, 유지: 유지Ids.size, 탈락: 탈락Ids.size };
},
```
  - 인터페이스 시그니처(`applyNegoExtension(): { summary; 유지; 탈락 }`)도 State에서 갱신.

- [ ] **Step 4: 실행** — `npx vitest run` → green(negoExtension.test 신규판 통과). 기존 useStore.test의 협의 연장 테스트(신규/유지/탈락 단언)는 T4에서 갱신 예정이라 **여기서 임시 실패 가능** → 그 테스트를 유지/탈락만 단언하도록 이 스텝에서 함께 갱신:

```ts
// useStore.test.ts '협의수수료 연장 리뷰/적용' describe 갱신
it('리뷰가 활성 grant를 상품군 기준으로 유지/탈락 분류', () => {
  const groups = useStore.getState().reviewNegoExtension();
  const stockG = groups.find(g => g.groupKey === '해외주식');
  expect(stockG).toBeTruthy();
});
```
(구체 단언은 T4의 mock 시드 확정 후 강화. 여기선 시그니처·형태만 통과.)

- [ ] **Step 5: 커밋**

```bash
git add src/domain/negoExtension.ts src/domain/negoExtension.test.ts src/store/useStore.ts src/store/useStore.test.ts
git commit -m "feat: 연장 리뷰를 활성 grant+자격정책 기반(유지/탈락)으로 재작성"
```

---

### Task 4: mock 마이그레이션 + 배치 ④ 제거

**Files:** Modify `src/store/mock.ts`, `src/store/useStore.ts`, `src/screens/BatchOps.tsx`, 관련 테스트(`src/store/useStore.test.ts`, `src/e2e-workflow.test.ts`, `src/screens/wizard.test.ts` 등)

- [ ] **Step 1: NEGOTIATED 룰·협의 가입이력 제거** — `src/store/mock.ts`:
  - `mockRules`에서 `RULE-NEGO-STOCK-US`, `RULE-NEGO-DERIV-CME` 삭제.
  - `mockEnrollments`에서 `ruleId: 'RULE-NEGO-STOCK-US'`/`'RULE-NEGO-DERIV-CME'` 항목 전부 삭제(이벤트 SIGNUP2M 가입형만 남김).

- [ ] **Step 2: 자격 정책·grant·요청 시드** — `src/store/mock.ts`에 추가/보강:

```ts
import type { Account, FeeSchedule, FeeRule, Enrollment, QualifyPolicy } from '../domain/types';

export const mockQualifyPolicies: QualifyPolicy[] = [
  { assetClass: '해외주식', metric: '6개월평균자산', threshold: 500_000_000 },
  { assetClass: '해외파생', metric: '6개월약정액', threshold: 100_000_000 },
];
```
`mockNego`(T2에서 001·003 활성) 유지 + 004 해외파생 활성 grant + 002 요청(bypass) 추가:

```ts
  { accountId: '110000001004',
    scope: { assetClass: '해외파생', exchanges: ['CME'], sessions: '*', channels: '*', currencies: '*', products: ['6A'], excludeProducts: [] },
    scheduleId: 'FS-NEGO-DERIV-CME', validFrom: '2026-02-01', validTo: '2026-08-15',
    status: '활성', qualify: '충족', requestId: 'REQ-SEED-2', requestedBy: 'PB팀', requestedAt: '2026-01-30', approvedAt: '2026-02-01' },
  { accountId: '110000001002',
    scope: { assetClass: '해외주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-NEGO-STOCK-US', validFrom: '', validTo: '',
    status: '요청', qualify: '예외', reason: '영업상 우대 필요(자산 4.9억)', requestId: 'REQ-PENDING-1', requestedBy: 'PB팀-오세훈', requestedAt: '2026-07-03' },
```
(003 grant는 자산 3천만 → 연장 리뷰에서 탈락 시연. 002는 요청 상태 → 승인 화면 시연.)

- [ ] **Step 3: store에 정책 연결 + 배치 ④ 제거** — `src/store/useStore.ts`:
  - import에 `mockQualifyPolicies` 추가, `reset`/store 초기화에서 `qualifyPolicies: mockQualifyPolicies`(T3의 `[]` 대체).
  - `batchEvalNegotiations` 액션·State 시그니처 삭제.

- [ ] **Step 4: 배치 ④ 카드 제거** — `src/screens/BatchOps.tsx`의 job 배열에서 `{ key: 'nego', title: '④ 협수 조건 평가', ... }` 삭제(나머지 번호는 그대로 두거나 재정렬).

- [ ] **Step 5: 테스트 갱신**:
  - `src/store/useStore.test.ts`: `batchEvalNegotiations` 테스트 블록(④ 협수 grant 평가, ②→④→재해석 캐스케이드) 삭제 또는 승인 기반으로 대체. 협의 연장 테스트를 새 mock으로 강화:

```ts
it('리뷰: 003(자산 3천만) 탈락, 001 유지', () => {
  const groups = useStore.getState().reviewNegoExtension();
  const stockG = groups.find(g => g.groupKey === '해외주식')!;
  const byId = Object.fromEntries(stockG.candidates.map(c => [c.accountId, c.status]));
  expect(byId['110000001001']).toBe('유지');
  expect(byId['110000001003']).toBe('탈락');
});
```
  - `src/e2e-workflow.test.ts`: NEGOTIATED 룰 전제 부분 있으면 제거/갱신(대부분 CME 이벤트라 무관 예상 — 실패 시 해당 단언 갱신).

- [ ] **Step 6: 실행** — `npx vitest run` → green, `npm run build` → green

- [ ] **Step 7: 커밋**

```bash
git add src/store/mock.ts src/store/useStore.ts src/screens/BatchOps.tsx src/store/useStore.test.ts src/e2e-workflow.test.ts
git commit -m "refactor: NEGOTIATED 룰·협의 가입이력 제거, 자격정책·grant·요청 시드, 배치 ④ 제거"
```

---

### Task 5: 협의 신청·승인 스토어 액션 (TDD)

**Files:** Modify `src/store/useStore.ts`, `src/store/useStore.test.ts`

**Interfaces (Produces):**
```ts
qualifyStatus(assetClass: AssetClass, accountId: string): { met: boolean; policy: QualifyPolicy | null };
submitNegoRequest(input: { accountIds: string[]; scope: ScopeSelector; scheduleId: string; bypass: Record<string,string>; requestedBy: string }): { requestId: string; requested: number };
approveNegoRequest(requestId: string): { activated: number };
rejectNegoRequest(requestId: string, reason: string): void;
```

- [ ] **Step 1: 실패 테스트** — `src/store/useStore.test.ts`에 추가:

```ts
describe('협의 신청·승인', () => {
  beforeEach(() => useStore.getState().reset());
  const usScope = { assetClass: '해외주식' as const, exchanges: '*' as const, sessions: '*' as const, channels: '*' as const, currencies: '*' as const, products: '*' as const, excludeProducts: [] };

  it('신청 → 요청 grant 생성(해석 불변), 승인 → 활성화', () => {
    const s = useStore.getState();
    const { requestId, requested } = s.submitNegoRequest({ accountIds: ['110000001001'], scope: usScope, scheduleId: 'FS-NEGO-STOCK-US', bypass: {}, requestedBy: 'PB' });
    expect(requested).toBe(1);
    // 요청 상태라 해석엔 영향 없음: 001 해외주식은 기존 활성 grant로 이미 nego (seed) — 요청 건은 별개
    expect(useStore.getState().nego.some(n => n.requestId === requestId && n.status === '요청')).toBe(true);
    useStore.getState().approveNegoRequest(requestId);
    expect(useStore.getState().nego.some(n => n.requestId === requestId && n.status === '활성' && n.approvedAt)).toBe(true);
  });

  it('미충족 계좌는 bypass 사유로 예외 요청', () => {
    const s = useStore.getState();
    const { requestId } = s.submitNegoRequest({ accountIds: ['110000001002'], scope: usScope, scheduleId: 'FS-NEGO-STOCK-US', bypass: { '110000001002': '영업 필요' }, requestedBy: 'PB' });
    const g = useStore.getState().nego.find(n => n.requestId === requestId)!;
    expect(g.qualify).toBe('예외'); expect(g.reason).toBe('영업 필요');
  });

  it('반려', () => {
    const s = useStore.getState();
    const { requestId } = s.submitNegoRequest({ accountIds: ['110000001001'], scope: usScope, scheduleId: 'FS-NEGO-STOCK-US', bypass: {}, requestedBy: 'PB' });
    s.rejectNegoRequest(requestId, '검토 보류');
    expect(useStore.getState().nego.every(n => n.requestId !== requestId || n.status === '반려')).toBe(true);
  });
});
```

- [ ] **Step 2: 구현** — `src/store/useStore.ts`에 액션 추가(및 State 시그니처). requestId는 결정적으로: `REQ-${TODAY}-${nego.length}` 등 카운터 기반(Date.now 금지):

```ts
qualifyStatus: (assetClass, accountId) => {
  const s = useStore.getState();
  const acct = s.accounts.find((a) => a.id === accountId);
  if (!acct) return { met: false, policy: null };
  return qualifyOf(s.qualifyPolicies, assetClass, acct);
},
submitNegoRequest: (input) => {
  const s0 = useStore.getState();
  const requestId = `REQ-${TODAY}-${s0.nego.length + 1}`;
  const rows: NegoException[] = input.accountIds.map((id) => {
    const acct = s0.accounts.find((a) => a.id === id);
    const met = acct ? qualifyOf(s0.qualifyPolicies, input.scope.assetClass, acct).met : false;
    const bypassReason = input.bypass[id];
    return {
      accountId: id, scope: input.scope, scheduleId: input.scheduleId, validFrom: '', validTo: '',
      status: '요청', qualify: met ? '충족' : '예외', reason: met ? undefined : bypassReason,
      requestId, requestedBy: input.requestedBy, requestedAt: TODAY,
    };
  });
  set((s) => ({ nego: [...s.nego, ...rows] }));
  return { requestId, requested: rows.length };
},
approveNegoRequest: (requestId) => {
  let activated = 0;
  set((s) => ({
    nego: s.nego.map((n) => {
      if (n.requestId !== requestId || n.status !== '요청') return n;
      activated += 1;
      return { ...n, status: '활성' as const, validFrom: TODAY, validTo: extendOneYear(TODAY), approvedAt: TODAY };
    }),
  }));
  useStore.getState().nego.filter((n) => n.requestId === requestId).forEach((n) => resolveCache.invalidateAccount(n.accountId));
  return { activated };
},
rejectNegoRequest: (requestId, reason) => set((s) => ({
  nego: s.nego.map((n) => n.requestId === requestId && n.status === '요청' ? { ...n, status: '반려' as const, reason } : n),
})),
```

- [ ] **Step 3: 실행 + 커밋** — `npx vitest run` → green, `npm run build` → green

```bash
git add src/store/useStore.ts src/store/useStore.test.ts
git commit -m "feat: 협의 신청/승인/반려 스토어 액션 + 자격 판정"
```

---

### Task 6: 이벤트 위저드 EVENT 전용화

**Files:** Modify `src/screens/Wizard.tsx`

- [ ] **Step 1: 유형 고정** — `WizardForm.type`를 `'EVENT'`만 쓰도록: `type` 필드 제거하거나 항상 `'EVENT'`. 초기값 `type: 'EVENT'` 유지. `condMetric/condThreshold/condAction` 필드와 사용처 제거.
- [ ] **Step 2: UI 제거** — `renderStep1`의 유형 select(396–399행 부근)와 협의 조건 블록(`form.type === 'NEGOTIATED'` 조건 렌더 441–) 삭제. 상신 룰 조립의 `condition`(357–358행) 제거(항상 `type: 'EVENT'`, `condition: undefined`).
- [ ] **Step 3: 실행 + 커밋** — `npx vitest run`(wizard.test 갱신 필요 시)·`npm run build` green

```bash
git add src/screens/Wizard.tsx src/screens/wizard.test.ts
git commit -m "refactor: 이벤트 등록 위저드 EVENT 전용(협의 유형·조건 제거)"
```

---

### Task 7: 협의 신청 화면 + 탭

**Files:** Create `src/screens/NegoRequest.tsx`; Modify `src/App.tsx`

- [ ] **Step 1: 화면 구현** — `NegoRequest.tsx`. 구성:
  - 적용범위: 상품군 select + (주식) 거래소 체크 / (파생) 품목 입력 — 최소한 상품군·거래소·세션·채널. (위저드의 축 로직을 참고하되 간단화: 상품군·거래소·세션·채널·(파생)품목 입력)
  - 요율표: `schedules` 중 협의 요율표(id 접두 `FS-NEGO`)를 select로 고른 뒤 구성요소를 편집 가능(편집 시 새 id `FS-NEGO-{requestId 후보}`로 복제해 `submitRule` 없이 로컬 보관 → 신청 시 그 schedule을 store에 추가). 간단화를 위해 편집은 자사 rateBp 하나만 수정 가능하게 시작해도 됨(스펙: 선택+수정).
  - 계좌번호 리스트: textarea(붙여넣기) → `parseCsvCodes(text, new Set(accounts.map(a=>a.id)))`로 검증. 각 인식 계좌에 대해 `qualifyStatus(assetClass, id)`로 충족/미충족 표 표시. 미충족 행에 bypass 체크+사유 입력.
  - [협수 요청] → `submitNegoRequest({ accountIds, scope, scheduleId, bypass, requestedBy: '현업' })`. 성공 시 "요청 N건 접수" 안내.
  - 요율표 편집으로 복제 생성이 필요하면, 신청 직전에 새 schedule을 store에 추가하는 액션(`addSchedule`)이 필요 — 없으면 `submitRule` 대신 간단한 `addSchedule(schedule)` 스토어 액션 추가(요율표만 등록). 최소 구현: 표준 요율표 그대로 사용(수정 없이) + "수정" 토글은 후속.
- [ ] **Step 2: 탭 등록** — `src/App.tsx` `TABS`에 `'협의 신청'` 추가, import + `{tab === '협의 신청' && <NegoRequest />}`.
- [ ] **Step 3: 실행 + 브라우저 확인 + 커밋** — 계좌 `110000001002`(미충족)로 bypass 요청, 승인 화면에 뜨는지(T8 후) 확인. `npm run build` green

```bash
git add src/screens/NegoRequest.tsx src/App.tsx
git commit -m "feat: 협의 신청 화면(적용범위·요율표·계좌 리스트·자격판정·bypass)"
```

---

### Task 8: 협의 승인 화면 + 탭

**Files:** Create `src/screens/NegoApproval.tsx`; Modify `src/App.tsx`

- [ ] **Step 1: 화면 구현** — `NegoApproval.tsx`:
  - `nego`에서 `status === '요청'`을 `requestId`로 그룹핑. 그룹마다 카드: 적용범위·요율표명·신청자·신청일 + **계좌번호 목록**(각 계좌 `qualify` 배지: 충족/영업예외 + 사유).
  - [승인] → `approveNegoRequest(requestId)`, [반려] → 사유 입력 후 `rejectNegoRequest(requestId, reason)`.
  - 요청 없으면 "대기 중인 협의 요청이 없습니다."
- [ ] **Step 2: 탭 등록** — `src/App.tsx` `TABS`에 `'협의 승인'` 추가 + 렌더.
- [ ] **Step 3: 실행 + 브라우저 확인 + 커밋** — mock의 요청(002 bypass)이 카드로 뜨고 승인 시 활성화 → 계좌 조회/결정 흐름에서 협의 반영 확인.

```bash
git add src/screens/NegoApproval.tsx src/App.tsx
git commit -m "feat: 협의 승인 화면(요청 건별 계좌·자격 표시, 승인/반려)"
```

---

### Task 9: 협수 관리(연장 리뷰) 화면 적응

**Files:** Modify `src/screens/Negotiated.tsx`

- [ ] **Step 1: 연장 리뷰 갱신** — `reviewNegoExtension()`의 새 `ExtGroup`(유지/탈락 counts, 예외 detail) 형태에 맞게 표 렌더 수정. "신규" 컬럼 제거, "유지/탈락" + 예외 detail 표기. `applyNegoExtension()` 결과 문구(`유지/탈락`) 반영.
- [ ] **Step 2: 활성 협의 현황** — 기존 enrollment 기반 표를 `nego`(status '활성') 기반으로 교체: 계좌·적용범위·요율표·유효기간·자격/예외.
- [ ] **Step 3: 실행 + 브라우저 확인 + 커밋** — 연장 리뷰에 003 탈락·001 유지, 승인 반영. `npm run build` green

```bash
git add src/screens/Negotiated.tsx
git commit -m "feat: 협수 관리 — 활성 협의 현황 + 연장 리뷰(유지/탈락) 적응"
```

---

## Self-Review 결과

- **스펙 커버리지:** 자격정책·qualifyOf→T1 · grant 상태·자격 확장·해석 정리→T2 · 연장 리뷰 재작성→T3 · mock 마이그레이션·배치④ 제거→T4 · 신청/승인/반려 스토어→T5 · 위저드 EVENT 전용→T6 · 협의 신청 화면→T7 · 협의 승인 화면→T8 · 협수 관리 적응→T9. 범위 밖(자격정책 UI·부분승인·시간만료)은 태스크 없음(의도).
- **타입 일관성:** `NegoException` 확장(T2)=mock/스토어/화면(T2~T9). `QualifyPolicy`/`qualifyOf`(T1)=classify(T3)·store(T3,T5). `classifyNegoExtension(nego,accounts,policies)`(T3)=store 호출(T3). submit/approve/reject 시그니처(T5)=화면(T7,T8).
- **그린 유지 전략:** NEGOTIATED 룰 제거(T4)를 classify 재작성(T3) 이후에 배치. grant 필드 확장(T2)에서 전 리터럴·푸시 동시 갱신. batchEvalNegotiations는 T2에서 임시 필드 채우고 T4에서 제거.
- **결정성:** requestId·유효기간은 카운터/TODAY/extendOneYear. Date.now/argless new Date 미사용.
- **위험:** T4가 최대 파급(mock·배치·e2e). T7의 요율표 "수정 시 복제"는 최소구현(표준 그대로)으로 시작하고 편집은 후속 여지 — 스펙의 "선택+수정" 중 선택을 먼저 보장.
