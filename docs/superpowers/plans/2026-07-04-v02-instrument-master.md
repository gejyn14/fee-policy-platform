# v0.2 종목 마스터·차원 관련성·대량 선택 UX 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가상 원장 연동 종목 마스터(~3,000건, 조회/CSV등록/동기화), 상품군별 차원 관련성(상품군 1단계 이동, 파생은 거래소 숨김/필터), 대량 종목 선택 듀얼 패널 픽커.

**Architecture:** `src/masterdata/`(결정적 생성기+Product 파생) → 스토어(instruments 상태, products 파생, sync/register 액션) → 화면(InstrumentMaster 탭, InstrumentPicker 공용, Wizard 재구성). 엔진(src/domain) 무수정 — 국내주식 NXT 병행은 Product 확장으로 흡수. 스펙: `docs/superpowers/specs/2026-07-04-v02-instrument-master-design.md` **먼저 읽을 것**.

**Tech Stack:** 기존 동일(Vite+React+TS, zustand, Vitest). 신규 의존성 금지(가상 스크롤 없음 — cap+검색).

## Global Constraints

- UI 문구 전부 한국어. src/domain/ 수정 금지(React-free 유지). `Math.random`/`Date.now` 금지 — 생성기는 시드 LCG로 결정적.
- 레거시 6코드(005930, AAPL, K200OPT, 6A, 6B, GOLD99)는 생성 마스터에 기존과 동일 속성으로 포함 — 기존 테스트 안정성의 전제.
- 기존 테스트는 유지가 원칙. 수량을 정확 단언하는 기존 테스트가 마스터 확장으로 깨지면 조건 단언(≥ 또는 특정 코드 존재)으로의 조정만 허용 — 로직 우회 금지, 조정 시 리포트에 명시.
- 리스트 UI는 전부 표시 cap(마스터/픽커 100, chip 50, 계좌조회 50) + "그 외 N건" 안내.
- 각 태스크 완료 시 `npx vitest run` + `npm run build` 확인. 커밋 메시지 끝 `Co-Authored-By: Claude <noreply@anthropic.com>`.
- 병렬 실행 시: 태스크 간 파일 겹침 금지 원칙 유지, 에이전트는 커밋 금지(컨트롤러가 배리어에서 순차 커밋).

## 파일 구조

```
src/masterdata/instruments.ts   # Instrument 타입 + generateInstruments() + NEW_LISTING_POOL (Task 1)
src/masterdata/derive.ts        # deriveProducts() (Task 2)
src/screens/pickerLogic.ts      # 선택 상태 순수 로직 (Task 3)
src/store/useStore.ts           # instruments/products 통합 + sync/register (Task 4)
src/screens/InstrumentPicker.tsx# 듀얼 패널 픽커 (Task 5)
src/screens/Wizard.tsx          # 상품군 1단계 + 차원 매트릭스 + 픽커 통합 (Task 6)
src/screens/InstrumentMaster.tsx# 종목 마스터 탭 (Task 7)
src/App.tsx                     # 탭 추가 (Task 7)
src/screens/AccountView.tsx     # 검색+cap (Task 8)
```

의존: T1→T2→T4, T3 독립, T5←(T3,T4), T6←(T4,T5), T7←T4, T8←T4. 병렬 후보: [T1∥T3] → [T2] → [T4] → [T5∥T7] → [T6∥T8].

---

### Task 1: Instrument 타입 + 결정적 생성기 (TDD)

**Files:**
- Create: `src/masterdata/instruments.ts`
- Test: `src/masterdata/instruments.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Instrument {
  assetClass: AssetClass; exchange: string; code: string; name: string;
  currency: string; sessions: string[];
  status: '정상' | '거래정지' | '상장폐지';
  nxtTradable?: boolean; listedAt: string;
}
export function generateInstruments(): Instrument[]   // ~3,000건, 호출마다 동일 결과
export const NEW_LISTING_POOL: Instrument[]            // ~30건, 마스터와 코드 비중복
```

- [ ] **Step 1: 실패하는 테스트** — `src/masterdata/instruments.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { generateInstruments, NEW_LISTING_POOL } from './instruments';

describe('generateInstruments', () => {
  const all = generateInstruments();

  it('결정적: 두 번 호출해도 동일', () => {
    expect(generateInstruments()).toEqual(all);
  });

  it('총량과 상품군 분포', () => {
    expect(all.length).toBeGreaterThanOrEqual(2500);
    const by = (ac: string) => all.filter(i => i.assetClass === ac).length;
    expect(by('국내주식')).toBeGreaterThanOrEqual(1500);
    expect(by('해외주식')).toBeGreaterThanOrEqual(800);
    expect(by('해외파생')).toBeGreaterThanOrEqual(35);
    expect(by('국내파생')).toBeGreaterThanOrEqual(10);
    expect(by('금현물')).toBeGreaterThanOrEqual(1);
  });

  it('레거시 6코드가 기존 속성으로 포함', () => {
    const find = (c: string) => all.find(i => i.code === c)!;
    expect(find('005930')).toMatchObject({ assetClass: '국내주식', exchange: 'KRX', currency: 'KRW', status: '정상', nxtTradable: true });
    expect(find('AAPL')).toMatchObject({ assetClass: '해외주식', exchange: 'NASDAQ', currency: 'USD' });
    expect(find('K200OPT')).toMatchObject({ assetClass: '국내파생', exchange: 'KRX' });
    expect(find('6A')).toMatchObject({ assetClass: '해외파생', exchange: 'CME', currency: 'USD' });
    expect(find('6B')).toMatchObject({ assetClass: '해외파생', exchange: 'CME' });
    expect(find('GOLD99')).toMatchObject({ assetClass: '금현물', exchange: 'KRX' });
  });

  it('코드 유일성 + NXT 병행/상태 존재', () => {
    expect(new Set(all.map(i => i.code)).size).toBe(all.length);
    expect(all.filter(i => i.nxtTradable).length).toBeGreaterThanOrEqual(500);
    expect(all.some(i => i.status === '거래정지')).toBe(true);
    expect(all.some(i => i.status === '상장폐지')).toBe(true);
  });

  it('신규상장 풀은 마스터와 코드 비중복', () => {
    const codes = new Set(all.map(i => i.code));
    expect(NEW_LISTING_POOL.length).toBeGreaterThanOrEqual(20);
    expect(NEW_LISTING_POOL.every(i => !codes.has(i.code))).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/masterdata/instruments.test.ts` → FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `src/masterdata/instruments.ts`. 핵심 구조(변수·상수는 이대로, 내부 목록은 자유 확장):

```ts
import type { AssetClass } from '../domain/types';

export interface Instrument { /* Interfaces 블록과 동일 */ }

// 시드 LCG — Math.random 금지 (결정성)
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32);
}

const LEGACY: Instrument[] = [
  { assetClass: '국내주식', exchange: 'KRX', code: '005930', name: '삼성전자', currency: 'KRW', sessions: ['정규'], status: '정상', nxtTradable: true, listedAt: '1975-06-11' },
  { assetClass: '해외주식', exchange: 'NASDAQ', code: 'AAPL', name: '애플', currency: 'USD', sessions: ['정규', '프리마켓'], status: '정상', listedAt: '1980-12-12' },
  { assetClass: '국내파생', exchange: 'KRX', code: 'K200OPT', name: 'KOSPI200옵션', currency: 'KRW', sessions: ['정규', '야간'], status: '정상', listedAt: '1997-07-07' },
  { assetClass: '해외파생', exchange: 'CME', code: '6A', name: 'Australian Dollar', currency: 'USD', sessions: ['주간', '야간'], status: '정상', listedAt: '1987-01-13' },
  { assetClass: '해외파생', exchange: 'CME', code: '6B', name: 'British Pound', currency: 'USD', sessions: ['주간', '야간'], status: '정상', listedAt: '1975-02-13' },
  { assetClass: '금현물', exchange: 'KRX', code: 'GOLD99', name: 'KRX 금 99.99', currency: 'KRW', sessions: ['정규'], status: '정상', listedAt: '2014-03-24' },
];

export function generateInstruments(): Instrument[] {
  const rnd = lcg(20260704);
  const out: Instrument[] = [...LEGACY];
  // 국내주식 ~1800: 코드 '0' + 5자리 순번(레거시와 충돌 없는 대역), 이름 '한국기업NNNN'
  //   nxtTradable = rnd() < 0.5, status: rnd()<0.01 거래정지, <0.005 상장폐지(누적 아님, else 정상)
  // 해외주식 ~1000: NASDAQ/NYSE/AMEX 로테이션, 코드 알파벳 조합(USQ0001 형태 순번), USD
  // 해외파생 ~40: 실명 위주 하드코딩 목록(6E,6J,6C,ES,NQ,YM,CL,GC,SI,ZN,ZB,FDAX,FESX,TW,HSI,NK 등 + 거래소 매핑)
  // 국내파생 ~14: K200FUT,MINI,WKLY,KQ150FUT,국채3Y,10Y,USDFUT,주식선물,주식옵션 등 KRX 고정
  // 금현물: GOLD10 (미니금) 1건 추가
  // listedAt: 1990~2025 범위를 rnd로 결정적 산출
  ...
  return out;
}

export const NEW_LISTING_POOL: Instrument[] = [ /* 국내주식 신규상장 20 + 해외주식 8 + 해외파생 2, 코드 대역 분리('9'로 시작 등) */ ];
```

- [ ] **Step 4: 통과 확인 & 커밋** — `npx vitest run src/masterdata/instruments.test.ts` 전부 PASS → `git commit -m "feat: 종목 마스터 결정적 생성기 (~3,000건)"`

---

### Task 2: deriveProducts (TDD)

**Files:**
- Create: `src/masterdata/derive.ts`
- Test: `src/masterdata/derive.test.ts`

**Interfaces:**
- Consumes: `Instrument` (Task 1), `Product` (src/domain/types.ts — { assetClass, exchange, code, name, currency, sessions })
- Produces: `export function deriveProducts(instruments: Instrument[]): Product[]`

- [ ] **Step 1: 실패하는 테스트** — `src/masterdata/derive.test.ts`

```ts
import { it, expect } from 'vitest';
import { deriveProducts } from './derive';
import type { Instrument } from './instruments';

const base: Instrument = { assetClass: '국내주식', exchange: 'KRX', code: '005930', name: '삼성전자',
  currency: 'KRW', sessions: ['정규'], status: '정상', nxtTradable: true, listedAt: '1975-06-11' };

it('NXT 병행 국내주식은 KRX/NXT 2건으로 확장', () => {
  const ps = deriveProducts([base]);
  expect(ps).toHaveLength(2);
  expect(ps.map(p => p.exchange).sort()).toEqual(['KRX', 'NXT']);
  expect(ps.every(p => p.code === '005930')).toBe(true);
});

it('nxtTradable 아니면 1건', () => {
  expect(deriveProducts([{ ...base, nxtTradable: false }])).toHaveLength(1);
});

it('상장폐지는 제외, 거래정지는 포함', () => {
  expect(deriveProducts([{ ...base, status: '상장폐지' }])).toHaveLength(0);
  expect(deriveProducts([{ ...base, nxtTradable: false, status: '거래정지' }])).toHaveLength(1);
});

it('비국내주식은 nxtTradable 무관 1건', () => {
  const fut: Instrument = { assetClass: '해외파생', exchange: 'CME', code: '6A', name: 'AUD',
    currency: 'USD', sessions: ['주간'], status: '정상', listedAt: '1987-01-13' };
  expect(deriveProducts([fut])).toHaveLength(1);
});
```

- [ ] **Step 2: 실패 확인** → **Step 3: 구현** — `src/masterdata/derive.ts`

```ts
import type { Product } from '../domain/types';
import type { Instrument } from './instruments';

export function deriveProducts(instruments: Instrument[]): Product[] {
  const out: Product[] = [];
  for (const i of instruments) {
    if (i.status === '상장폐지') continue;
    const p: Product = { assetClass: i.assetClass, exchange: i.exchange, code: i.code,
      name: i.name, currency: i.currency, sessions: i.sessions };
    out.push(p);
    if (i.assetClass === '국내주식' && i.nxtTradable) out.push({ ...p, exchange: 'NXT' });
  }
  return out;
}
```

- [ ] **Step 4: 통과 & 커밋** — `git commit -m "feat: Instrument→Product 파생 (NXT 병행 확장)"`

---

### Task 3: 픽커 선택 로직 순수 함수 (TDD) — Task 1·2와 독립

**Files:**
- Create: `src/screens/pickerLogic.ts`
- Test: `src/screens/pickerLogic.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Selection { products: string[] | '*'; excludeProducts: string[]; exchanges: string[] | '*' }
export function toggleCode(s: Selection, code: string): Selection      // 지정 모드: 선택 토글 / 전체(*) 모드: 제외 토글
export function selectCodes(s: Selection, codes: string[]): Selection  // 지정 모드로 merge(중복 제거, 제외에서 삭제)
export function selectAllMode(s: Selection, exchanges: string[] | '*'): Selection // products='*' + exchanges 설정, 제외 유지
export function clearSelection(s: Selection): Selection                // { products: [], excludeProducts: [], exchanges: '*' }
export function removeChip(s: Selection, code: string): Selection      // 선택/제외 어느 쪽이든 code 제거
export function summarize(s: Selection): string                        // '전체' | '전체 · 제외 M건' | '지정 N건'
```

- [ ] **Step 1: 실패하는 테스트** — `src/screens/pickerLogic.test.ts`

```ts
import { it, expect } from 'vitest';
import { toggleCode, selectCodes, selectAllMode, clearSelection, removeChip, summarize } from './pickerLogic';
import type { Selection } from './pickerLogic';

const empty: Selection = { products: [], excludeProducts: [], exchanges: '*' };

it('지정 모드에서 toggleCode는 선택을 넣고 뺀다', () => {
  const a = toggleCode(empty, '005930');
  expect(a.products).toEqual(['005930']);
  expect(toggleCode(a, '005930').products).toEqual([]);
});

it('전체(*) 모드에서 toggleCode는 제외를 토글한다', () => {
  const all: Selection = { products: '*', excludeProducts: [], exchanges: ['CME'] };
  const a = toggleCode(all, '6E');
  expect(a.excludeProducts).toEqual(['6E']);
  expect(toggleCode(a, '6E').excludeProducts).toEqual([]);
});

it('selectCodes는 merge + 제외 해제', () => {
  const s: Selection = { products: ['6A'], excludeProducts: ['6B'], exchanges: '*' };
  const a = selectCodes(s, ['6B', '6C', '6A']);
  expect([...a.products as string[]].sort()).toEqual(['6A', '6B', '6C']);
  expect(a.excludeProducts).toEqual([]);
});

it('selectAllMode → 전체+거래소, clearSelection → 초기화', () => {
  const a = selectAllMode(empty, ['CME']);
  expect(a.products).toBe('*');
  expect(a.exchanges).toEqual(['CME']);
  expect(clearSelection(a)).toEqual(empty);
});

it('removeChip은 선택·제외 양쪽에서 제거', () => {
  expect(removeChip({ products: ['6A', '6B'], excludeProducts: [], exchanges: '*' }, '6A').products).toEqual(['6B']);
  expect(removeChip({ products: '*', excludeProducts: ['6E'], exchanges: '*' }, '6E').excludeProducts).toEqual([]);
});

it('summarize', () => {
  expect(summarize({ products: '*', excludeProducts: [], exchanges: '*' })).toBe('전체');
  expect(summarize({ products: '*', excludeProducts: ['6E'], exchanges: '*' })).toBe('전체 · 제외 1건');
  expect(summarize({ products: ['6A'], excludeProducts: [], exchanges: '*' })).toBe('지정 1건');
});
```

- [ ] **Step 2: 실패 확인** → **Step 3: 구현** (전부 불변 반환, spread 기반 — 테스트가 요구하는 동작 그대로) → **Step 4: 통과 & 커밋** — `git commit -m "feat: 픽커 선택 로직 순수 함수"`

---

### Task 4: 스토어 통합 — instruments/products + sync/register (TDD)

**Files:**
- Modify: `src/store/useStore.ts`, `src/store/mock.ts`(mockProducts 사용처 대체), 필요 시 `src/store/useStore.test.ts` 기존 단언 조건화
- Test: `src/store/useStore.test.ts` (추가)

**Interfaces:**
- Consumes: `generateInstruments`, `NEW_LISTING_POOL` (T1), `deriveProducts` (T2)
- Produces (스토어 확장): `instruments: Instrument[]`, `products: Product[]`(instruments에서 파생·동기 유지), `syncFromLedger(): { added: number }`, `registerInstruments(rows: Instrument[]): { accepted: number; rejected: string[] }`(중복 코드 거부), `syncCursor: number`(풀 소진 추적)

- [ ] **Step 1: 실패하는 테스트 추가** — `src/store/useStore.test.ts`

```ts
it('초기 상태: 마스터 기반 products (레거시 포함, 대량)', () => {
  const s = useStore.getState();
  expect(s.products.length).toBeGreaterThanOrEqual(2500);
  expect(s.products.some(p => p.exchange === 'NXT' && p.code === '005930')).toBe(true);
  expect(s.products.some(p => p.exchange === 'CME' && p.code === '6A')).toBe(true);
});

it('syncFromLedger: 결정적 유입 + products/bindings 갱신, 소진 시 0', () => {
  const before = useStore.getState().products.length;
  const r1 = useStore.getState().syncFromLedger();
  expect(r1.added).toBeGreaterThan(0);
  expect(useStore.getState().products.length).toBeGreaterThan(before);
  let total = r1.added;
  for (let i = 0; i < 20; i++) total += useStore.getState().syncFromLedger().added;
  expect(useStore.getState().syncFromLedger().added).toBe(0); // 풀 소진
});

it('registerInstruments: 중복 코드 거부', () => {
  const dup = { ...useStore.getState().instruments[0] };
  const r = useStore.getState().registerInstruments([dup]);
  expect(r.accepted).toBe(0);
  expect(r.rejected).toContain(dup.code);
});

it('성능: rebindAll이 2초 이내', () => {
  const t0 = performance.now();
  useStore.getState().rebindAll();
  expect(performance.now() - t0).toBeLessThan(2000);
});
```

- [ ] **Step 2: 실패 확인** → **Step 3: 구현**:
  - `useStore.ts`: `mockProducts` import 제거 → `const MASTER = generateInstruments()`, 초기/`reset()`에서 `instruments: MASTER`, `products: deriveProducts(MASTER)`, `syncCursor: 0`.
  - `syncFromLedger`: `NEW_LISTING_POOL.slice(cursor, cursor + 5)`를 append(결정적 5건씩), instruments/products/bindings(`allBindings`) 일괄 갱신, `{ added }` 반환.
  - `registerInstruments`: 기존 코드 집합과 대조해 중복은 `rejected`로, 나머지 append 후 재파생+rebind.
  - `mock.ts`의 `mockProducts`는 다른 참조가 없으면 제거(있으면 유지하되 스토어는 미사용) — 실행자가 grep으로 확인.
  - 기존 테스트 중 products 6건 전제가 깨지는 단언이 있으면 조건 단언으로 조정하고 리포트 명시.

- [ ] **Step 4: 전체 통과 + 빌드 & 커밋** — `npx vitest run`(전체), `npm run build` → `git commit -m "feat: 스토어 종목 마스터 통합 (sync/register/성능 가드)"`

---

### Task 5: InstrumentPicker 듀얼 패널 컴포넌트

**Files:**
- Create: `src/screens/InstrumentPicker.tsx`
- Modify: `src/styles.css` (추가만 — 듀얼 패널 레이아웃/chip 클래스)

**Interfaces:**
- Consumes: `Selection`+로직 함수(T3), `useStore().instruments`(T4), `parseCsvCodes`(Wizard.tsx에서 export 중 — import 경로 확인)
- Produces: `<InstrumentPicker assetClass={AssetClass} value={Selection} onChange={(s: Selection) => void} />` — 스펙 §3의 듀얼 패널 그대로.

- [ ] **Step 1: 구현** — 스펙 §3 구조를 그대로:
  - 좌: 검색(코드/이름, 대소문자 무시) / 거래소 chip(해당 상품군의 거래소별 카운트, 국내주식·국내파생·금현물은 미표시) / 상태 필터(정상/거래정지 — 상장폐지는 파생에서 이미 제외됨이나 마스터 원본을 쓰므로 여기서 status!=='상장폐지' 필터) / 결과 cap 100 + "그 외 N건 — 검색으로 좁히세요" / 행 클릭 = `toggleCode` / [검색결과 전체 선택] = `selectCodes(현재 필터 결과 전체 코드)` / [<거래소> 전체 선택] = `selectAllMode` / CSV textarea + [반영] = `selectCodes(인식분)` + 인식/무시 카운트.
  - 우: `summarize()` 모드 라벨 / 선택 chip cap 50(× = `removeChip`) / 제외 chip(× = `removeChip`) / [전체 대상으로 전환] = `selectAllMode(s, '*')` / [모두 지우기] = `clearSelection`. 거래정지 종목 chip에 ⚠ 배지.
  - 표시용 이름 조회는 instruments에서 code→name 맵(useMemo).
- [ ] **Step 2: 검증 & 커밋** — `npx vitest run` 유지 + `npm run build` clean + dev 서버 렌더 확인(임시로 페이지에 붙이지 말고 타입/빌드 수준. 실제 화면 확인은 T6에서) → `git commit -m "feat: InstrumentPicker 듀얼 패널"`

---

### Task 6: Wizard 재구성 — 상품군 1단계 + 차원 매트릭스 + 픽커 통합

**Files:**
- Modify: `src/screens/Wizard.tsx`, `src/styles.css`(추가만)

**Interfaces:**
- Consumes: `InstrumentPicker`(T5), `Selection` 로직(T3), 스토어(T4). 스펙 §1.1 매트릭스가 유일 기준.

- [ ] **Step 1: 상품군 이동** — 1단계(기본정보)에 상품군 select 추가, 2단계에서 제거. 상품군 변경 시 scope 관련 폼(선택/제외/거래소/세션) 초기화(기존 handleAssetClassChange 로직 이동).
- [ ] **Step 2: 2단계 조건 렌더** — 매트릭스대로: 국내주식=거래소 체크(KRX/NXT)+세션 체크+픽커 / 해외주식·해외파생=세션 체크+픽커(거래소는 픽커 내 chip·전체선택) / 국내파생=세션(정규/야간)+픽커 / 금현물=픽커만. 통화 UI 전면 제거(scope.currencies는 '*' 고정 저장 — 요율표 차원이라는 v0 결정과 일관).
- [ ] **Step 3: 픽커 통합** — 기존 품목 체크 그리드+CSV textarea+`effectiveItemsSel` render-union 제거, 폼 상태를 `Selection` 하나로 대체(`form.selection`). `buildScope()`는 selection에서 조립(products/excludeProducts/exchanges — 국내주식은 거래소 체크박스가 exchanges를 결정, 그 외는 selection.exchanges). 매칭 카운트·지배관계·시뮬레이션·wizardDraft 보존은 기존 파이프라인 그대로(selection이 form 안에 있으므로 draft에 자동 포함).
- [ ] **Step 4: wizard.test.ts** — `parseCsvCodes`가 픽커로 이동했으면 import 경로만 갱신(테스트 로직 불변). 전체 스위트+빌드 통과 확인.
- [ ] **Step 5: 수동 검증 & 커밋** — dev 서버에서: 국내파생 선택 시 거래소 UI 부재, 국내주식 선택 시 KRX/NXT 체크 노출, 해외파생에서 "CME 전체 선택→6E 제외" 시나리오, 매칭 카운트 정상 → `git commit -m "feat: 위저드 상품군 1단계·차원 매트릭스·픽커 통합"`

---

### Task 7: InstrumentMaster 화면 + 탭 추가

**Files:**
- Create: `src/screens/InstrumentMaster.tsx`
- Modify: `src/App.tsx`(탭 '종목 마스터' 추가), `src/styles.css`(추가만)

**Interfaces:**
- Consumes: 스토어 `instruments/syncFromLedger/registerInstruments`(T4)

- [ ] **Step 1: 구현** — 스펙 §2.5 그대로: 요약 카드(총/상품군별/거래정지) / 검색+상품군·거래소·상태 필터+cap 100 테이블(코드/이름/상품군/거래소/통화/상태 pill/상장일) / CSV 등록 패널(`코드,이름,상품군,거래소,통화` 파싱 → 필수값·상품군 enum·중복 검증 → 수용/거부 미리보기 테이블 → [등록]=registerInstruments) / [원장 동기화] 버튼 → added 건수 + 유입 종목 목록 표시(0건이면 "신규 상장 없음").
- [ ] **Step 2: CSV 파서는 화면 내 순수 함수 export** `parseMasterCsv(text: string, existingCodes: Set<string>): { accepted: Instrument[]; rejected: { line: string; reason: string }[] }` + `src/screens/instrumentMaster.test.ts`에 단위 테스트 3개(정상/enum 오류/중복) — TDD.
- [ ] **Step 3: 검증 & 커밋** — 전체 테스트+빌드+dev 확인(동기화 클릭→대시보드 바인딩 수 증가) → `git commit -m "feat: 종목 마스터 화면 (조회/CSV등록/원장 동기화)"`

---

### Task 8: AccountView 검색+cap + README + 최종 검증

**Files:**
- Modify: `src/screens/AccountView.tsx`, `README.md`

- [ ] **Step 1: AccountView** — 바인딩 테이블에 검색 input(품목코드/이름/근거) + 표시 cap 50 + "그 외 N건 — 검색으로 좁히세요". 행 선택 패널 로직 불변.
- [ ] **Step 2: README** — 시연 시나리오에 종목 마스터(검색→CSV 등록→원장 동기화→바인딩 증가 확인), 위저드 변화(상품군 1단계, 파생 거래소 없음, 듀얼 패널 선택) 반영. 한계 절에 "종목 마스터는 가상 생성 데이터(~3,000건)" 추가.
- [ ] **Step 3: 최종 검증 & 커밋** — `npx vitest run`(기존+신규 전체) + `npm run build` + README 시나리오 클릭 통주 → `git commit -m "feat: 계좌조회 검색·cap + v0.2 README"`

---

## Self-Review 결과

- **스펙 커버리지**: §1.1 매트릭스→T6, §1.2→T6, §1.3→T2(+엔진 무수정 확인은 T2·T4), §2.1~2.2→T1, §2.3→T2, §2.4→T4, §2.5→T7, §3→T3·T5·T6, §4 계좌조회→T8·성능→T4·기존테스트→T4, §5 전 항목→T1~T4·T7 테스트. 누락 없음.
- **타입 일관성**: `Selection`(T3 정의, T5·T6 소비), `Instrument`(T1 정의, T2·T4·T5·T7 소비), `syncFromLedger(): {added}`·`registerInstruments(): {accepted, rejected}`(T4 정의, T7 소비) 일치.
- **주의**: Wizard.tsx는 v0.1에서 대폭 수정된 상태 — T6 실행자는 반드시 현재 파일을 전부 읽고 적용. `parseCsvCodes`의 최종 위치(T5 픽커로 이동 vs Wizard 잔류)는 T5 실행자가 결정하고 T6에 인계(리포트 명시).
