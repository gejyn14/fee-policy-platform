# 수수료 이벤트 플랫폼 v0 프로토타입 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리 플랫폼 5개 화면(등록 위저드, 승인함, 대시보드, 협수 관리, 계좌 조회)을 mock 데이터로 구현하여 워크플로우(등록→승인→바인딩 생성→계좌 조회 확인)를 클릭으로 시연.

**Architecture:** 백엔드 없는 단일 SPA. 도메인 엔진(수수료 계산·지배관계 검증·최저가 바인딩)은 순수 함수 모듈로 TDD, 상태는 zustand 인메모리 스토어(승인 액션이 rebindAll 트리거), 화면은 탭 네비게이션의 React 컴포넌트.

**Tech Stack:** Vite + React 18 + TypeScript, zustand, Vitest. 라우터·UI 라이브러리 없음(탭 상태 + 수제 CSS).

## Global Constraints

- UI 문구는 전부 한국어. 스펙 용어(기안/승인대기/활성, 신청형/가입형/휴면복귀형/일괄적용형, 고객부과/회사부담/면제)를 그대로 사용
- mock 전용: 네트워크 호출 금지, "오늘" 날짜는 상수 `TODAY = '2026-07-04'`
- Excel 업로드는 프로토타입에서 CSV/콤마 텍스트 붙여넣기로 대체 (UI 라벨에 "(프로토타입: CSV)" 명시)
- 엔진 모듈(`src/domain/`)은 React 의존 금지 — 순수 함수만
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## 파일 구조

```
src/
  domain/types.ts        # 엔티티 타입 (스펙 4장)
  domain/calc.ts         # calcFee: 요율표 × 체결 → 수수료 (구성요소별)
  domain/dominance.ts    # probePrices, dominates: 지배관계 검증
  domain/binding.ts      # scopeMatches, isTarget, rebindAccount: 최저가 바인딩
  store/mock.ts          # mock 계좌/품목/요율표/룰 데이터
  store/useStore.ts      # zustand 스토어 + 워크플로우 액션 (상신/승인/연장/rebindAll)
  screens/Dashboard.tsx  # ③ 대시보드
  screens/Wizard.tsx     # ① 이벤트 등록 위저드 (6단계, 시뮬레이션 포함)
  screens/Approvals.tsx  # ② 승인함
  screens/Negotiated.tsx # ④ 협수 관리
  screens/AccountView.tsx# ⑤ 계좌 조회
  App.tsx / styles.css   # 셸 + 탭 네비게이션
src/domain/*.test.ts     # 엔진 단위 테스트
```

---

### Task 1: 프로젝트 스캐폴드 + 도메인 타입 + mock 데이터

**Files:**
- Create: Vite 스캐폴드 일체, `src/domain/types.ts`, `src/store/mock.ts`

**Interfaces:**
- Produces: `types.ts`의 모든 타입, `mock.ts`의 `mockAccounts/mockProducts/mockSchedules/mockRules/mockEnrollments`, 상수 `TODAY`

- [ ] **Step 1: 스캐폴드**

```bash
cd /Users/yujin-an/dev/fees
npm create vite@latest . -- --template react-ts
npm install zustand
npm install -D vitest
```

`package.json`의 scripts에 `"test": "vitest run"` 추가.

- [ ] **Step 2: 도메인 타입 작성** — `src/domain/types.ts`

```ts
export type RuleType = 'BASE' | 'EVENT' | 'NEGOTIATED';
export type ApplyMode = '신청형' | '가입형' | '휴면복귀형' | '일괄적용형';
export type RuleStatus = '기안' | '승인대기' | '활성' | '반려' | '종료';
export type AssetClass = '국내주식' | '해외주식' | '국내파생' | '해외파생' | '금현물';
export type Payer = '고객부과' | '회사부담' | '면제';

export interface RateBand { from: number; to: number | null; rateBp?: number; flat?: number }

export interface FeeComponent {
  name: string;                       // 예: 자사 수수료, 거래소, 예탁원, 제세금
  kind: '자사' | '유관기관' | '세금';
  payer: Payer;
  rateType: '정률' | '정액' | '구간표';
  rateBp?: number;                    // 정률: 거래대금 대비 bp
  flatAmount?: number;                // 정액: 계약(주문)당 금액
  bands?: RateBand[];                 // 구간표: 체결단가 구간별 (rateBp 또는 flat)
  minFee?: number;                    // 최소수수료
}

export interface FeeSchedule { id: string; name: string; components: FeeComponent[] }

export interface ScopeSelector {
  assetClass: AssetClass;
  exchanges: string[] | '*';
  sessions: string[] | '*';
  currencies: string[] | '*';
  products: string[] | '*';           // 품목/기초자산 코드 (6A, 6B, KOSPI200옵션 등)
  excludeProducts: string[];
}

export interface NegotiatedCondition {
  metric: '6개월평균자산' | '6개월약정액';
  threshold: number;
  action: '자동연장' | '승인후연장';
}

export interface FeeRule {
  id: string; name: string;
  type: RuleType; status: RuleStatus; applyMode: ApplyMode;
  startDate: string; endDate: string;      // 'YYYY-MM-DD'
  scope: ScopeSelector; scheduleId: string;
  condition?: NegotiatedCondition;         // NEGOTIATED 전용
  targetAccountIds?: string[];             // 일괄적용형 bulk 대상 (없으면 전체)
  warnings: { dominance: boolean; reverseMargin: boolean };
  sim?: { targets: number; saving: number };
  createdBy: string; log: string[];
}

export interface Enrollment { accountId: string; ruleId: string; enrolledAt: string; channel: string }

export interface Account {
  id: string; name: string; grade: string;
  dormantReturned: boolean;
  metric6mAsset: number;              // 6개월 평균 자산 (원)
  metric6mVolume: number;             // 6개월 약정액 (원)
}

export interface Product {
  assetClass: AssetClass; exchange: string; code: string; name: string;
  currency: string; sessions: string[];
}

export interface Execution {
  accountId: string; product: Product; session: string;
  price: number; qty: number; notional: number;
}

export interface FeeBinding {
  accountId: string; scopeKey: string;      // `${exchange}:${code}`
  scheduleId: string; sourceRuleId: string;
  validFrom: string; validTo: string; reason: string;
}

export const TODAY = '2026-07-04';
```

- [ ] **Step 3: mock 데이터 작성** — `src/store/mock.ts`

계좌 4개(등급 다양, 1개는 `dormantReturned: true`), 품목 6개(국내주식 삼성전자, 해외주식 AAPL, 국내파생 KOSPI200옵션, 해외파생 CME 6A/6B, 금현물 KRX금), 요율표 5개(BASE 등급용 2개 + 이벤트용 2개 + 협수용 1개), 룰 4개(BASE 2개 활성, EVENT 1개 활성·일괄적용형, NEGOTIATED 1개 활성·조건부), Enrollment 1건.

핵심 케이스가 반드시 포함되어야 함:
- KOSPI200옵션 BASE 요율표에 **구간표** 컴포넌트 (예: 체결단가 <3 → 0.3bp+, 3~10 → 구간 요율, ≥10 → 상위 구간)
- 해외주식 요율표에 **정률+minFee**
- 이벤트 요율표 하나는 유관기관분 `회사부담` (역마진 경고 케이스)
- 협수 룰의 condition: 해외주식 scope → `6개월평균자산`, threshold를 mock 계좌 1개는 충족·1개는 미충족하게 설정

```ts
import type { Account, Product, FeeSchedule, FeeRule, Enrollment } from '../domain/types';

export const mockAccounts: Account[] = [
  { id: 'A-1001', name: '김철수', grade: 'GOLD', dormantReturned: false, metric6mAsset: 850_000_000, metric6mVolume: 2_100_000_000 },
  { id: 'A-1002', name: '이영희', grade: 'SILVER', dormantReturned: false, metric6mAsset: 120_000_000, metric6mVolume: 300_000_000 },
  { id: 'A-1003', name: '박민준', grade: 'SILVER', dormantReturned: true, metric6mAsset: 30_000_000, metric6mVolume: 50_000_000 },
  { id: 'A-1004', name: '최수진', grade: 'GOLD', dormantReturned: false, metric6mAsset: 2_400_000_000, metric6mVolume: 9_800_000_000 },
];

export const mockProducts: Product[] = [
  { assetClass: '국내주식', exchange: 'KRX', code: '005930', name: '삼성전자', currency: 'KRW', sessions: ['정규'] },
  { assetClass: '해외주식', exchange: 'NASDAQ', code: 'AAPL', name: '애플', currency: 'USD', sessions: ['정규', '프리마켓'] },
  { assetClass: '국내파생', exchange: 'KRX', code: 'K200OPT', name: 'KOSPI200옵션', currency: 'KRW', sessions: ['정규', '야간'] },
  { assetClass: '해외파생', exchange: 'CME', code: '6A', name: 'Australian Dollar', currency: 'USD', sessions: ['주간', '야간'] },
  { assetClass: '해외파생', exchange: 'CME', code: '6B', name: 'British Pound', currency: 'USD', sessions: ['주간', '야간'] },
  { assetClass: '금현물', exchange: 'KRX', code: 'GOLD99', name: 'KRX 금 99.99', currency: 'KRW', sessions: ['정규'] },
];
```

요율표·룰·Enrollment도 같은 파일에 위 요구 케이스대로 작성 (BASE 룰은 scope `products: '*'`, 이벤트 룰은 CME 6A/6B 한정 + 유관기관 회사부담, 협수 룰은 해외주식 한정). 각 룰 `warnings: { dominance: true, reverseMargin: false }` 등 정합하게.

- [ ] **Step 4: 빌드 확인 & 커밋**

```bash
npm run build   # 기대: 오류 없이 완료
git add -A && git commit -m "feat: 스캐폴드 + 도메인 타입 + mock 데이터"
```

---

### Task 2: 수수료 계산기 calcFee (TDD)

**Files:**
- Create: `src/domain/calc.ts`, `src/domain/calc.test.ts`

**Interfaces:**
- Consumes: `types.ts`
- Produces: `calcFee(schedule: FeeSchedule, exec: Execution): FeeResult`, `componentAmount(c: FeeComponent, exec: Execution): number`, `export interface FeeLine { name: string; kind: '자사'|'유관기관'|'세금'; payer: Payer; amount: number }`, `export interface FeeResult { customerTotal: number; companyBorne: number; lines: FeeLine[] }`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/domain/calc.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { calcFee } from './calc';
import type { FeeSchedule, Execution, Product } from './types';

const stock: Product = { assetClass: '국내주식', exchange: 'KRX', code: '005930', name: '삼성전자', currency: 'KRW', sessions: ['정규'] };
const exec = (price: number, qty: number): Execution =>
  ({ accountId: 'A-1', product: stock, session: '정규', price, qty, notional: price * qty });

it('정률: 거래대금 × bp', () => {
  const s: FeeSchedule = { id: 'S1', name: 't', components: [
    { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 15 }] };
  // 1,000,000 × 15bp = 1,500
  expect(calcFee(s, exec(100_000, 10)).customerTotal).toBe(1500);
});

it('정액: 계약당 금액 × 수량', () => {
  const s: FeeSchedule = { id: 'S2', name: 't', components: [
    { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: 300 }] };
  expect(calcFee(s, exec(100, 5)).customerTotal).toBe(1500);
});

it('구간표: 체결단가 구간으로 요율 결정', () => {
  const s: FeeSchedule = { id: 'S3', name: 't', components: [
    { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '구간표', bands: [
      { from: 0, to: 3, flat: 10 }, { from: 3, to: null, flat: 50 }] }] };
  expect(calcFee(s, exec(2.5, 10)).customerTotal).toBe(100);   // 저가 구간
  expect(calcFee(s, exec(5, 10)).customerTotal).toBe(500);     // 상위 구간
});

it('최소수수료 적용', () => {
  const s: FeeSchedule = { id: 'S4', name: 't', components: [
    { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 10, minFee: 5000 }] };
  expect(calcFee(s, exec(1000, 10)).customerTotal).toBe(5000); // 10원 < minFee
});

it('부담주체: 회사부담은 companyBorne, 면제는 0', () => {
  const s: FeeSchedule = { id: 'S5', name: 't', components: [
    { name: '자사 수수료', kind: '자사', payer: '면제', rateType: '정률', rateBp: 15 },
    { name: '거래소', kind: '유관기관', payer: '회사부담', rateType: '정률', rateBp: 2 },
    { name: '제세금', kind: '세금', payer: '고객부과', rateType: '정률', rateBp: 23 }] };
  const r = calcFee(s, exec(100_000, 10)); // 대금 1,000,000
  expect(r.customerTotal).toBe(2300);      // 세금만 고객부과
  expect(r.companyBorne).toBe(200);        // 거래소분 회사부담
  expect(r.lines.find(l => l.name === '자사 수수료')!.amount).toBe(0);
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/domain/calc.test.ts
# 기대: FAIL — calc.ts 모듈 없음
```

- [ ] **Step 3: 구현** — `src/domain/calc.ts`

```ts
import type { FeeComponent, FeeSchedule, Execution, Payer } from './types';

export interface FeeLine { name: string; kind: FeeComponent['kind']; payer: Payer; amount: number }
export interface FeeResult { customerTotal: number; companyBorne: number; lines: FeeLine[] }

export function componentAmount(c: FeeComponent, exec: Execution): number {
  let amt = 0;
  if (c.rateType === '정률') {
    amt = (exec.notional * (c.rateBp ?? 0)) / 10_000;
  } else if (c.rateType === '정액') {
    amt = (c.flatAmount ?? 0) * exec.qty;
  } else {
    const band = (c.bands ?? []).find(
      (b) => exec.price >= b.from && (b.to === null || exec.price < b.to),
    );
    if (band) {
      amt = band.flat != null ? band.flat * exec.qty : (exec.notional * (band.rateBp ?? 0)) / 10_000;
    }
  }
  if (c.minFee != null && amt < c.minFee) amt = c.minFee;
  return Math.round(amt * 100) / 100;
}

export function calcFee(schedule: FeeSchedule, exec: Execution): FeeResult {
  const lines: FeeLine[] = schedule.components.map((c) => ({
    name: c.name, kind: c.kind, payer: c.payer,
    amount: c.payer === '면제' ? 0 : componentAmount(c, exec),
  }));
  const sum = (ls: FeeLine[]) => Math.round(ls.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  return {
    customerTotal: sum(lines.filter((l) => l.payer === '고객부과')),
    companyBorne: sum(lines.filter((l) => l.payer === '회사부담')),
    lines,
  };
}
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run src/domain/calc.test.ts
# 기대: 5 passed
```

- [ ] **Step 5: 커밋**

```bash
git add src/domain/calc.ts src/domain/calc.test.ts
git commit -m "feat: 수수료 계산기 calcFee (정률/정액/구간표/minFee/부담주체)"
```

---

### Task 3: 지배관계 검증 dominates (TDD)

**Files:**
- Create: `src/domain/dominance.ts`, `src/domain/dominance.test.ts`

**Interfaces:**
- Consumes: `calcFee` (Task 2), `types.ts`
- Produces: `probePrices(a: FeeSchedule, b: FeeSchedule): number[]`, `dominates(candidate: FeeSchedule, incumbent: FeeSchedule, sampleExec: (price: number) => Execution): boolean`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/domain/dominance.test.ts`

```ts
import { it, expect } from 'vitest';
import { dominates, probePrices } from './dominance';
import type { FeeSchedule, Execution, Product } from './types';

const opt: Product = { assetClass: '국내파생', exchange: 'KRX', code: 'K200OPT', name: 'KOSPI200옵션', currency: 'KRW', sessions: ['정규'] };
const sample = (price: number): Execution =>
  ({ accountId: 'A-1', product: opt, session: '정규', price, qty: 10, notional: price * 10 });
const sched = (bands: { from: number; to: number | null; flat: number }[]): FeeSchedule =>
  ({ id: 'x', name: 'x', components: [{ name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '구간표', bands }] });

it('전 구간에서 싸면 지배 성립', () => {
  const base = sched([{ from: 0, to: 3, flat: 10 }, { from: 3, to: null, flat: 50 }]);
  const event = sched([{ from: 0, to: 3, flat: 5 }, { from: 3, to: null, flat: 30 }]);
  expect(dominates(event, base, sample)).toBe(true);
});

it('구간 교차(저가는 싸고 고가는 비쌈)면 지배 불성립', () => {
  const base = sched([{ from: 0, to: 3, flat: 10 }, { from: 3, to: null, flat: 50 }]);
  const cross = sched([{ from: 0, to: 3, flat: 5 }, { from: 3, to: null, flat: 80 }]);
  expect(dominates(cross, base, sample)).toBe(false);
});

it('probePrices는 양쪽 구간 경계를 모두 포함', () => {
  const a = sched([{ from: 0, to: 3, flat: 1 }, { from: 3, to: null, flat: 2 }]);
  const b = sched([{ from: 0, to: 7, flat: 1 }, { from: 7, to: null, flat: 2 }]);
  const ps = probePrices(a, b);
  expect(ps.some(p => p > 3 && p < 7)).toBe(true);  // 3~7 사이 표본 존재
  expect(ps.some(p => p > 7)).toBe(true);            // 7 초과 표본 존재
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/domain/dominance.test.ts
# 기대: FAIL — dominance.ts 모듈 없음
```

- [ ] **Step 3: 구현** — `src/domain/dominance.ts`

```ts
import type { FeeSchedule, Execution } from './types';
import { calcFee } from './calc';

/** 두 요율표의 모든 구간 경계 주변 + 기본 표본가로 검사 가격 목록 생성 */
export function probePrices(a: FeeSchedule, b: FeeSchedule): number[] {
  const pts = new Set<number>([1, 100, 100_000]);
  for (const s of [a, b])
    for (const c of s.components)
      for (const band of c.bands ?? []) {
        pts.add(band.from + 0.01);
        if (band.to !== null) pts.add(Math.max(band.from + 0.01, band.to - 0.01));
      }
  return [...pts].sort((x, y) => x - y);
}

/** candidate가 모든 검사 가격에서 incumbent 이하인가 (등록 시점 지배관계 검증) */
export function dominates(
  candidate: FeeSchedule, incumbent: FeeSchedule,
  sampleExec: (price: number) => Execution,
): boolean {
  return probePrices(candidate, incumbent).every(
    (p) => calcFee(candidate, sampleExec(p)).customerTotal <= calcFee(incumbent, sampleExec(p)).customerTotal,
  );
}
```

- [ ] **Step 4: 통과 확인 & 커밋**

```bash
npx vitest run src/domain/dominance.test.ts   # 기대: 3 passed
git add src/domain/dominance.ts src/domain/dominance.test.ts
git commit -m "feat: 지배관계 검증 dominates (구간 경계 표본 검사)"
```

---

### Task 4: 최저가 선택 + 바인딩 생성 rebindAccount (TDD)

**Files:**
- Create: `src/domain/binding.ts`, `src/domain/binding.test.ts`

**Interfaces:**
- Consumes: `calcFee`, `probePrices` (Task 2·3), `types.ts`
- Produces:
  - `scopeMatches(s: ScopeSelector, p: Product): boolean`
  - `isTarget(rule: FeeRule, acct: Account, enrollments: Enrollment[]): boolean`
  - `rebindAccount(acct: Account, rules: FeeRule[], schedules: FeeSchedule[], enrollments: Enrollment[], products: Product[], today: string): FeeBinding[]`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/domain/binding.test.ts`

```ts
import { it, expect, describe } from 'vitest';
import { scopeMatches, isTarget, rebindAccount } from './binding';
import type { ScopeSelector, Product, FeeRule, FeeSchedule, Account, Enrollment } from './types';

const p6A: Product = { assetClass: '해외파생', exchange: 'CME', code: '6A', name: 'AUD', currency: 'USD', sessions: ['주간'] };
const p6E: Product = { assetClass: '해외파생', exchange: 'CME', code: '6E', name: 'EUR', currency: 'USD', sessions: ['주간'] };
const acct: Account = { id: 'A-1', name: '김', grade: 'GOLD', dormantReturned: false, metric6mAsset: 0, metric6mVolume: 0 };

const flatSched = (id: string, flat: number): FeeSchedule =>
  ({ id, name: id, components: [{ name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: flat }] });
const rule = (over: Partial<FeeRule>): FeeRule => ({
  id: 'R', name: 'r', type: 'BASE', status: '활성', applyMode: '일괄적용형',
  startDate: '2026-01-01', endDate: '2026-12-31',
  scope: { assetClass: '해외파생', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
  scheduleId: 'S', warnings: { dominance: true, reverseMargin: false }, createdBy: 't', log: [], ...over });

describe('scopeMatches', () => {
  it('제외 리스트가 포함보다 우선', () => {
    const s: ScopeSelector = { assetClass: '해외파생', exchanges: ['CME'], sessions: '*', currencies: '*', products: '*', excludeProducts: ['6E'] };
    expect(scopeMatches(s, p6A)).toBe(true);
    expect(scopeMatches(s, p6E)).toBe(false);
  });
});

describe('isTarget', () => {
  it('신청형은 Enrollment 필요, 일괄적용형은 불필요', () => {
    const evt = rule({ id: 'E1', type: 'EVENT', applyMode: '신청형' });
    expect(isTarget(evt, acct, [])).toBe(false);
    expect(isTarget(evt, acct, [{ accountId: 'A-1', ruleId: 'E1', enrolledAt: '2026-07-01', channel: 'MTS' }])).toBe(true);
    expect(isTarget(rule({ type: 'EVENT', applyMode: '일괄적용형' }), acct, [])).toBe(true);
  });
  it('휴면복귀형은 dormantReturned 계좌만', () => {
    const evt = rule({ type: 'EVENT', applyMode: '휴면복귀형' });
    expect(isTarget(evt, acct, [])).toBe(false);
    expect(isTarget(evt, { ...acct, dormantReturned: true }, [])).toBe(true);
  });
});

describe('rebindAccount', () => {
  const schedules = [flatSched('S-BASE', 50), flatSched('S-EVT', 30)];
  const base = rule({ id: 'R-BASE', scheduleId: 'S-BASE' });
  const evt = rule({ id: 'R-EVT', type: 'EVENT', scheduleId: 'S-EVT' });

  it('최저가 룰이 바인딩으로 선택되고 근거가 남는다', () => {
    const bs = rebindAccount(acct, [base, evt], schedules, [], [p6A], '2026-07-04');
    expect(bs).toHaveLength(1);
    expect(bs[0].scheduleId).toBe('S-EVT');
    expect(bs[0].sourceRuleId).toBe('R-EVT');
    expect(bs[0].scopeKey).toBe('CME:6A');
  });

  it('기간 밖 룰은 후보에서 제외', () => {
    const expired = { ...evt, endDate: '2026-06-30' };
    const bs = rebindAccount(acct, [base, expired], schedules, [], [p6A], '2026-07-04');
    expect(bs[0].scheduleId).toBe('S-BASE');
  });

  it('동률이면 협수 > 이벤트 > 기본', () => {
    const nego = rule({ id: 'R-NEGO', type: 'NEGOTIATED', applyMode: '신청형', scheduleId: 'S-EVT' });
    const enr: Enrollment[] = [{ accountId: 'A-1', ruleId: 'R-NEGO', enrolledAt: '2026-01-02', channel: '지점' }];
    const bs = rebindAccount(acct, [base, evt, nego], schedules, enr, [p6A], '2026-07-04');
    expect(bs[0].sourceRuleId).toBe('R-NEGO');
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/domain/binding.test.ts
# 기대: FAIL — binding.ts 모듈 없음
```

- [ ] **Step 3: 구현** — `src/domain/binding.ts`

```ts
import type { Account, Enrollment, Execution, FeeBinding, FeeRule, FeeSchedule, Product, ScopeSelector } from './types';
import { calcFee } from './calc';
import { probePrices } from './dominance';

export function scopeMatches(s: ScopeSelector, p: Product): boolean {
  if (s.assetClass !== p.assetClass) return false;
  if (s.exchanges !== '*' && !s.exchanges.includes(p.exchange)) return false;
  if (s.currencies !== '*' && !s.currencies.includes(p.currency)) return false;
  if (s.products !== '*' && !s.products.includes(p.code)) return false;
  if (s.excludeProducts.includes(p.code)) return false;
  return true;
}

export function isTarget(rule: FeeRule, acct: Account, enrollments: Enrollment[]): boolean {
  if (rule.type === 'BASE') return true;
  if (rule.applyMode === '일괄적용형')
    return !rule.targetAccountIds || rule.targetAccountIds.includes(acct.id);
  if (rule.applyMode === '가입형') return true;                 // 프로토타입: 전 계좌 가입 간주
  if (rule.applyMode === '휴면복귀형') return acct.dormantReturned;
  return enrollments.some((e) => e.accountId === acct.id && e.ruleId === rule.id);
}

const TIE_ORDER: Record<FeeRule['type'], number> = { NEGOTIATED: 0, EVENT: 1, BASE: 2 };

export function rebindAccount(
  acct: Account, rules: FeeRule[], schedules: FeeSchedule[],
  enrollments: Enrollment[], products: Product[], today: string,
): FeeBinding[] {
  const active = rules.filter((r) => r.status === '활성' && r.startDate <= today && today <= r.endDate);
  const schedOf = (id: string) => schedules.find((s) => s.id === id)!;
  const bindings: FeeBinding[] = [];

  for (const p of products) {
    const candidates = active.filter((r) => scopeMatches(r.scope, p) && isTarget(r, acct, enrollments));
    if (candidates.length === 0) continue;

    const sample = (price: number): Execution =>
      ({ accountId: acct.id, product: p, session: p.sessions[0], price, qty: 10, notional: price * 10 });
    // 검사 가격 평균 고객부과액으로 비교 (지배관계 검증 덕에 순서 일관)
    const cost = (r: FeeRule) => {
      const ps = probePrices(schedOf(r.scheduleId), schedOf(r.scheduleId));
      return ps.reduce((a, price) => a + calcFee(schedOf(r.scheduleId), sample(price)).customerTotal, 0) / ps.length;
    };
    const winner = [...candidates].sort(
      (a, b) => cost(a) - cost(b) || TIE_ORDER[a.type] - TIE_ORDER[b.type],
    )[0];

    bindings.push({
      accountId: acct.id, scopeKey: `${p.exchange}:${p.code}`,
      scheduleId: winner.scheduleId, sourceRuleId: winner.id,
      validFrom: winner.startDate, validTo: winner.endDate,
      reason: `${winner.type === 'BASE' ? '기본(등급)' : winner.type === 'EVENT' ? '이벤트' : '협의수수료'} '${winner.name}' 최저가 적용`,
    });
  }
  return bindings;
}
```

- [ ] **Step 4: 통과 확인 & 커밋**

```bash
npx vitest run   # 기대: calc/dominance/binding 전체 passed
git add src/domain/binding.ts src/domain/binding.test.ts
git commit -m "feat: 최저가 선택 + 바인딩 생성 rebindAccount"
```

---

### Task 5: zustand 스토어 + 워크플로우 액션 (TDD)

**Files:**
- Create: `src/store/useStore.ts`, `src/store/useStore.test.ts`

**Interfaces:**
- Consumes: Task 1~4 전부
- Produces: `useStore` (zustand hook). 상태: `accounts, products, schedules, rules, enrollments, bindings`. 액션:
  - `submitRule(rule: FeeRule, schedule: FeeSchedule): void` — 요율표 등록 + 지배관계/역마진 검사 결과를 `rule.warnings`에 기록 + 시뮬레이션 결과를 `rule.sim`에 기록 + 상태 `승인대기`로 저장
  - `approveRule(id: string): void` — 상태 `활성` + `rebindAll()` + log 추가
  - `rejectRule(id: string, reason: string): void` — 상태 `반려` + log
  - `extendNegotiated(id: string, newEndDate: string): void` — 협수 기간 갱신 + `rebindAll()` + log
  - `evalCondition(rule: FeeRule, acct: Account): boolean` — 협수 조건 충족 여부 (순수 계산, export)
  - `rebindAll(): void` — 전 계좌 `rebindAccount` 재실행하여 `bindings` 교체

- [ ] **Step 1: 실패하는 테스트 작성** — `src/store/useStore.test.ts`

```ts
import { it, expect, beforeEach } from 'vitest';
import { useStore, evalCondition } from './useStore';
import type { FeeRule, FeeSchedule } from '../domain/types';

beforeEach(() => useStore.getState().reset());

const newSched: FeeSchedule = { id: 'S-NEW', name: '테스트 이벤트 요율', components: [
  { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: 1 }] };
const newRule: FeeRule = {
  id: 'R-NEW', name: '6A 수수료 인하 이벤트', type: 'EVENT', status: '기안', applyMode: '일괄적용형',
  startDate: '2026-07-01', endDate: '2026-09-30',
  scope: { assetClass: '해외파생', exchanges: ['CME'], sessions: '*', currencies: '*', products: ['6A'], excludeProducts: [] },
  scheduleId: 'S-NEW', warnings: { dominance: true, reverseMargin: false }, createdBy: '담당자', log: [] };

it('submitRule → 승인대기 + 시뮬레이션 결과 기록', () => {
  useStore.getState().submitRule(newRule, newSched);
  const r = useStore.getState().rules.find(x => x.id === 'R-NEW')!;
  expect(r.status).toBe('승인대기');
  expect(r.sim!.targets).toBeGreaterThan(0);
});

it('approveRule → 활성 + 바인딩 재생성으로 이벤트 요율 반영', () => {
  useStore.getState().submitRule(newRule, newSched);
  useStore.getState().approveRule('R-NEW');
  const s = useStore.getState();
  expect(s.rules.find(x => x.id === 'R-NEW')!.status).toBe('활성');
  const b = s.bindings.find(x => x.scopeKey === 'CME:6A' && x.accountId === 'A-1001');
  expect(b!.sourceRuleId).toBe('R-NEW');   // 정액 1원이라 항상 최저가
});

it('rejectRule → 반려, 바인딩 영향 없음', () => {
  useStore.getState().submitRule(newRule, newSched);
  useStore.getState().rejectRule('R-NEW', '기간 조정 필요');
  const s = useStore.getState();
  expect(s.rules.find(x => x.id === 'R-NEW')!.status).toBe('반려');
  expect(s.bindings.every(b => b.sourceRuleId !== 'R-NEW')).toBe(true);
});

it('evalCondition: 6개월평균자산 임계값 판정', () => {
  const acct = useStore.getState().accounts[0]; // metric6mAsset: 850,000,000
  const nego = { ...newRule, type: 'NEGOTIATED' as const,
    condition: { metric: '6개월평균자산' as const, threshold: 500_000_000, action: '승인후연장' as const } };
  expect(evalCondition(nego, acct)).toBe(true);
  expect(evalCondition({ ...nego, condition: { ...nego.condition!, threshold: 1_000_000_000 } }, acct)).toBe(false);
});

it('extendNegotiated → 기간 연장 + log', () => {
  const nego = useStore.getState().rules.find(r => r.type === 'NEGOTIATED')!;
  useStore.getState().extendNegotiated(nego.id, '2027-06-30');
  const r = useStore.getState().rules.find(x => x.id === nego.id)!;
  expect(r.endDate).toBe('2027-06-30');
  expect(r.log.at(-1)).toContain('연장');
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/store/useStore.test.ts
# 기대: FAIL — useStore 모듈 없음
```

- [ ] **Step 3: 구현** — `src/store/useStore.ts`

```ts
import { create } from 'zustand';
import type { Account, Enrollment, FeeBinding, FeeRule, FeeSchedule, Product, Execution } from '../domain/types';
import { TODAY } from '../domain/types';
import { mockAccounts, mockProducts, mockSchedules, mockRules, mockEnrollments } from './mock';
import { rebindAccount, scopeMatches, isTarget } from '../domain/binding';
import { calcFee } from '../domain/calc';
import { dominates } from '../domain/dominance';

export function evalCondition(rule: FeeRule, acct: Account): boolean {
  if (!rule.condition) return true;
  const value = rule.condition.metric === '6개월평균자산' ? acct.metric6mAsset : acct.metric6mVolume;
  return value >= rule.condition.threshold;
}

interface State {
  accounts: Account[]; products: Product[]; schedules: FeeSchedule[];
  rules: FeeRule[]; enrollments: Enrollment[]; bindings: FeeBinding[];
  reset(): void; rebindAll(): void;
  submitRule(rule: FeeRule, schedule: FeeSchedule): void;
  approveRule(id: string): void;
  rejectRule(id: string, reason: string): void;
  extendNegotiated(id: string, newEndDate: string): void;
}

function allBindings(s: Pick<State, 'accounts' | 'rules' | 'schedules' | 'enrollments' | 'products'>): FeeBinding[] {
  return s.accounts.flatMap((a) => rebindAccount(a, s.rules, s.schedules, s.enrollments, s.products, TODAY));
}

export const useStore = create<State>((set, get) => ({
  accounts: mockAccounts, products: mockProducts, schedules: mockSchedules,
  rules: mockRules, enrollments: mockEnrollments, bindings: [],

  reset: () => set((s) => {
    const init = { accounts: mockAccounts, products: mockProducts, schedules: mockSchedules,
      rules: mockRules.map(r => ({ ...r, log: [...r.log] })), enrollments: mockEnrollments };
    return { ...init, bindings: allBindings(init) };
  }),

  rebindAll: () => set((s) => ({ bindings: allBindings(s) })),

  submitRule: (rule, schedule) => set((s) => {
    // ① 지배관계: 같은 scope의 기존 바인딩 요율표(대표: BASE) 대비 전 구간 비교
    const targetProducts = s.products.filter((p) => scopeMatches(rule.scope, p));
    const incumbents = s.rules.filter((r) => r.status === '활성' &&
      targetProducts.some((p) => scopeMatches(r.scope, p)));
    const sample = (p: Product) => (price: number): Execution =>
      ({ accountId: 'SIM', product: p, session: p.sessions[0], price, qty: 10, notional: price * 10 });
    const dominanceOk = incumbents.every((inc) => targetProducts.every((p) =>
      dominates(schedule, s.schedules.find((x) => x.id === inc.scheduleId)!, sample(p))));
    // ② 역마진: 표본 체결에서 회사부담 > 자사 수취
    const probe = calcFee(schedule, sample(targetProducts[0])(100));
    const ownReceived = probe.lines.filter((l) => l.kind === '자사' && l.payer === '고객부과')
      .reduce((a, l) => a + l.amount, 0);
    const reverseMargin = probe.companyBorne > ownReceived;
    // ③ 시뮬레이션: 대상 계좌 × 표본 60건 기준 감면액
    const targets = s.accounts.filter((a) => isTarget({ ...rule, status: '활성' }, a, s.enrollments));
    const saving = targets.length * targetProducts.length * 60 *
      Math.max(0, calcFee(s.schedules.find((x) => x.id === incumbents[0]?.scheduleId)
        ?? schedule, sample(targetProducts[0])(100)).customerTotal - probe.customerTotal);
    const submitted: FeeRule = { ...rule, status: '승인대기',
      warnings: { dominance: dominanceOk, reverseMargin },
      sim: { targets: targets.length, saving: Math.round(saving) },
      log: [...rule.log, `${TODAY} 기안 상신 (${rule.createdBy})`] };
    return { schedules: [...s.schedules.filter((x) => x.id !== schedule.id), schedule],
      rules: [...s.rules.filter((x) => x.id !== rule.id), submitted] };
  }),

  approveRule: (id) => set((s) => {
    const rules = s.rules.map((r) => r.id === id
      ? { ...r, status: '활성' as const, log: [...r.log, `${TODAY} 승인 → 활성`] } : r);
    const next = { ...s, rules };
    return { rules, bindings: allBindings(next) };
  }),

  rejectRule: (id, reason) => set((s) => ({
    rules: s.rules.map((r) => r.id === id
      ? { ...r, status: '반려' as const, log: [...r.log, `${TODAY} 반려: ${reason}`] } : r),
  })),

  extendNegotiated: (id, newEndDate) => set((s) => {
    const rules = s.rules.map((r) => r.id === id
      ? { ...r, endDate: newEndDate, log: [...r.log, `${TODAY} 기간 연장 → ${newEndDate}`] } : r);
    const next = { ...s, rules };
    return { rules, bindings: allBindings(next) };
  }),
}));

useStore.getState().reset(); // 초기 바인딩 생성
```

- [ ] **Step 4: 통과 확인 & 커밋**

```bash
npx vitest run   # 기대: 전체 passed
git add src/store/useStore.ts src/store/useStore.test.ts
git commit -m "feat: 스토어 + 워크플로우 액션 (상신/승인/반려/연장/rebindAll)"
```

---

### Task 6: 앱 셸 + 대시보드 화면

**Files:**
- Create: `src/styles.css`, `src/screens/Dashboard.tsx`
- Modify: `src/App.tsx`, `src/main.tsx` (styles import)

**Interfaces:**
- Consumes: `useStore`
- Produces: `App`이 탭 5개(대시보드/이벤트 등록/승인함/협수 관리/계좌 조회)를 렌더. 이후 태스크는 각자 화면 컴포넌트를 `src/screens/`에 만들고 App의 자리 표시자를 교체.

- [ ] **Step 1: App 셸 작성** — `src/App.tsx`

```tsx
import { useState } from 'react';
import Dashboard from './screens/Dashboard';

const TABS = ['대시보드', '이벤트 등록', '승인함', '협수 관리', '계좌 조회'] as const;
type Tab = typeof TABS[number];

export default function App() {
  const [tab, setTab] = useState<Tab>('대시보드');
  return (
    <div className="app">
      <header>
        <h1>수수료 이벤트 플랫폼 <span className="badge">v0 프로토타입</span></h1>
        <nav>{TABS.map(t => (
          <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}</nav>
      </header>
      <main>
        {tab === '대시보드' && <Dashboard />}
        {tab === '이벤트 등록' && <p>구현 예정 (Task 7)</p>}
        {tab === '승인함' && <p>구현 예정 (Task 8)</p>}
        {tab === '협수 관리' && <p>구현 예정 (Task 9)</p>}
        {tab === '계좌 조회' && <p>구현 예정 (Task 10)</p>}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: 대시보드 작성** — `src/screens/Dashboard.tsx`

활성 룰 테이블(이름/유형/적용형태/기간/기간 진행률 bar/대상자 수), 요약 카드 3장(활성 이벤트 수, 총 바인딩 수, 역마진 경고 룰 수). 전부 `useStore` 조회만.

```tsx
import { useStore } from '../store/useStore';
import { TODAY } from '../domain/types';

export default function Dashboard() {
  const { rules, bindings, accounts, enrollments } = useStore();
  const active = rules.filter(r => r.status === '활성');
  const pct = (r: typeof rules[0]) => {
    const [s, e, t] = [Date.parse(r.startDate), Date.parse(r.endDate), Date.parse(TODAY)];
    return Math.min(100, Math.max(0, Math.round(((t - s) / (e - s)) * 100)));
  };
  return (
    <section>
      <div className="cards">
        <div className="card"><h3>{active.filter(r => r.type === 'EVENT').length}</h3><p>활성 이벤트</p></div>
        <div className="card"><h3>{bindings.length}</h3><p>바인딩 (계좌×품목)</p></div>
        <div className="card warn"><h3>{active.filter(r => r.warnings.reverseMargin).length}</h3><p>역마진 경고 룰</p></div>
      </div>
      <h2>활성 수수료 룰</h2>
      <table>
        <thead><tr><th>이름</th><th>유형</th><th>적용형태</th><th>기간</th><th>진행률</th><th>대상</th><th>경고</th></tr></thead>
        <tbody>{active.map(r => (
          <tr key={r.id}>
            <td>{r.name}</td><td>{r.type}</td><td>{r.applyMode}</td>
            <td>{r.startDate} ~ {r.endDate}</td>
            <td><div className="bar"><div style={{ width: `${pct(r)}%` }} /></div></td>
            <td>{r.type === 'BASE' ? '전체' :
              r.applyMode === '신청형' ? `신청 ${enrollments.filter(e => e.ruleId === r.id).length}건` :
              r.applyMode === '휴면복귀형' ? `휴면복귀 ${accounts.filter(a => a.dormantReturned).length}명` :
              (r.targetAccountIds ? `지정 ${r.targetAccountIds.length}명` : '전체')}</td>
            <td>{r.warnings.reverseMargin ? '⚠ 역마진' : ''}</td>
          </tr>))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 3: 스타일** — `src/styles.css` 작성 후 `src/main.tsx`에서 `import './styles.css'` (기존 index.css import 교체). 헤더/탭/카드/테이블/진행바/badge/warn/wizard 공용 클래스 정의. 시스템 폰트, 담백한 관리도구 톤 (파랑 계열 accent 1색).

- [ ] **Step 4: 수동 확인 & 커밋**

```bash
npm run dev
# 브라우저: 탭 5개 표시, 대시보드에 mock 활성 룰과 카드 렌더 확인
git add -A && git commit -m "feat: 앱 셸 + 대시보드"
```

---

### Task 7: 이벤트 등록 위저드

**Files:**
- Create: `src/screens/Wizard.tsx`
- Modify: `src/App.tsx` ('이벤트 등록' 자리 표시자 교체)

**Interfaces:**
- Consumes: `useStore.submitRule`, `calcFee`, `dominates`, `scopeMatches`, `isTarget`
- Produces: 6단계 위저드. 완료 시 `submitRule(rule, schedule)` 호출 → 승인함에 나타남.

- [ ] **Step 1: 위저드 구현** — `src/screens/Wizard.tsx`

단일 컴포넌트, `useState`로 단계(1~6)와 폼 상태 관리. 각 단계:

1. **기본정보**: 이름(text), 유형(EVENT/NEGOTIATED select), 적용형태(4종 select), 시작일/종료일(date). NEGOTIATED 선택 시 조건 입력(지표 select + 임계값 number + 액션 select) 노출.
2. **적용범위**: 상품군 select → 해당 상품군의 거래소/세션/통화 checkbox 목록(전체 기본 체크) → 품목: 검색 input + 체크 리스트 + **textarea "품목 코드 붙여넣기 (프로토타입: CSV)"**(콤마/개행 구분 파싱해 체크 반영) + 제외 품목 textarea.
3. **요율표**: "기존 요율표 복사" select(선택 시 구성요소 복제) + 구성요소 행 편집기(이름/kind/부담주체/방식/값 입력, 행 추가·삭제. 방식=구간표면 구간 행 편집기 노출).
4. **대상**: 라디오 — 전체 / 계좌 리스트(textarea "계좌번호 붙여넣기 (프로토타입: CSV)"). 신청형·가입형·휴면복귀형이면 "트리거 기반 자동 대상" 안내문만.
5. **시뮬레이션**: `submitRule`이 계산할 것과 동일한 로직을 미리 보여줌 — 대상 계좌 수, 매칭 품목 목록, 표본 체결(가격 100, 수량 10) 기준 현행 vs 신규 수수료 비교 표, 지배관계 검증 결과(불통과면 다음 단계 진행 차단 + 원인 문구), 역마진 경고.
6. **기안 상신**: 요약 카드 + [상신] 버튼 → `submitRule` 호출 → "승인함에서 결재 대기 중" 완료 화면.

폼 상태에서 `FeeRule`/`FeeSchedule` 객체 조립 시 id는 `R-${Date.now()}`/`S-${Date.now()}`.

- [ ] **Step 2: 수동 확인**

```bash
npm run dev
# 6A 대상 이벤트를 끝까지 등록 → 승인함 탭 자리 표시자 대신 store에 승인대기 룰 생긴 것을
# 대시보드가 아닌 React devtools 또는 임시 console.log로 확인
# 지배관계 불통과 요율(비싼 요율) 입력 시 5단계에서 차단되는지 확인
```

- [ ] **Step 3: 커밋**

```bash
git add -A && git commit -m "feat: 이벤트 등록 위저드 (6단계, 시뮬레이션·지배관계 검증 포함)"
```

---

### Task 8: 승인함

**Files:**
- Create: `src/screens/Approvals.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useStore` (`rules` 중 `승인대기`, `approveRule`, `rejectRule`)
- Produces: 결재 화면. 승인 시 대시보드·계좌 조회에 즉시 반영(rebindAll).

- [ ] **Step 1: 구현** — `src/screens/Approvals.tsx`

승인대기 룰 카드 목록. 카드 내용: 기본정보 요약, 적용범위 요약(상품군·거래소·품목 수), 요율표 구성요소 테이블, **검증 결과 배지 3종** — `지배관계 ✓/✗`, `역마진 ⚠/-`, `시뮬레이션: 대상 N명 · 예상 감면 X원`. 하단 [승인] 버튼과 [반려] 버튼(반려 사유 input 필수). 처리 후 목록에서 제거되고 log에 기록. 빈 목록이면 "대기 중인 결재가 없습니다".

- [ ] **Step 2: 수동 확인 & 커밋**

```bash
npm run dev
# 위저드로 상신한 건이 승인함에 표시 → 승인 → 대시보드 활성 룰에 나타나는지 확인
git add -A && git commit -m "feat: 승인함 (검증 배지 + 승인/반려)"
```

---

### Task 9: 협수 관리

**Files:**
- Create: `src/screens/Negotiated.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useStore` (`rules` 중 NEGOTIATED, `enrollments`, `accounts`, `extendNegotiated`), `evalCondition`
- Produces: 협수 현황 + 조건 평가 + 원클릭 연장.

- [ ] **Step 1: 구현** — `src/screens/Negotiated.tsx`

NEGOTIATED 룰 × 등록 계좌(Enrollment) 조합 테이블:
- 계좌/룰 이름/기간/만료까지 D-일수 (30일 이내면 `warn` 강조)
- **조건 게이지**: `min(100, value/threshold*100)%` bar + "6개월평균자산 8.5억 / 기준 5억 (충족)" 형식 라벨 — `evalCondition` 결과에 따라 충족/미충족 색상
- 액션: 충족이면 [6개월 연장] 버튼 → `extendNegotiated(id, endDate+6개월)` (날짜 계산은 `addMonths(dateStr, 6)` 헬퍼를 파일 내 작성). 미충족이면 버튼 비활성 + "조건 미충족" 라벨
- 행 펼치면 `rule.log` 이력 표시

- [ ] **Step 2: 수동 확인 & 커밋**

```bash
npm run dev
# mock의 충족 계좌는 연장 버튼 활성, 미충족 계좌는 비활성 확인. 연장 클릭 → 기간·log 갱신 확인
git add -A && git commit -m "feat: 협수 관리 (조건 게이지 + 원클릭 연장)"
```

---

### Task 10: 계좌 조회 + README + 최종 검증

**Files:**
- Create: `src/screens/AccountView.tsx`, `README.md`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useStore.bindings`, `calcFee`
- Produces: 워크플로우의 마지막 확인 지점 — "이 계좌에 왜 이 수수료가 적용되나".

- [ ] **Step 1: 구현** — `src/screens/AccountView.tsx`

계좌 select → 해당 계좌의 바인딩 테이블(품목/적용 요율표/근거 `reason`/유효기간/출처 룰 이름). 행 선택 시 우측 패널:
- 요율표 구성요소 상세 (이름/부담주체/방식/값 — 회사부담 라인은 강조)
- **체결 시뮬레이터**: 가격·수량 input → `calcFee` 실행 → 구성요소별 금액 라인 + 고객부과 합계 + 회사부담 합계 표시 (구간표면 어느 구간에 걸렸는지 표시)

- [ ] **Step 2: README 작성** — 실행 방법(`npm install && npm run dev`), 시연 시나리오(등록→승인→계좌 조회 확인 순서 스크립트), 프로토타입 한계(mock/CSV 대체/고정 날짜), 스펙 문서 링크.

- [ ] **Step 3: 최종 검증 & 커밋**

```bash
npx vitest run    # 기대: 전체 passed
npm run build     # 기대: 오류 없음
npm run dev
# 시연 시나리오 전체 클릭: 위저드 등록 → 승인함 승인 → 대시보드 반영 → 계좌 조회에서
# 해당 품목 바인딩의 sourceRule이 새 이벤트로 바뀌고 시뮬레이터 수수료가 인하됐는지 확인
git add -A && git commit -m "feat: 계좌 조회 + README + v0 완성"
```

---

### Task 11: 업무 프로세스 정의서 + 테이블 설계서 (실 시스템 이관용)

**Files:**
- Create: `docs/business-process.md`, `docs/table-design.md`

**Interfaces:**
- Consumes: 스펙 문서 + 프로토타입에서 확정된 타입/로직 (`src/domain/types.ts`, `useStore` 액션)
- Produces: 원장 개발팀·현업에 전달 가능한 문서 2종

- [ ] **Step 1: 업무 프로세스 정의서** — `docs/business-process.md`

프로세스별로 [트리거 → 행위자 → 시스템 처리 → 산출물] 형식의 표 + mermaid sequenceDiagram:
① 이벤트 등록~승인~바인딩 반영, ② 신청형 고객 신청, ③ 협수 조건 평가~연장, ④ 휴면복귀 감지 적용, ⑤ 일 배치(만료 처리 + reconciliation), ⑥ 체결 시 수수료 적용(원장 관점). 각 프로세스에 현행(as-is) 대비 변경점 한 줄.

- [ ] **Step 2: 테이블 설계서** — `docs/table-design.md`

`types.ts`의 6개 엔티티를 물리 테이블로 전개: 테이블 정의(컬럼/타입/PK/FK/인덱스, Oracle 기준 DDL 초안), mermaid erDiagram, 그리고 바인딩 테이블은 "원장-플랫폼 계약" 절을 별도로 두어 조회 시나리오(체결 시 `WHERE account_id=? AND scope_key=? AND valid_from<=today<=valid_to`)와 인덱스 설계 명시. 구간표는 `FEE_RATE_BAND` 자식 테이블로 정규화.

- [ ] **Step 3: 커밋**

```bash
git add docs/ && git commit -m "docs: 업무 프로세스 정의서 + 테이블 설계서"
```

---

## Self-Review 결과

- **스펙 커버리지**: 관리 화면 1~5 → Task 6~10, 바인딩 엔진(최저가/지배관계/역마진/시뮬레이션) → Task 2~5, 협수 조건 평가 → Task 5·9, 스펙 9장 v0 범위 충족. 스펙 5.1의 트리거 중 프로토타입에서 시연되는 것은 승인/연장/신청(Enrollment mock)이며 배치·휴면감지는 mock 상태로 표현 — v0 범위에 부합.
- **타입 일관성**: `FeeResult.customerTotal/companyBorne`, `rebindAccount` 시그니처, `submitRule(rule, schedule)` — Task 간 참조 일치 확인.
- **플레이스홀더**: UI 태스크(7~10)는 화면 명세를 산문+구조로 기술(전체 JSX 나열 대신). 엔진·스토어는 전체 코드 수록.

