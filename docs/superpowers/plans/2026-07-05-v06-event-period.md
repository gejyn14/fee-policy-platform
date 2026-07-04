# v0.6 이벤트 기간 2축 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이벤트 "신청/유입 가능기간"과 "적용기간(혜택 기간)"을 분리하고, 적용기간을 룰마다 캘린더 고정/유입시점 상대(가입일+N개월)로 선택 가능하게 한다.

**Architecture:** 룰에 `benefit`(적용기간 유형) 추가. 멤버십은 기존 `isTarget`이, 시간(혜택 유효)은 신규 `isBenefitActive`가 담당. `resolve()`에 가입 이력을 연결하고 오버레이 시간 게이팅을 `buildScopeIndex`(상태만)에서 resolve로 이동해, 상대형 혜택이 신청 마감 이후에도 가입일+N까지 유지되게 한다.

**Tech Stack:** 기존 동일(Vite+React18+TS+zustand+Vitest). 신규 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-07-05-v06-event-period-design.md` **먼저 읽을 것**.

## Global Constraints

- UI 문구 전부 한국어. `src/domain/`은 React-free. 신규 의존성 금지.
- 결정성: `Math.random`/`Date.now`/인자 없는 `new Date()` 금지. 기준일 `TODAY='2026-07-04'`. 월 덧셈은 순수 헬퍼(`new Date(y, m, 0)`는 월말 클램프에만 허용).
- 하위호환: `benefit` 미지정 = 캘린더 = 기존 동작 불변. 기존 룰·테스트 유지.
- 계좌번호는 12자리 숫자 문자열. 주식은 품목 차원 없음(feeKey=거래소·세션·채널).
- 각 태스크 완료 시 `npx vitest run` + `npm run build` green. 커밋 trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.

## 파일 구조

```
src/domain/dateutil.ts       # addMonths — 신규 (T1)
src/domain/types.ts          # BenefitPeriod, FeeRule.benefit — 수정 (T2)
src/domain/binding.ts        # isBenefitActive — 신규 함수 (T2)
src/domain/resolve.ts        # enrollments 인자·isBenefitActive 게이팅·buildScopeIndex 상태만 — 수정 (T3)
src/store/useStore.ts        # resolveFee가 enrollments 전달 — 수정 (T3)
src/store/mock.ts            # 상대형 시연 룰 + 가입 이력 — 수정 (T4)
src/screens/Wizard.tsx       # 적용기간 유형 입력 — 수정 (T5)
src/screens/FeeTrace.tsx     # 혜택 근거(가입일·남은기간) 표시 — 수정 (T6)
src/screens/AccountView.tsx  # 혜택 근거 표시 — 수정 (T6)
```

---

### Task 1: addMonths 순수 날짜 헬퍼 (TDD)

**Files:**
- Create: `src/domain/dateutil.ts`
- Test: `src/domain/dateutil.test.ts`

**Interfaces (Produces):**
- `addMonths(dateStr: string, n: number): string` — `'YYYY-MM-DD'`에 n개월 더하고 월말 클램프.

- [ ] **Step 1: 실패 테스트 작성** — `src/domain/dateutil.test.ts`

```ts
import { it, expect, describe } from 'vitest';
import { addMonths } from './dateutil';

describe('addMonths', () => {
  it('기본 덧셈', () => { expect(addMonths('2026-07-04', 2)).toBe('2026-09-04'); });
  it('월말 클램프', () => { expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'); });
  it('연도 넘김 + 클램프', () => { expect(addMonths('2026-11-30', 3)).toBe('2027-02-28'); });
  it('0개월은 동일', () => { expect(addMonths('2026-07-04', 0)).toBe('2026-07-04'); });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/domain/dateutil.test.ts` → FAIL (`addMonths` 미정의)

- [ ] **Step 3: 구현** — `src/domain/dateutil.ts`

```ts
// 'YYYY-MM-DD' + n개월. 결정적(Date.now/argless new Date 미사용). 월말 클램프.
export function addMonths(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;      // 0-based month index 누계
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;          // 1..12
  const lastDay = new Date(ny, nm, 0).getDate();   // 인자 있는 new Date — 월말만
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/domain/dateutil.test.ts` → PASS

- [ ] **Step 5: 커밋**

```bash
git add src/domain/dateutil.ts src/domain/dateutil.test.ts
git commit -m "feat: addMonths 결정적 월 덧셈 헬퍼(월말 클램프)"
```

---

### Task 2: BenefitPeriod 타입 + isBenefitActive (TDD)

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/binding.ts`
- Test: `src/domain/binding.test.ts`

**Interfaces:**
- Consumes: `addMonths` (T1).
- Produces:
  - `type BenefitPeriod = { kind: '캘린더' } | { kind: '상대'; months: number }`
  - `FeeRule.benefit?: BenefitPeriod`
  - `isBenefitActive(rule: FeeRule, acct: Account, enrollments: Enrollment[], today: string): boolean`

- [ ] **Step 1: 타입 추가** — `src/domain/types.ts`의 `FeeRule` 정의 위에 추가:

```ts
export type BenefitPeriod =
  | { kind: '캘린더' }                    // 룰 캘린더(startDate~endDate)까지
  | { kind: '상대'; months: number };     // 가입일 + months 개월
```

그리고 `FeeRule` 인터페이스에 필드 추가(다른 필드 옆, 예 `condition?` 근처):

```ts
  benefit?: BenefitPeriod;                // 미지정 = 캘린더(하위호환)
```

- [ ] **Step 2: 실패 테스트 작성** — `src/domain/binding.test.ts` 하단에 추가:

```ts
import { isBenefitActive } from './binding';
import type { Enrollment } from './types';

describe('isBenefitActive', () => {
  const acct = { id: '110000001001', name: '김', grade: 'GOLD', dormantReturned: false, metric6mAsset: 0, metric6mVolume: 0 };
  const mk = (over: Partial<FeeRule>): FeeRule => ({
    id: 'R', name: 'r', type: 'EVENT', status: '활성', applyMode: '가입형',
    startDate: '2026-04-01', endDate: '2026-06-30', scope: {
      assetClass: '국내주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [],
    }, scheduleId: 'S', warnings: { dominance: true, reverseMargin: false }, createdBy: 't', log: [], ...over });

  it('캘린더: 오늘이 창 안이면 true', () => {
    expect(isBenefitActive(mk({ endDate: '2026-12-31' }), acct, [], '2026-07-04')).toBe(true);
  });
  it('캘린더: 오늘이 창 밖이면 false', () => {
    expect(isBenefitActive(mk({ endDate: '2026-06-30' }), acct, [], '2026-07-04')).toBe(false);
  });
  it('상대: 가입일+N 안이면 true', () => {
    const enr: Enrollment[] = [{ accountId: acct.id, ruleId: 'R', enrolledAt: '2026-06-20', channel: 'MTS' }];
    expect(isBenefitActive(mk({ benefit: { kind: '상대', months: 2 } }), acct, enr, '2026-07-04')).toBe(true);
  });
  it('상대: 신청 마감(end) 지나도 가입일+N 안이면 true', () => {
    // end=2026-06-30 < today, 그래도 유효
    const enr: Enrollment[] = [{ accountId: acct.id, ruleId: 'R', enrolledAt: '2026-06-20', channel: 'MTS' }];
    expect(isBenefitActive(mk({ benefit: { kind: '상대', months: 2 }, endDate: '2026-06-30' }), acct, enr, '2026-07-04')).toBe(true);
  });
  it('상대: 가입일+N 지나면 false', () => {
    const enr: Enrollment[] = [{ accountId: acct.id, ruleId: 'R', enrolledAt: '2026-04-10', channel: 'MTS' }];
    expect(isBenefitActive(mk({ benefit: { kind: '상대', months: 2 } }), acct, enr, '2026-07-04')).toBe(false);
  });
  it('상대: 가입 이력 없으면 false', () => {
    expect(isBenefitActive(mk({ benefit: { kind: '상대', months: 2 } }), acct, [], '2026-07-04')).toBe(false);
  });
});
```

- [ ] **Step 3: 실패 확인** — `npx vitest run src/domain/binding.test.ts` → FAIL (`isBenefitActive` 미정의)

- [ ] **Step 4: 구현** — `src/domain/binding.ts` 상단 import에 추가하고 함수 추가:

```ts
import { addMonths } from './dateutil';
// ...기존 import 유지...

// 혜택 유효(시간) 판정 — 멤버십은 isTarget이 담당, 여기선 "언제"만 본다.
export function isBenefitActive(rule: FeeRule, acct: Account, enrollments: Enrollment[], today: string): boolean {
  const benefit = rule.benefit ?? { kind: '캘린더' as const };
  if (benefit.kind === '상대') {
    const e = enrollments.find((x) => x.accountId === acct.id && x.ruleId === rule.id);
    if (!e) return false;
    return e.enrolledAt <= today && today <= addMonths(e.enrolledAt, benefit.months);
  }
  return rule.startDate <= today && today <= rule.endDate;
}
```

- [ ] **Step 5: 통과 + 빌드** — `npx vitest run src/domain/binding.test.ts` → PASS, `npm run build` → green

- [ ] **Step 6: 커밋**

```bash
git add src/domain/types.ts src/domain/binding.ts src/domain/binding.test.ts
git commit -m "feat: BenefitPeriod 타입 + isBenefitActive(적용기간 시간 판정)"
```

---

### Task 3: resolve가 가입 이력·적용기간을 반영 (TDD)

**Files:**
- Modify: `src/domain/resolve.ts`
- Modify: `src/store/useStore.ts`
- Test: `src/domain/resolve.test.ts`

**Interfaces:**
- Consumes: `isBenefitActive`, `isTarget` (binding).
- Produces: `resolve(acct, key, rules, schedules, nego, index, today, enrollments): ResolveResult | null` — **enrollments 인자 추가(마지막)**. `buildScopeIndex`는 이제 `status === '활성'`·스코프 매칭만(기간 게이팅은 resolve로 이동).

- [ ] **Step 1: resolve.ts 수정**

`import { isTarget } from './binding';`를 `import { isTarget, isBenefitActive } from './binding';`로 변경.

`buildScopeIndex`의 오버레이 필터에서 날짜 게이트 제거:

```ts
export function buildScopeIndex(rules: FeeRule[], today: string): ScopeIndex {
  // 상태만으로 인덱싱 — 기간(혜택 유효)은 resolve의 isBenefitActive가 계좌별로 판정
  // (상대형 혜택이 신청 마감 이후에도 후보로 남게 하기 위함).
  const overlays = rules.filter((r) => r.type !== 'BASE' && r.status === '활성');
  return { candidatesFor: (k) => overlays.filter((r) => scopeMatchesKey(r.scope, k)) };
}
```

`resolve` 시그니처에 `enrollments` 추가하고 이벤트 후보 게이팅 변경:

```ts
export function resolve(
  acct: Account,
  key: FeeKey,
  rules: FeeRule[],
  schedules: FeeSchedule[],
  nego: NegoException[],
  index: ScopeIndex,
  today: string,
  enrollments: Enrollment[],
): ResolveResult | null {
```

(상단 import에 `Enrollment` 타입 추가: `import type { Account, Enrollment, Execution, FeeKey, FeeRule, FeeSchedule, Product, ScopeSelector } from './types';`)

그리고 이벤트 후보 수집 루프(현재 `for (const r of index.candidatesFor(key)) if (isTarget(r, acct, []))`)를:

```ts
  for (const r of index.candidatesFor(key))
    if (isTarget(r, acct, enrollments) && isBenefitActive(r, acct, enrollments, today))
      cands.push({ rule: r, schedule: schedOf(r.scheduleId), source: 'event' });
```

- [ ] **Step 2: 스토어 호출부 수정** — `src/store/useStore.ts`의 `resolveFee` 안, `resolve(...)` 호출에 `s.enrollments` 추가:

```ts
    const r = resolve(acct, key, s.rules, s.schedules, s.nego, idx, TODAY, s.enrollments);
```

- [ ] **Step 3: 기존 resolve 테스트 호출 갱신** — `src/domain/resolve.test.ts`의 `resolve(...)` 호출 4곳(BASE만/이벤트/nego/다른계좌 nego) 끝에 `, []`(빈 가입이력) 추가. 예:

```ts
    const r = resolve(acct, key(), [base], schedules, [], idx([base]), '2026-07-04', []);
```
(나머지 3곳도 동일하게 마지막 인자 `, []` 추가.)

- [ ] **Step 4: buildScopeIndex 테스트를 상태 기준으로 갱신** — `src/domain/resolve.test.ts`의 `expired`(46행)와 그 테스트(53–60행)를 아래로 교체:

```ts
  const closed = rule({ id: 'R-CLOSED', type: 'EVENT', status: '종료', scheduleId: 'S-EVT' });

  it('scope_index는 활성 상태·스코프 매칭 룰(기간 게이팅은 resolve로 이동)', () => {
    const idx = buildScopeIndex([base, evt, closed], '2026-07-04');
    const c = idx.candidatesFor(key({ channel: 'MTS' }));
    expect(c.map(r => r.id)).toContain('R-EVT');
    expect(c.map(r => r.id)).not.toContain('R-CLOSED');   // 종료 상태 제외
    expect(c.map(r => r.id)).not.toContain('R-BASE');     // BASE는 scope_index 아님
    expect(idx.candidatesFor(key({ channel: 'HTS' })).map(r => r.id)).not.toContain('R-EVT');
  });
```

- [ ] **Step 5: 적용기간 resolve 테스트 추가** — `src/domain/resolve.test.ts`의 `describe('resolve', ...)` 블록 끝(90행 `});` 다음)에 추가. 상단 import에 `Enrollment` 추가(`import type { Account, Enrollment, FeeKey, FeeRule, FeeSchedule, ScopeSelector } from './types';`):

```ts
describe('resolve — 적용기간(benefit)', () => {
  const acct: Account = { id: '110000001002', name: '이', grade: 'SILVER', dormantReturned: false, metric6mAsset: 600_000_000, metric6mVolume: 0 };
  const schedules = [sched('S-BASE', 100), sched('S-EVT', 50)];
  const base = rule({ id: 'R-BASE', scheduleId: 'S-BASE' });
  const relEvt = rule({ id: 'R-REL', type: 'EVENT', applyMode: '가입형', scheduleId: 'S-EVT',
    scope: scope({ channels: ['MTS'] }), benefit: { kind: '상대', months: 2 }, startDate: '2026-04-01', endDate: '2026-06-30' });
  const calX = rule({ id: 'R-CALX', type: 'EVENT', applyMode: '일괄적용형', scheduleId: 'S-EVT',
    scope: scope({ channels: ['MTS'] }), endDate: '2020-12-31' });
  const enr = (enrolledAt: string): Enrollment[] => [{ accountId: acct.id, ruleId: 'R-REL', enrolledAt, channel: 'MTS' }];

  it('상대형: 가입일+N 안이면 event 승자(신청 마감 지나도)', () => {
    const idx = buildScopeIndex([base, relEvt], '2026-07-04');
    const r = resolve(acct, key({ channel: 'MTS' }), [base, relEvt], schedules, [], idx, '2026-07-04', enr('2026-06-20'));
    expect(r!.source).toBe('event'); expect(r!.sourceRuleId).toBe('R-REL');
  });
  it('상대형: 가입일+N 지나면 base', () => {
    const idx = buildScopeIndex([base, relEvt], '2026-07-04');
    const r = resolve(acct, key({ channel: 'MTS' }), [base, relEvt], schedules, [], idx, '2026-07-04', enr('2026-04-10'));
    expect(r!.source).toBe('base');
  });
  it('상대형: 가입 이력 없으면 base', () => {
    const idx = buildScopeIndex([base, relEvt], '2026-07-04');
    const r = resolve(acct, key({ channel: 'MTS' }), [base, relEvt], schedules, [], idx, '2026-07-04', []);
    expect(r!.source).toBe('base');
  });
  it('캘린더형 만료 이벤트는 제외(base)', () => {
    const idx = buildScopeIndex([base, calX], '2026-07-04');
    const r = resolve(acct, key({ channel: 'MTS' }), [base, calX], schedules, [], idx, '2026-07-04', []);
    expect(r!.source).toBe('base');
  });
});
```

- [ ] **Step 6: 실행** — `npx vitest run` → 전량 PASS, `npm run build` → green

- [ ] **Step 7: 커밋**

```bash
git add src/domain/resolve.ts src/store/useStore.ts src/domain/resolve.test.ts
git commit -m "feat: resolve가 가입 이력·적용기간(benefit) 반영, 시간 게이팅 resolve로 이동"
```

---

### Task 4: 상대형 시연 mock + 스토어 캐스케이드 테스트

**Files:**
- Modify: `src/store/mock.ts`
- Test: `src/store/useStore.test.ts`

**Interfaces:**
- Consumes: `resolveFee` (스토어), `deriveFeeKey`.
- Produces: mock 룰 `RULE-EVENT-STOCK-SIGNUP2M`(상대 2개월) + 가입 이력 2건.

- [ ] **Step 1: 요율표 시드** — `src/store/mock.ts`의 `mockSchedules` 배열에 무료(자사 0) 요율표 추가:

```ts
  { id: 'FS-EVT-SIGNUP2M', name: '신규 가입 2개월 무료 요율', components: [
    { name: '위탁수수료', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 0 },
  ] },
```

- [ ] **Step 2: 상대형 룰 시드** — `mockRules` 배열에 추가:

```ts
  {
    id: 'RULE-EVENT-STOCK-SIGNUP2M', name: '신규 온라인 가입 2개월 무료',
    type: 'EVENT', status: '활성', applyMode: '가입형',
    startDate: '2026-04-01', endDate: '2026-06-30',        // 신청 가능기간
    benefit: { kind: '상대', months: 2 },
    scope: { assetClass: '국내주식', exchanges: '*', sessions: '*', channels: ['HTS', 'MTS'], currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-EVT-SIGNUP2M',
    warnings: { dominance: true, reverseMargin: false }, createdBy: '마케팅팀', log: [],
  },
```

- [ ] **Step 3: 가입 이력 시드** — `mockEnrollments` 배열에 2건 추가(하나 유효·하나 만료, 둘 다 신청 가능기간 04-01~06-30 내):

```ts
  { accountId: '110000001001', ruleId: 'RULE-EVENT-STOCK-SIGNUP2M', enrolledAt: '2026-06-20', channel: 'MTS' }, // +2m=08-20 유효
  { accountId: '110000001004', ruleId: 'RULE-EVENT-STOCK-SIGNUP2M', enrolledAt: '2026-04-10', channel: 'HTS' }, // +2m=06-10 만료
```

- [ ] **Step 4: 실패 테스트 작성** — `src/store/useStore.test.ts`의 `describe('resolveFee + 캐시', ...)` 안에 추가(상단 import에 이미 `deriveFeeKey` 있음):

```ts
  it('상대형 이벤트: 가입일+2개월 안의 계좌만 무료요율로 해석', () => {
    const s = useStore.getState();
    const krStock = s.products.find(p => p.assetClass === '국내주식' && p.exchange === 'KRX')!;
    const k = deriveFeeKey(krStock, '정규', 'MTS');
    const valid = s.resolveFee('110000001001', k)!;   // 06-20 가입 → 유효
    const expired = s.resolveFee('110000001004', k)!; // 04-10 가입 → 만료
    expect(valid.sourceRuleId).toBe('RULE-EVENT-STOCK-SIGNUP2M');
    expect(expired.sourceRuleId).not.toBe('RULE-EVENT-STOCK-SIGNUP2M');
  });
```

- [ ] **Step 5: 실행** — `npx vitest run` → 전량 PASS(신규 포함), `npm run build` → green
  - 회귀 주의: `RULE-EVENT-STOCK-SIGNUP2M`은 국내주식 HTS/MTS scope라 기존 국내주식 결정 흐름 테스트에 영향 가능. 실패 시 해당 테스트의 기대 scheduleId/source가 무료요율(가입 유효 계좌)로 바뀌는지 확인 — 기존 테스트는 대개 CME/해외주식이라 무영향 예상. 국내주식·MTS 대상 기존 단언이 있으면 무료요율 반영으로 갱신.

- [ ] **Step 6: 커밋**

```bash
git add src/store/mock.ts src/store/useStore.test.ts
git commit -m "feat: 상대형 이벤트 시연 mock(가입 2개월 무료) + 캐스케이드 테스트"
```

---

### Task 5: 이벤트 등록 위저드 — 적용기간 유형 입력

**Files:**
- Modify: `src/screens/Wizard.tsx`

**Interfaces:**
- Consumes: `BenefitPeriod` (T2).
- Produces: 위저드가 상신하는 룰에 `benefit` 채움.

- [ ] **Step 1: 폼 상태 확장** — `WizardForm` 인터페이스(63행 부근)에 필드 추가:

```ts
  benefitKind: '캘린더' | '상대';
  benefitMonths: number;
```

초기값(89–90행 `startDate: TODAY, endDate: '2026-12-31',` 근처)에 추가:

```ts
    benefitKind: '캘린더', benefitMonths: 2,
```

- [ ] **Step 2: benefit 조립 헬퍼** — `buildScope` 근처에 추가하고, 미리보기/상신 룰에 반영:

```ts
  const buildBenefit = (): BenefitPeriod =>
    (form.applyMode !== '일괄적용형' && form.benefitKind === '상대')
      ? { kind: '상대', months: form.benefitMonths }
      : { kind: '캘린더' };
```

(상단 타입 import에 `BenefitPeriod` 추가.)

미리보기 룰(`previewRule`, 220–222행 부근)과 상신 룰(351–352행 부근) 두 곳의 객체에 `benefit: buildBenefit(),` 추가.

- [ ] **Step 3: 1단계 UI** — `renderStep1`의 날짜 필드(시작일/종료일) 아래에 적용기간 UI 추가. 일괄적용형이 아닐 때만 노출:

```tsx
        {form.applyMode !== '일괄적용형' && (
          <div className="field">
            <label>적용기간 유형</label>
            <select value={form.benefitKind} onChange={(e) => update({ benefitKind: e.target.value as '캘린더' | '상대' })}>
              <option value="캘린더">캘린더 고정(신청 가능기간 종료까지)</option>
              <option value="상대">유입시점 상대(가입일 +N개월)</option>
            </select>
            {form.benefitKind === '상대' && (
              <input type="number" min={1} value={form.benefitMonths}
                onChange={(e) => update({ benefitMonths: Math.max(1, Number(e.target.value)) })}
                style={{ marginTop: 6 }} placeholder="개월" />
            )}
          </div>
        )}
```

날짜 라벨 명확화(선택): 시작일/종료일 `<label>`을 일괄적용형이 아닐 때 "신청 가능 시작/종료"로 바꿔도 됨(범위 밖이면 생략 가능).

- [ ] **Step 4: 6단계 요약 반영(선택)** — `renderStep6`의 기간 행 아래에 적용기간 표기 추가:

```tsx
            <tr><td>적용기간</td><td>{form.applyMode === '일괄적용형' || form.benefitKind === '캘린더' ? '캘린더(신청/룰 기간)' : `가입일 +${form.benefitMonths}개월`}</td></tr>
```

- [ ] **Step 5: 실행** — `npx vitest run` → green, `npm run build` → green. 개발서버에서 신청형 선택 시 적용기간 유형이 뜨고, 일괄적용형이면 숨는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/screens/Wizard.tsx
git commit -m "feat: 이벤트 등록에 적용기간 유형(캘린더/유입 상대) 입력"
```

---

### Task 6: 결정 흐름·계좌 조회에 혜택 근거 표시

**Files:**
- Modify: `src/screens/FeeTrace.tsx`
- Modify: `src/screens/AccountView.tsx`

**Interfaces:**
- Consumes: `resolveFee` 결과의 승자 후보 `rule`, 스토어 `enrollments`, `addMonths`(T1).
- Produces: 상대형 이벤트가 승자일 때 "가입일 · 만료예정(가입일+N) · 남은 개월" 표시.

- [ ] **Step 1: FeeTrace 표시** — `FeeTrace.tsx` 상단 import에 `import { addMonths } from '../domain/dateutil';` 추가, 스토어 구조분해에 `enrollments` 추가(`const { accounts, products, schedules, resolveFee, cacheStat, enrollments } = useStore();`). ④ 해석 결과 카드(`{result && (...④ 해석 결과...)}`) 안, `<table>` 다음에 추가:

```tsx
                {(() => {
                  const win = result.candidates.find((c) => c.isWinner);
                  const b = win?.rule?.benefit;
                  if (!b || b.kind !== '상대') return null;
                  const e = enrollments.find((x) => x.accountId === accountId && x.ruleId === win!.rule!.id);
                  if (!e) return null;
                  const until = addMonths(e.enrolledAt, b.months);
                  return <p className="trace-narration">적용기간: 가입일 {e.enrolledAt} + {b.months}개월 → {until}까지</p>;
                })()}
```

- [ ] **Step 2: AccountView 표시** — `AccountView.tsx`에 동일 패턴 적용. 상단 import에 `addMonths` 추가, 스토어 구조분해에 `enrollments` 이미 있음(협의 예외에 사용). 해석 결과(`{result && (...)}`)의 SOURCE 표 아래 `check-grid` 다음에 추가:

```tsx
                {(() => {
                  const win = result.candidates.find((c) => c.isWinner);
                  const b = win?.rule?.benefit;
                  if (!b || b.kind !== '상대') return null;
                  const e = enrollments.find((x) => x.accountId === accountId && x.ruleId === win!.rule!.id);
                  if (!e) return null;
                  return <p className="trace-narration">적용기간: 가입일 {e.enrolledAt} + {b.months}개월 → {addMonths(e.enrolledAt, b.months)}까지</p>;
                })()}
```

- [ ] **Step 3: 실행** — `npx vitest run` → green, `npm run build` → green. 개발서버 결정 흐름에서 계좌 `110000001001` · 국내주식 · MTS 해석 시 승자가 무료요율이고 "적용기간: 가입일 2026-06-20 +2개월 → 2026-08-20까지"가 뜨는지, `110000001004`는 만료라 무료요율이 아닌지 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/screens/FeeTrace.tsx src/screens/AccountView.tsx
git commit -m "feat: 결정 흐름·계좌 조회에 상대형 적용기간(가입일+N) 근거 표시"
```

---

## Self-Review 결과

- **스펙 커버리지:** 2축 개념→전체 · benefit 데이터모델→T2 · addMonths 결정성→T1 · isBenefitActive(멤버십/시간 분리)→T2 · resolve 통합·buildScopeIndex 상태만·enrollments 연결→T3 · 상대형 mock/캐스케이드→T4 · 위저드 적용기간 입력→T5 · 화면 혜택 근거→T6. 범위 밖(시간경과 만료 무효화·일 단위)은 문서에 명시, 태스크 없음(의도).
- **타입 일관성:** `BenefitPeriod`/`FeeRule.benefit`(T2) = `isBenefitActive`(T2)·`resolve` 게이팅(T3)·위저드 `buildBenefit`(T5)·화면(T6). `resolve(..., enrollments)` 시그니처(T3) = 스토어 호출(T3)·기존 테스트 갱신(T3).
- **회귀:** benefit 미지정=캘린더로 기존 룰/테스트 불변. buildScopeIndex 의미 변경으로 기존 `expired` 테스트를 `closed`(상태) 기준으로 교체(T3 Step4). 국내주식 MTS 신규 mock 룰이 기존 국내주식 단언에 영향 가능 — T4 Step5에서 확인·갱신 지시.
- **결정성:** addMonths 순수(argless new Date/Date.now 미사용), TODAY 고정.
