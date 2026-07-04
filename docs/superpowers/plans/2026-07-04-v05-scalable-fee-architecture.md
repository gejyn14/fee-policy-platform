# v0.5 규모 대응 수수료 아키텍처 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전량 materialize(계좌×품목)를 폐기하고 **해석형 코어**(feeKey 가변 입도 + `resolve(nego→event→base 최저가)` + scope_index + read-through 캐시 + 증분 무효화)로 전환. 화면(수수료 결정 흐름·계좌 조회·배치 플로우·위저드)을 resolve/캐시 기반으로 이관.

**Architecture:** feeKey는 상품군별 가변 입도(주식=거래소·세션·채널 / 파생=+품목). 룰은 저장하고 체결 시점에 해석하며, 진짜 예외(협의)만 계좌 인덱스 overlay. 읽기 지연은 (계좌,feeKey) read-through 캐시로 유지, 변경은 증분 무효화. 스펙: `docs/superpowers/specs/2026-07-04-v05-scalable-fee-architecture-design.md` **먼저 읽을 것**.

**Tech Stack:** 기존 동일(Vite+React18+TS+zustand+Vitest). 신규 의존성 금지.

## Global Constraints

- UI 문구 전부 한국어. `src/domain/`은 React-free. 신규 의존성 금지. 등급 pivot 없음(v0.3.1 연속).
- 결정성: `Math.random`/`Date.now`/인자 없는 `new Date()` 금지. 기준일 `TODAY='2026-07-04'`. `computedAt`/무효화 시각은 단조 카운터(모듈 정수 tick)로 표현(시간 대신). 
- 계좌번호는 **12자리 숫자 문자열**(예: `'110234567890'`). 기존 `A-1001` 형식 전면 폐기.
- 차원 값: 세션 {프리, 정규, 애프터}, 거래소 {KRX, NXT}(해외는 시장 확장), 채널 {HTS, MTS, API, ARS, 센터, 반대매매}.
- feeKey 입도: **주식=거래소·세션·채널**, **파생=거래소·세션·채널·품목**. (금현물은 파생과 동일하게 품목 유지 or 주식형 — mock 단순화를 위해 주식형(품목 붕괴)으로 둔다.)
- 각 태스크 완료 시 `npx vitest run` + `npm run build` green. 커밋 trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.
- 이건 v0.4 코어(rebindAccount/rebindAll)를 **대체**하는 작업 — 기존 테스트 중 전량 바인딩을 전제한 것은 resolve 기반으로 **재작성**(단, 도메인 계산 불변식은 유지). 어떤 기존 단언을 바꾸는지는 각 태스크에 명시.
- 브랜치: `feature/v0.5-scalable-fee-architecture` (v0.4는 태그 `v0.4-complete`로 롤백 지점 확보).

## 파일 구조

```
src/domain/types.ts        # channel 추가(Execution/ScopeSelector), FeeKey, 계좌 12자리 (T1)
src/domain/feeKey.ts       # deriveFeeKey, feeKeyString, isDerivative — 신규 (T1)
src/domain/mock 관련 → src/store/mock.ts  # 4상품군 표준 요율표·차원·12자리 재구성 (T2)
src/domain/resolve.ts      # scopeMatchesKey, buildScopeIndex, resolve — 신규 (T3,T4)
src/domain/cache.ts        # ResolveCache(read-through + 무효화) — 신규 (T5)
src/store/useStore.ts      # resolve/cache/scope_index/nego 통합, rebindAll 폐기, 배치 증분무효화 (T6)
src/screens/FeeTrace.tsx   # resolve 기반(feeKey 입력·후보·캐시 적중/미스) (T7)
src/screens/AccountView.tsx# resolve 기반 + nego 예외 목록 (T8)
src/screens/BatchOps.tsx   # 증분 무효화 시연 (T8)
src/screens/Wizard.tsx     # scope에 채널 + dimension-relevance(파생만 품목) (T9)
src/screens/Dashboard.tsx  # 지표 적응(캐시/nego 기반) (T9)
README.md                  # v0.5 시연 시나리오 (T10)
```

---

### Task 1: feeKey · channel · 12자리 계좌 (타입 + 순수 헬퍼, TDD)

**Files:** Create `src/domain/feeKey.ts`; Modify `src/domain/types.ts`; Test `src/domain/feeKey.test.ts`

**Interfaces (Produces):**
```ts
// types.ts 추가/변경
export type Session = '프리' | '정규' | '애프터';
export type Channel = 'HTS' | 'MTS' | 'API' | 'ARS' | '센터' | '반대매매';
export interface Execution { accountId: string; product: Product; session: Session; channel: Channel; price: number; qty: number; notional: number }
export interface ScopeSelector { assetClass: AssetClass; exchanges: string[] | '*'; sessions: Session[] | '*'; channels: Channel[] | '*'; currencies: string[] | '*'; products: string[] | '*'; excludeProducts: string[] }
export interface FeeKey { assetClass: AssetClass; exchange: string; session: Session; channel: Channel; product: string | null } // product: 파생만, 주식 null

// feeKey.ts
export function isDerivative(a: AssetClass): boolean;           // '국내파생' | '해외파생' → true
export function deriveFeeKey(product: Product, session: Session, channel: Channel): FeeKey;
export function feeKeyString(k: FeeKey): string;                // `${assetClass}|${exchange}|${session}|${channel}` (+ `|${product}` if 파생)
```

- [ ] **Step 1**: types.ts에 `Session`/`Channel` 유니온 추가, `Execution`에 `channel` 추가, `ScopeSelector`에 `channels` + `sessions` 타입을 `Session[]|'*'`로, `FeeKey` 추가. (기존 `sessions: string[]|'*'`였던 것을 `Session[]|'*'`로.)
- [ ] **Step 2 (실패 테스트)** `src/domain/feeKey.test.ts`:
```ts
import { it, expect, describe } from 'vitest';
import { deriveFeeKey, feeKeyString, isDerivative } from './feeKey';
import type { Product } from './types';
const stock: Product = { assetClass: '국내주식', exchange: 'KRX', code: '005930', name: '삼성전자', currency: 'KRW', sessions: ['정규'] };
const deriv: Product = { assetClass: '해외파생', exchange: 'CME', code: '6A', name: 'AUD', currency: 'USD', sessions: ['야간'] as never };

describe('feeKey', () => {
  it('주식은 품목이 붕괴(null)', () => {
    const k = deriveFeeKey(stock, '정규', 'MTS');
    expect(k.product).toBeNull();
    expect(feeKeyString(k)).toBe('국내주식|KRX|정규|MTS');
  });
  it('파생은 품목 유지', () => {
    const k = deriveFeeKey(deriv, '정규', 'HTS');
    expect(k.product).toBe('6A');
    expect(feeKeyString(k)).toBe('해외파생|CME|정규|HTS|6A');
  });
  it('isDerivative', () => {
    expect(isDerivative('국내파생')).toBe(true);
    expect(isDerivative('국내주식')).toBe(false);
  });
});
```
- [ ] **Step 3**: 실패 확인 → 구현:
```ts
import type { AssetClass, Channel, FeeKey, Product, Session } from './types';
export function isDerivative(a: AssetClass): boolean { return a === '국내파생' || a === '해외파생'; }
export function deriveFeeKey(product: Product, session: Session, channel: Channel): FeeKey {
  return { assetClass: product.assetClass, exchange: product.exchange, session, channel,
    product: isDerivative(product.assetClass) ? product.code : null };
}
export function feeKeyString(k: FeeKey): string {
  const base = `${k.assetClass}|${k.exchange}|${k.session}|${k.channel}`;
  return k.product ? `${base}|${k.product}` : base;
}
```
- [ ] **Step 4**: `npx vitest run` — 이 시점엔 다른 도메인/스토어 파일이 아직 새 타입에 안 맞아 **컴파일/테스트가 깨질 수 있음**. T1은 types+feeKey만 커밋하되, 만약 타입 변경으로 광범위 에러가 나면 T1 범위를 "feeKey.ts + 타입 추가(기존 필드 유지, 신규는 optional로)"로 최소화하고, 파괴적 시그니처 변경(Execution.channel 필수화 등)은 T2/T3에서 소비처와 함께 전환. **구현자 판단**: 우선 신규 타입 추가 + feeKey.ts로 그린 유지, Execution.channel은 우선 `channel?: Channel` optional로 도입 후 T3에서 필수화. 테스트 그린 + build 통과 상태로 커밋.
- [ ] **Step 5 커밋**: `feat: feeKey 가변입도 + channel/session 타입 + 계좌 12자리 준비`

---

### Task 2: 4상품군 표준 요율표 + mock 전면 재구성 (12자리 계좌·차원)

**Files:** Modify `src/store/mock.ts` (+ 필요 시 `src/store/baseSchedules.ts` 분리)

**핵심:** 계좌 12자리, 4상품군 표준 요율표(스펙 §2), BASE는 feeKey-scope별, EVENT는 채널/세션/품목 scope, 협의는 조건형. 기존 mock 규칙과 동일한 타입 형태 유지.

- [ ] **Step 1**: `mockAccounts`를 12자리 숫자 문자열 id로 교체(4계좌 유지): 예 `'110000001001'`(GOLD 8.5억), `'110000001002'`(SILVER 4.9억 — 협수 캐스케이드 대상), `'110000001003'`(휴면복귀), `'110000001004'`(GOLD 24억). metric 필드 유지(등급은 결정에 안 씀).
- [ ] **Step 2**: `mockSchedules`를 스펙 §2 4상품군 표준으로 재구성. 각 상품군 BASE 1개 + 대표 EVENT/NEGO. 위탁수수료(자사)만 이벤트/협의 대상, 유관기관·세금 pass-through. 예:
  - 국내주식 BASE: 위탁 정률(채널별 차등은 mock에선 대표 1개 or 채널 scope 이벤트로 표현), 유관기관 0.0036%, 증권거래세 0.18%(매도).
  - 해외주식 BASE: 위탁 정률 0.25% + minFee(USD 환산 정액), SEC 정률.
  - 국내파생 BASE: 위탁 계약당 정액, 거래소 계약당 정액.
  - 해외파생 BASE: 위탁 계약당 정액(USD), 거래소 계약당 정액.
- [ ] **Step 3**: `mockRules`를 feeKey-scope에 맞춰 재구성. BASE 4개(상품군별, scope는 channels:'*', sessions:'*'). EVENT 예: E2 NXT 국내주식 인하(scope{국내주식, exchanges:['NXT']}), E1 온라인 위탁우대(scope{국내주식, channels:['HTS','MTS']}), E3 CME 6A/6B(scope{해외파생, exchanges:['CME'], products:['6A','6B']}). NEGO: 해외주식 조건형(6개월평균자산≥5억). 모든 룰 `scope`에 `channels` 필드 포함.
- [ ] **Step 4**: `mockEnrollments`의 accountId를 12자리로. `Instrument`/`Product` 생성(masterdata)은 exchange가 KRX/NXT 등으로 나오는지 확인(기존 유지).
- [ ] **Step 5**: 이 태스크만으론 resolve가 아직 없으니, 기존 `useStore`/테스트가 새 mock·타입과 컴파일되도록 **최소 조정**(예: Execution 사용처에 channel 기본값 주입). `npx vitest run` green 목표 — 깨지는 기존 테스트는 T3~T6에서 resolve로 대체되므로, T2에서는 **컴파일 통과 + 명백한 mock 단언(계좌 12자리 등)만** 맞추고, resolve 의존 테스트의 대규모 수정은 T6에 위임(주석 `// TODO(v05): resolve 이관`으로 임시 skip 가능 — skip은 T6에서 해제).
- [ ] **Step 6 커밋**: `feat: 4상품군 표준 요율표 + mock 재구성(12자리 계좌·채널/세션 차원)`

**주의:** T2는 데이터 재구성이라 파급이 크다. 구현자는 먼저 `useStore.ts`/테스트의 컴파일 에러 목록을 파악하고, resolve 도입 전까지 **동작을 유지할 최소 shim**(예: 기존 rebindAccount를 새 타입으로 임시 통과)으로 그린을 만든 뒤 커밋. 대규모 로직 전환은 T3~T6.

---

### Task 3: scopeMatchesKey + BASE 조회 + scope_index (TDD)

**Files:** Create `src/domain/resolve.ts`; Test `src/domain/resolve.test.ts`

**Interfaces (Produces):**
```ts
export function scopeMatchesKey(s: ScopeSelector, k: FeeKey): boolean; // assetClass/exchange/session/channel/product(파생만)
export function findBaseSchedule(k: FeeKey, rules: FeeRule[], schedules: FeeSchedule[], today: string): { rule: FeeRule; schedule: FeeSchedule } | null; // 활성 BASE 중 scope 매칭
export interface ScopeIndex { candidatesFor(k: FeeKey): FeeRule[] } // 활성 EVENT/NEGO 중 feeKey scope 매칭
export function buildScopeIndex(rules: FeeRule[], today: string): ScopeIndex;
```
- [ ] **Step 1 (실패 테스트)**: scopeMatchesKey — 채널/세션/품목(파생) 매칭 및 붕괴(주식 product null이면 scope.products 무시), buildScopeIndex — 특정 feeKey에 걸리는 이벤트만 반환, findBaseSchedule — 활성 BASE 매칭. (구체 케이스는 mock 또는 자체 fixture로.)
- [ ] **Step 2 구현**:
```ts
export function scopeMatchesKey(s: ScopeSelector, k: FeeKey): boolean {
  if (s.assetClass !== k.assetClass) return false;
  if (s.exchanges !== '*' && !s.exchanges.includes(k.exchange)) return false;
  if (s.sessions !== '*' && !s.sessions.includes(k.session)) return false;
  if (s.channels !== '*' && !s.channels.includes(k.channel)) return false;
  if (k.product !== null) { // 파생만 품목 차원 적용
    if (s.products !== '*' && !s.products.includes(k.product)) return false;
    if (s.excludeProducts.includes(k.product)) return false;
  }
  return true;
}
```
buildScopeIndex는 활성(EVENT/NEGO) 룰 목록을 보관하고 `candidatesFor(k)`에서 `scopeMatchesKey(r.scope,k)` 필터(프로토타입 규모에선 선형 필터로 충분; 스펙의 인덱스 최적화는 개념 유지). findBaseSchedule은 활성 BASE 중 scopeMatchesKey 매칭 첫 건.
- [ ] **Step 3**: green + build. 커밋 `feat: scopeMatchesKey + BASE 조회 + scope_index`

---

### Task 4: resolve() — nego→event→base 최저가 + 후보 trace (TDD)

**Files:** Modify `src/domain/resolve.ts`; Test `src/domain/resolve.test.ts`

**Interfaces (Produces):**
```ts
export interface NegoException { accountId: string; scope: ScopeSelector; scheduleId: string; validFrom: string; validTo: string }
export interface ResolveCandidate { rule: FeeRule | null; schedule: FeeSchedule; avgCustomerFee: number; source: 'nego' | 'event' | 'base'; isWinner: boolean }
export interface ResolveResult { key: FeeKey; scheduleId: string; sourceRuleId: string | null; source: 'nego'|'event'|'base'; candidates: ResolveCandidate[] }
export function resolve(acct: Account, key: FeeKey, rules: FeeRule[], schedules: FeeSchedule[], nego: NegoException[], index: ScopeIndex, today: string): ResolveResult;
```
- [ ] **Step 1 (실패 테스트)**: 
  - BASE만 있으면 base 승자.
  - 이벤트가 BASE보다 싸면 event 승자.
  - nego(계좌 매칭, 기간 내)가 최저가면 nego 승자; 세그먼트/조건(evalCondition)·isTarget 반영.
  - candidates가 avgCustomerFee 오름차순, 승자 isWinner.
  - 최저가 비교는 기존 공동 probe grid 평균(dominance.probePrices) 재사용.
- [ ] **Step 2 구현**: 후보 수집 = base(항상) + index.candidatesFor(key) 중 `isTarget(rule,acct,enrollments 유사)`·세그먼트 통과 + nego 중 `accountId==acct.id && scopeMatchesKey(scope,key) && 기간내`. 각 후보 스케줄로 공동 grid 평균 고객부과액 계산(calcFee) → 최저가(동률 tie-break: nego>event>base). ResolveResult 구성. (isTarget/evalCondition은 기존 도메인 재사용; 세그먼트=isTarget+조건.)
- [ ] **Step 3**: green + build. 커밋 `feat: resolve(nego→event→base 최저가 + 후보 trace)`

---

### Task 5: ResolveCache — read-through + 증분 무효화 (TDD)

**Files:** Create `src/domain/cache.ts`; Test `src/domain/cache.test.ts`

**Interfaces (Produces):**
```ts
export interface CacheStat { hits: number; misses: number; size: number }
export class ResolveCache {
  get(accountId: string, key: FeeKey): { scheduleId: string; sourceRuleId: string|null } | null; // 적중 시 hits++, miss 시 misses++ 후 null
  set(accountId: string, key: FeeKey, v: { scheduleId: string; sourceRuleId: string|null }): void;
  invalidateAccount(accountId: string): number;         // 무효화 건수
  invalidateByScope(pred: (k: FeeKey) => boolean): number;
  stat(): CacheStat;
  clear(): void;
}
```
- [ ] **Step 1 (실패 테스트)**: set 후 get 적중(hits++), 미설정 get miss(misses++), invalidateAccount가 그 계좌 항목만 제거하고 건수 반환, invalidateByScope(pred)가 조건 매칭 키만 제거. clear.
- [ ] **Step 2 구현**: 내부 `Map<string, {...}>` 키 `${accountId}|${feeKeyString(key)}`. invalidateAccount는 접두사 매칭. invalidateByScope는 키 파싱 대신 저장 시 FeeKey를 함께 보관(`Map<string,{v, key, accountId}>`)해 pred(key)로 필터. lazy 무효화면 stale 마크지만 프로토타입은 즉시 삭제로 단순화(문서에 명시).
- [ ] **Step 3**: green + build. 커밋 `feat: ResolveCache read-through + 무효화 + 통계`

---

### Task 6: store 통합 — resolve/cache/nego/scope_index, rebindAll 폐기, 배치 증분무효화

**Files:** Modify `src/store/useStore.ts`; Test `src/store/useStore.test.ts` (resolve 기반 재작성)

- [ ] **Step 1**: State에서 `bindings: FeeBinding[]`/`rebindAll`/`allBindings` **제거**. 추가: `nego: NegoException[]`, `scopeIndex`(파생 상태 or 매 호출 build), `cache: ResolveCache`, 그리고 조회 API:
```ts
resolveFee(accountId: string, product: Product, session: Session, channel: Channel): ResolveResult; // cache read-through
cacheStat(): CacheStat;
```
`resolveFee`는 deriveFeeKey → cache.get(적중이면 그 scheduleId로 ResolveResult 요약 반환) → miss면 resolve(...) 후 cache.set. (후보 trace가 필요한 화면은 miss 경로의 full ResolveResult를 씀.)
- [ ] **Step 2 (배치 잡 증분 무효화)**: v0.4 배치 액션을 유지하되 **rebind 대신 무효화**:
  - `batchActivateExpireRules`: 상태 전환 후 `cache.invalidateByScope(k => 바뀐 룰들의 scope 중 하나라도 매칭)` — 변경된 룰들의 scope 합집합으로 무효화. 반환 summary에 무효화 건수.
  - `batchRecomputeMetrics`: 계좌 지표 갱신 후 각 변경 계좌 `cache.invalidateAccount(id)`.
  - `batchSyncInstruments`: 신규 품목 유입(무효화 불필요 — 신규 키는 애초에 캐시에 없음). summary 유지.
  - `batchEvalNegotiations`: nego 연장/해지 반영 후 관련 계좌 invalidateAccount.
  - `batchRebind` → **`batchReresolveInvalidated`로 개명**: 전량 rebind 대신 "무효화된 항목 수 / 재해석 표본"을 보고(실제 재해석은 lazy — 다음 resolveFee에서). summary `무효화 N · (다음 조회 시 재해석)`.
  - `batchRevalidateDominance`: 유지.
- [ ] **Step 3 (테스트 재작성)**: 기존 `useStore.test.ts`의 바인딩 전제 테스트를 resolve 기반으로 교체:
  - `resolveFee(110000001002, 해외주식 product, 정규, MTS)`가 지표 재산정+무효화 후 협의수수료로 바뀌는 캐스케이드(=v0.4 캐스케이드의 resolve 판).
  - cache 적중/미스: 같은 (계좌,feeKey) 두 번 resolveFee → 두 번째 hit(cacheStat().hits 증가).
  - 무효화: batchRecomputeMetrics 후 그 계좌 재조회가 miss(재해석).
  - ④ load-bearing(연장/해지) 유지.
  기존 e2e-workflow.test.ts(A-1001 CME:6A 등)도 resolve/12자리 계좌로 갱신.
- [ ] **Step 4**: green + build. 커밋 `feat: store 해석형 전환(resolve/cache/nego), rebindAll 폐기, 배치 증분무효화`

**주의:** 이 태스크가 v0.5의 심장이자 최대 파급. 구현자는 컴파일 에러(제거된 bindings 참조) 전부를 화면 태스크로 넘기기 전, store 레벨에서 최소한 컴파일/도메인 테스트 그린을 만들 것. 화면의 `bindings` 참조는 T7~T9에서 resolve로 교체(임시로 화면이 깨지면 해당 화면 렌더를 T7~T9 완료 전까지 안전 처리 — 단, build는 통과해야 하므로 최소 stub).

---

### Task 7: 수수료 결정 흐름(FeeTrace) → resolve 기반 (feeKey 입력·후보·캐시 적중/미스)

**Files:** Modify `src/screens/FeeTrace.tsx`

- [ ] 입력부에 **세션·채널 선택** 추가(품목은 기존 검색). 계좌는 12자리 표시.
- [ ] 단계 재구성: ①대상/컨텍스트(계좌·feeKey) → ②후보 수집(base/event/nego, 탈락 사유) → ③최저가 경쟁(후보별 avgCustomerFee, 승자·source 배지) → ④해석 결과(scheduleId·source) + **캐시 적중/미스 표시**(재조회 시 hit) → ⑤체결 금액(calcFee). resolve 결과(ResolveResult)를 그리기만.
- [ ] 검증: A-1002×해외주식×(정규,MTS)로 협의수수료 해석, 재조회 시 캐시 hit 표시. green + build. 커밋 `feat: 수수료 결정 흐름 resolve/캐시 기반 이관`

---

### Task 8: 계좌 조회(AccountView) resolve화 + 배치 플로우 무효화 시연

**Files:** Modify `src/screens/AccountView.tsx`, `src/screens/BatchOps.tsx`

- [ ] AccountView: 전량 바인딩 목록 대신 (a) 계좌의 **협의(nego) 예외 목록**, (b) feeKey 선택(품목/세션/채널) → resolve 결과 + 체결 시뮬. "이 계좌의 예외만 관리된다"가 드러나게.
- [ ] BatchOps: ⑤ 카드를 **무효화 시연**으로 — "무효화 N건 · 다음 조회 시 재해석", 드릴다운은 무효화된 (계좌/스코프) 요약 + cacheStat(hits/misses/size). 캐스케이드는 "지표재산정→무효화→재조회 시 협의 적용"으로 서술.
- [ ] green + build. 커밋 `feat: 계좌조회 resolve화 + 배치 무효화 시연`

---

### Task 9: 위저드 채널 축 + dimension-relevance + 대시보드 적응

**Files:** Modify `src/screens/Wizard.tsx`, `src/screens/Dashboard.tsx`

- [ ] Wizard 적용범위 단계에 **채널 선택**(6종) 추가. dimension-relevance: 파생만 품목 선택 UI, 주식은 품목 UI 숨김(거래소·세션·채널만). 상신 시 scope.channels 채움.
- [ ] Dashboard: `bindings` 기반 카드(바인딩 건수 등)를 제거/대체 — 활성 룰 수·협의(nego) 건수·**cacheStat**(적중률/크기)로. "예상 감면"은 유지 가능(룰 기반).
- [ ] green + build. 커밋 `feat: 위저드 채널 축 + 대시보드 해석형 적응`

---

### Task 10: README + 최종 검증

**Files:** Modify `README.md`

- [ ] v0.5 요약(해석형 코어·feeKey 가변입도·채널·캐시), 시연 시나리오(수수료 결정 흐름에서 feeKey 해석·캐시 적중, 배치에서 무효화 캐스케이드, 계좌조회 예외 관리). 설계문서 링크. 한계(캐시 즉시삭제·시뮬 입력·프로토타입 규모).
- [ ] `npx vitest run` 전량 green + `npm run build` + 시나리오 통주. 커밋 `docs: v0.5 README`

---

## Self-Review 결과

- 스펙 커버리지: §1 feeKey/차원/계좌→T1,T2 · §2 요율표→T2 · §3 3계층→T2(데이터)+T3,T4(엔진) · §4 저장모델→T6(store) · §5 resolve/무효화→T4,T5,T6 · §6 성능(캐시)→T5,T7,T8 · §7 갭/§8 범위→전 태스크. 누락 없음.
- 타입 일관성: FeeKey/ScopeSelector.channels/Session/Channel(T1) = 소비(T3~T9). ResolveResult/ResolveCandidate(T4)=화면(T7,T8). ResolveCache API(T5)=store(T6).
- 위험: T2(mock 재구성)·T6(store 전환)이 최대 파급. 각 태스크에 "컴파일 그린 우선, resolve 의존 테스트는 T6에서 이관" 전략 명시. 파괴적 타입 변경(Execution.channel 필수화)은 T1 optional→T3 필수화로 단계적.
- 결정성: computedAt/무효화는 시간 대신 단조 tick. 기존 도메인(calcFee/probePrices/isTarget/evalCondition) 재사용.
