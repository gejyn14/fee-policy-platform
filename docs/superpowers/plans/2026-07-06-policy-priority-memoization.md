# 정책 우선순위 메모이즈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계좌 무관 정책 우선순위 인덱스를 스토어에 메모이즈해 룰/요율표 변경 시에만 재산정하도록 바꾼다(현재는 매 리졸브마다 재계산).

**Architecture:** `useStore.ts` 모듈 스코프에 lazy 메모 슬롯 `priorityIdx`를 두고, `resolveFee`·`policyPriority`가 `getPriorityIndex(s)`로 재사용한다. 무효화는 zustand `subscribe`로 `rules`/`schedules` 참조 변경을 감지해 `priorityIdx = null`로 처리한다 — 이 방식이 스펙의 무효화 매트릭스(룰/요율표 mutation만 무효화, nego·instrument 계열 제외)를 DRY하게 실현한다. 전용 테이블은 신설하지 않는다.

**Tech Stack:** TypeScript, zustand v5, vitest v4.

## Global Constraints

- `src/domain/policyRank.ts`의 `buildPolicyPriority`·`rankKey`·`PolicyPriorityIndex` 시그니처·로직은 변경 금지(순수 스토어 수명 관리 변경).
- `Date.now()`/`new Date()` 등 실시간 날짜 금지 — 날짜는 `TODAY` 상수만 사용(기존 코드 규약).
- 테스트 러너: `npm test` (= `vitest run`). 단일 파일: `npx vitest run <path>`.
- 기존 테스트를 전부 green으로 유지한다(회귀 금지).

---

## File Structure

- Modify: `src/store/useStore.ts` — 메모 슬롯 + `getPriorityIndex` 헬퍼 + `subscribe` 무효화 + 두 곳의 읽기 교체.
- Modify: `src/store/useStore.test.ts` — 메모이즈/무효화/비무효화 테스트 3종 추가.
- Modify: `docs/superpowers/specs/2026-07-05-v08-policy-priority-precompute-design.md` — 구현 반영 + 날짜 caveat + 프로덕션 매핑.
- Modify: `docs/table-design.md` — 4.7절 근처에 저장 정책 결정 명시.

---

### Task 1: 우선순위 인덱스 메모이즈 + 무효화

**Files:**
- Modify: `src/store/useStore.ts:23` (메모 슬롯), `:57` 이후(헬퍼), `:86`(resolveFee 읽기), `:208`(policyPriority 읽기), `:355` 이후(subscribe)
- Test: `src/store/useStore.test.ts` (기존 `describe('정책 우선순위 사전 산정')` 블록에 추가)

**Interfaces:**
- Consumes: `buildPolicyPriority(rules, schedules, today): PolicyPriorityIndex` (기존, `../domain/policyRank`), `PolicyPriorityIndex` 타입 (이미 import됨).
- Produces: `getPriorityIndex(s: Pick<State,'rules'|'schedules'>): PolicyPriorityIndex` (모듈 내부, 비export). `policyPriority()`는 메모된 동일 인스턴스를 반환(무효화 전까지 참조 안정).

- [ ] **Step 1: 실패하는 테스트 3종 추가**

`src/store/useStore.test.ts`의 `describe('정책 우선순위 사전 산정', ...)` 블록 안(기존 `it('순위는 rank 오름차순', ...)` 아래)에 추가:

```ts
  it('메모이즈: 연속 호출은 동일 인덱스 인스턴스 반환', () => {
    const s = useStore.getState();
    expect(s.policyPriority()).toBe(s.policyPriority());
  });

  it('무효화: 룰 승인 후 인덱스 재산정 + 승자 반영', () => {
    const s = useStore.getState();
    const a = s.policyPriority();
    const cme6a = s.products.find(p => p.exchange === 'CME' && p.code === '6A')!;
    const sched: FeeSchedule = { id: 'S-CHEAP', name: '초저가', components: [
      { name: '자사', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: 1 }] };
    const rule: FeeRule = { id: 'R-CHEAP', name: '초저가 이벤트', type: 'EVENT', status: '기안', applyMode: '타겟추출형',
      startDate: '2026-07-01', endDate: '2026-09-30',
      scope: { assetClass: '해외파생', exchanges: ['CME'], sessions: '*', currencies: '*', products: ['6A'], excludeProducts: [] },
      scheduleId: 'S-CHEAP', warnings: { dominance: true, reverseMargin: false }, createdBy: 't', log: [] };
    s.submitRule(rule, sched);
    useStore.getState().approveRule('R-CHEAP');
    const b = useStore.getState().policyPriority();
    expect(b).not.toBe(a);
    const w = b.topFor(deriveFeeKey(cme6a, '정규', 'HTS'));
    expect(w!.ruleId).toBe('R-CHEAP');   // rank 1 최저 → 최상위
  });

  it('비무효화: nego 승인은 인덱스 인스턴스 유지', () => {
    const usScope = { assetClass: '해외주식' as const, exchanges: '*' as const, sessions: '*' as const, channels: '*' as const, currencies: '*' as const, products: '*' as const, excludeProducts: [] };
    const s = useStore.getState();
    const a = s.policyPriority();
    const { requestId } = s.submitNegoRequest({ accountIds: ['110000001004'], scope: usScope, scheduleId: 'FS-NEGO-STOCK-US', bypass: {}, requestedBy: 'PB' });
    useStore.getState().approveNegoRequest(requestId);
    expect(useStore.getState().policyPriority()).toBe(a);
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/store/useStore.test.ts -t "정책 우선순위"`
Expected: 3개 신규 테스트 FAIL — "메모이즈"는 `policyPriority()`가 매번 새 객체라 `toBe` 실패, "비무효화"도 동일 이유로 실패, "무효화"는 우연히 통과할 수 있으나 나머지 2개가 red면 충분.

- [ ] **Step 3: 메모 슬롯 선언**

`src/store/useStore.ts:23` `const resolveCache = new ResolveCache();` 바로 아래에 추가:

```ts
let priorityIdx: PolicyPriorityIndex | null = null;
```

- [ ] **Step 4: `getPriorityIndex` 헬퍼 추가**

`State` 인터페이스 닫는 `}`(현재 `:57`) 바로 다음, `extendOneYear` 함수 위에 추가:

```ts
// 계좌 무관 우선순위 인덱스 — (rules, schedules)의 파생. 없으면 빌드, 있으면 재사용(룰/요율표 변경 시 무효화).
function getPriorityIndex(s: Pick<State, 'rules' | 'schedules'>): PolicyPriorityIndex {
  return priorityIdx ??= buildPolicyPriority(s.rules, s.schedules, TODAY);
}
```

- [ ] **Step 5: `resolveFee`의 읽기 교체**

`src/store/useStore.ts:86`:

```ts
    const idx = buildPolicyPriority(s.rules, s.schedules, TODAY);
```

를 다음으로 교체:

```ts
    const idx = getPriorityIndex(s);
```

- [ ] **Step 6: `policyPriority`의 읽기 교체**

`src/store/useStore.ts:208-211` 블록:

```ts
  policyPriority: (): PolicyPriorityIndex => {
    const s = useStore.getState();
    return buildPolicyPriority(s.rules, s.schedules, TODAY);
  },
```

를 다음으로 교체(주석은 유지):

```ts
  policyPriority: (): PolicyPriorityIndex => getPriorityIndex(useStore.getState()),
```

- [ ] **Step 7: `subscribe` 무효화 등록**

`create` 호출을 닫는 `}));`(현재 `:355`) 다음 줄, `useStore.getState().reset();`(현재 `:357`) 위에 추가:

```ts
// 룰/요율표가 바뀌면 우선순위 인덱스 무효화(다음 읽기에서 lazy 재빌드). nego·instrument 변경은 참조 유지 → 미영향.
useStore.subscribe((s, prev) => {
  if (s.rules !== prev.rules || s.schedules !== prev.schedules) priorityIdx = null;
});
```

- [ ] **Step 8: 신규 테스트 통과 확인**

Run: `npx vitest run src/store/useStore.test.ts -t "정책 우선순위"`
Expected: 정책 우선순위 블록 전체 PASS(기존 2 + 신규 3).

- [ ] **Step 9: 전체 스위트 + 타입/린트 green 확인**

Run: `npm test && npx tsc -b && npm run lint`
Expected: 전체 테스트 PASS, 타입 에러 0, 린트 0. (특히 기존 `approveRule → resolveFee 반영`, 배치 잡 테스트가 무효화 덕에 그대로 green)

- [ ] **Step 10: 커밋**

```bash
git add src/store/useStore.ts src/store/useStore.test.ts
git commit -m "feat: 정책 우선순위 인덱스 메모이즈 + 룰/요율표 변경 시 무효화

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 문서 동기화(v08 스펙 + 테이블 설계서)

**Files:**
- Modify: `docs/superpowers/specs/2026-07-05-v08-policy-priority-precompute-design.md`
- Modify: `docs/table-design.md`

**Interfaces:** 없음(문서 전용). Task 1의 구현 결정을 문서에 반영.

- [ ] **Step 1: v08 스펙에 구현 반영 절 추가**

`docs/superpowers/specs/2026-07-05-v08-policy-priority-precompute-design.md` 파일 맨 끝에 아래 절을 append:

```markdown

## 구현 반영(2026-07-06, v0.9)

본 스펙의 "룰 변경 때만 미리 산정"은 프로토타입에서 **스토어 메모이즈**로 구현된다(`useStore.ts`).
- `getPriorityIndex(s)`가 `buildPolicyPriority`를 lazy 빌드·재사용.
- 무효화: `rules` 또는 `schedules` 참조가 바뀔 때만(`subscribe` 감지) → 다음 읽기에서 재빌드. nego·instrument 변경은 미영향.
- 상세: `docs/superpowers/specs/2026-07-06-policy-priority-memoization-design.md`.

### 날짜 롤오버 caveat

`inRanking`이 `today`(기간 게이트)에 의존하므로, 실서비스에선 **룰 변경 + 날짜 롤오버(일 1회)** 둘 다 무효화 트리거가 되어야 한다. 프로토타입은 `TODAY`가 상수이고, 날짜 경과는 `batchActivateExpireRules`가 룰 status를 플립하는 것으로 대변되므로(→ rules 변경 → 자동 무효화) 별도 날짜 타이머가 불필요하다.

### 프로덕션 매핑

우선순위 인덱스는 프로덕션에서 "오래 사는 전역 캐시"가 아니라 **rebind 잡 스코프의 transient 산출물**이다. 체결(hot path)은 인덱스를 건드리지 않고 원장이 `FEE_BINDING`만 읽는다. 계좌 무관 순위는 잡 실행 시 계산되어 `FEE_BINDING`(계좌축 결과) UPSERT에 쓰이고 잡 종료 시 소멸한다. 즉 "저장된 우선순위"의 영속 실체는 `FEE_BINDING`이다.
```

- [ ] **Step 2: 테이블 설계서에 저장 정책 결정 명시**

`docs/table-design.md`의 `### 4.7 최저가 선택 알고리즘 반영 (참고)` 절 본문 끝(다음 `##`/`###` 헤딩 직전)에 아래 문단을 추가:

```markdown

**계좌 무관 우선순위의 저장 정책(2026-07-06 확정):** 정책 순위(계좌 무관 랭킹)는 `FEE_RULE`/`FEE_SCHEDULE`의 순수 파생값이므로 **전용 영속 테이블(예: `FEE_POLICY_PRIORITY`)을 신설하지 않는다.** 이유는 (1) 이중 진실원 회피, (2) 영속이 값어치 있는 축은 O(계좌×feeKey)인 `FEE_BINDING`이고 정책 순위는 O(룰 수)로 작아 잡/앱 메모리 재빌드가 더 쌈, (3) "원장은 룰을 모른다" 원칙. 따라서 순위는 플랫폼 내부(잡 스코프 transient) 계산으로 두고, **영속은 `FEE_BINDING`(계좌축 결과)이 담당한다.** 예외적으로 다중 인스턴스 수평 확장(로컬 캐시 정합성) 또는 시점별 순위 감사/재현이 요구되면 그때 스냅샷 테이블을 도입한다.
```

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/specs/2026-07-05-v08-policy-priority-precompute-design.md docs/table-design.md
git commit -m "docs: 우선순위 메모이즈 구현·날짜 caveat·저장 정책 반영(v08 스펙·테이블 설계서)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- 저장 메커니즘(메모 슬롯 + getPriorityIndex) → Task 1 Step 3~6 ✓
- 무효화 매트릭스(rules/schedules만, nego·instrument 제외) → Task 1 Step 7(subscribe가 참조 변경으로 실현) + 비무효화 테스트 Step 1 ✓
- 테스트 4종 → 메모이즈/무효화/비무효화 신규 3종(Step 1) + 등가성은 기존 `계좌 무관 winnerFor…resolve 승자와 일치` 테스트가 커버 ✓
- 테이블 미신설 근거 → Task 2 Step 2 ✓
- 프로덕션 매핑·날짜 caveat → Task 2 Step 1 ✓

**Placeholder scan:** 모든 코드/명령/문서 문단이 실제 내용으로 채워짐. TODO/TBD 없음 ✓

**Type consistency:** `getPriorityIndex(s: Pick<State,'rules'|'schedules'>)` 반환 `PolicyPriorityIndex`를 `resolveFee`/`policyPriority`가 그대로 소비. 테스트의 `FeeRule`/`FeeSchedule`는 파일 상단에서 이미 import됨(`useStore.test.ts:4`). `topFor`/`winnerFor`/`policies`/`rank`는 기존 `PolicyPriorityIndex` 인터페이스와 일치 ✓
