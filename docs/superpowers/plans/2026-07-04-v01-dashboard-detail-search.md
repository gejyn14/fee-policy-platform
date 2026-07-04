# v0.1 대시보드 상세·검색 + UX 수정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 룰 클릭 상세(공용 RuleDetail)·검색/필터, UX High 3건(품목 0개 차단·위저드 draft 보존·지배관계 실패 사유 구체화), Medium 4건(단위 suffix·CSV 자동 반영·유형 한글 병기·감면액 카드).

**Architecture:** v0(main) 위 증분. 도메인에 explain 함수 1개 추가(TDD), 스토어에 sim.matchedProducts + wizardDraft 슬라이스(TDD), 화면은 RuleDetail 추출 후 Dashboard/Approvals가 공유. 스펙: `docs/superpowers/specs/2026-07-04-v01-dashboard-detail-search-design.md` (반드시 먼저 읽을 것).

**Tech Stack:** 기존과 동일 (Vite+React+TS, zustand, Vitest). 신규 의존성 없음.

## Global Constraints

- UI 문구 전부 한국어, 스펙 용어(활성/승인대기/판정불가 등) 그대로
- src/domain/은 React 의존 금지. mock 전용, TODAY='2026-07-04'
- 기존 30개 테스트 전부 유지 통과. `npm run build` clean 유지
- 기존 styles.css 클래스 변경 금지(추가만)
- 커밋 메시지 끝: `Co-Authored-By: Claude <noreply@anthropic.com>` (실행 세션 모델 표기 규칙 따름)
- 각 태스크 완료 시 `npx vitest run` + `npm run build` 확인 후 커밋

## 파일 구조 (신규/수정)

```
src/domain/dominance.ts        # +explainDominanceFailure (Task 1)
src/domain/types.ts            # sim에 matchedProducts (Task 2)
src/store/useStore.ts          # submitRule 기록 + wizardDraft 슬라이스 (Task 2, 3)
src/screens/labels.ts          # 신규: ruleTypeLabel (Task 4)
src/screens/RuleDetail.tsx     # 신규: 공용 상세 (Task 4)
src/screens/Approvals.tsx      # RuleDetail 재사용 (Task 4)
src/screens/Dashboard.tsx      # 행 확장 + 검색/필터 + 카드 (Task 5)
src/screens/Wizard.tsx         # draft 스토어 전환 + 검증/사유/CSV/단위 (Task 3, 6)
```

---

### Task 1: explainDominanceFailure (TDD)

**Files:**
- Modify: `src/domain/dominance.ts`
- Test: `src/domain/dominance.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: 기존 `probePrices`, `calcFee`
- Produces: `export interface DominanceFailure { price: number; candidateFee: number; incumbentFee: number }`, `export function explainDominanceFailure(candidate: FeeSchedule, incumbent: FeeSchedule, sampleExec: (price: number) => Execution): DominanceFailure | null`

- [ ] **Step 1: 실패하는 테스트 추가** — `src/domain/dominance.test.ts`에 append (기존 헬퍼 `sched`, `sample` 재사용)

```ts
import { explainDominanceFailure } from './dominance';

it('교차 구간에서 최대 역전 지점을 반환', () => {
  const base = sched([{ from: 0, to: 3, flat: 10 }, { from: 3, to: null, flat: 50 }]);
  const cross = sched([{ from: 0, to: 3, flat: 5 }, { from: 3, to: null, flat: 80 }]);
  const f = explainDominanceFailure(cross, base, sample)!;
  expect(f).not.toBeNull();
  expect(f.candidateFee).toBeGreaterThan(f.incumbentFee);
  expect(f.price).toBeGreaterThanOrEqual(3); // 역전은 상위 구간에서만 발생
});

it('전 구간 지배 성립이면 null', () => {
  const base = sched([{ from: 0, to: 3, flat: 10 }, { from: 3, to: null, flat: 50 }]);
  const event = sched([{ from: 0, to: 3, flat: 5 }, { from: 3, to: null, flat: 30 }]);
  expect(explainDominanceFailure(event, base, sample)).toBeNull();
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/domain/dominance.test.ts` → FAIL (export 없음)

- [ ] **Step 3: 구현** — `src/domain/dominance.ts`에 append

```ts
export interface DominanceFailure { price: number; candidateFee: number; incumbentFee: number }

/** candidate가 incumbent보다 비싼 지점 중 차액 최대 지점. 지배 성립이면 null */
export function explainDominanceFailure(
  candidate: FeeSchedule, incumbent: FeeSchedule,
  sampleExec: (price: number) => Execution,
): DominanceFailure | null {
  let worst: DominanceFailure | null = null;
  for (const price of probePrices(candidate, incumbent)) {
    const c = calcFee(candidate, sampleExec(price)).customerTotal;
    const i = calcFee(incumbent, sampleExec(price)).customerTotal;
    if (c > i && (!worst || c - i > worst.candidateFee - worst.incumbentFee)) {
      worst = { price, candidateFee: c, incumbentFee: i };
    }
  }
  return worst;
}
```

- [ ] **Step 4: 통과 확인 & 커밋** — `npx vitest run` 전체 통과 → `git commit -m "feat: 지배관계 실패 지점 설명 explainDominanceFailure"`

---

### Task 2: sim.matchedProducts (TDD)

**Files:**
- Modify: `src/domain/types.ts` (FeeRule.sim), `src/store/useStore.ts` (submitRule 2곳)
- Test: `src/store/useStore.test.ts` (기존에 추가)

**Interfaces:**
- Produces: `FeeRule.sim?: { targets: number; saving: number; matchedProducts?: number }` — optional 유지(기존 mock 룰은 필드 없음, UI는 `undefined`=정상 판정으로 간주)

- [ ] **Step 1: 테스트 추가** — 기존 `submitRule → 승인대기` 테스트 옆에

```ts
it('submitRule은 매칭 품목 수를 sim.matchedProducts에 기록', () => {
  useStore.getState().submitRule(newRule, newSched); // 기존 픽스처: CME 6A 대상
  expect(useStore.getState().rules.find(x => x.id === 'R-NEW')!.sim!.matchedProducts).toBe(1);
});
// 기존 zero-scope 테스트(EUREX)의 단언에 matchedProducts: 0 추가
```

- [ ] **Step 2: 실패 확인** → **Step 3: 구현**: `types.ts` sim 타입에 `matchedProducts?: number` 추가; `useStore.ts` submitRule의 정상 경로 `sim: { targets, saving, matchedProducts: targetProducts.length }`, zero-scope 가드 경로 `sim: { targets: 0, saving: 0, matchedProducts: 0 }`.

- [ ] **Step 4: 전체 통과 확인 & 커밋** — `git commit -m "feat: sim.matchedProducts 기록"`

---

### Task 3: wizardDraft 스토어 슬라이스 + Wizard 전환 (TDD)

**Files:**
- Modify: `src/store/useStore.ts`, `src/screens/Wizard.tsx`
- Test: `src/store/useStore.test.ts`

**Interfaces:**
- Produces (스토어): `wizardDraft: { form: unknown; step: number } | null`, `setWizardDraft(d: { form: unknown; step: number } | null): void`. form 타입은 Wizard 내부 타입이므로 스토어에서는 unknown — Wizard가 캐스팅해 사용 (도메인 오염 방지).

- [ ] **Step 1: 스토어 테스트 추가**

```ts
it('wizardDraft는 다른 액션 후에도 유지되고 null로 리셋 가능', () => {
  useStore.getState().setWizardDraft({ form: { name: '작성중' }, step: 3 });
  useStore.getState().rebindAll(); // 무관 액션
  expect(useStore.getState().wizardDraft?.step).toBe(3);
  useStore.getState().setWizardDraft(null);
  expect(useStore.getState().wizardDraft).toBeNull();
});
// reset()이 wizardDraft도 null로 초기화하는 단언 추가
```

- [ ] **Step 2: 실패 확인** → **Step 3: 스토어 구현**: State에 `wizardDraft: { form: unknown; step: number } | null` (초기 null), `setWizardDraft: (d) => set({ wizardDraft: d })`, `reset()`에 `wizardDraft: null` 포함.

- [ ] **Step 4: Wizard 전환** (UI, 테스트는 기존 유지로 검증): `Wizard.tsx`의 `useState(makeInitialForm)`/`useState(step)`을 다음 패턴으로 교체 — 마운트 시 `wizardDraft`가 있으면 그 값으로 초기화, form/step 변경 시마다 `setWizardDraft({ form, step })` 동기화(useEffect), 상신 완료 화면의 "새 이벤트 등록" 버튼과 상신 성공 직후 `setWizardDraft(null)`. 로컬 상태 자체는 유지해도 됨(스토어는 백업 저장소) — 언마운트 후 재마운트 시 복원되는 것이 요건.

- [ ] **Step 5: 전체 통과 + 빌드 확인 & 커밋** — `git commit -m "feat: 위저드 draft 보존 (탭 전환 시 입력 유지)"`

---

### Task 4: labels 헬퍼 + RuleDetail 추출 + 승인함 재사용

**Files:**
- Create: `src/screens/labels.ts`, `src/screens/RuleDetail.tsx`
- Modify: `src/screens/Approvals.tsx`

**Interfaces:**
- Produces: `ruleTypeLabel(t: RuleType): string` → '기본(BASE)' | '이벤트(EVENT)' | '협의수수료(NEGOTIATED)'; `<RuleDetail rule={FeeRule} />` — 기본정보/적용범위/요율표 테이블/검증 배지 3종/대상 요약/log 목록 렌더.

- [ ] **Step 1: labels.ts**

```ts
import type { RuleType } from '../domain/types';
export const ruleTypeLabel = (t: RuleType): string =>
  t === 'BASE' ? '기본(BASE)' : t === 'EVENT' ? '이벤트(EVENT)' : '협의수수료(NEGOTIATED)';
```

- [ ] **Step 2: RuleDetail.tsx 작성** — Approvals.tsx의 카드 본문(기본정보 라인, 적용범위 요약, 요율표 구성요소 테이블+회사부담 warn, 검증 배지 3종)을 그대로 이동하고 다음을 추가/변경: 유형은 `ruleTypeLabel` 사용; **판정불가 통일** — `rule.sim?.matchedProducts === 0`이면 지배관계·역마진 배지 둘 다 '판정불가'(pill-pending), `matchedProducts`가 undefined면 기존 판정 로직 유지(기존 활성 룰 호환. Approvals의 기존 `!products.some(scopeMatches)` 동적 판별은 제거하고 matchedProducts 기반으로 단순화); 대상 요약(Dashboard의 대상 컬럼 ternary 로직을 useStore에서 enrollments/accounts 읽어 재현); 하단에 log 목록(`rule.log.map`). 스토어 접근은 컴포넌트 내부에서 `useStore()` 직접 사용(부모가 rule만 넘김).

- [ ] **Step 3: Approvals.tsx 교체** — 카드 본문을 `<RuleDetail rule={rule} />`로 대체, 승인/반려 버튼과 반려 사유 input만 유지. 시각 결과 동일해야 함.

- [ ] **Step 4: 검증 & 커밋** — `npx vitest run` 30+α 유지, `npm run build` clean, dev 서버로 승인함 렌더 확인. `git commit -m "feat: 공용 RuleDetail 추출 + 판정불가 배지 통일"`

---

### Task 5: 대시보드 — 행 확장 상세 + 검색/필터 + 상태 컬럼 + 감면액 카드

**Files:**
- Modify: `src/screens/Dashboard.tsx`, `src/styles.css`(추가만)

**Interfaces:**
- Consumes: `RuleDetail`, `ruleTypeLabel` (Task 4)

- [ ] **Step 1: 데이터 소스 변경** — `active` 필터 제거하고 전체 `rules`에서 시작. 컨트롤 바 상태: `query: string`, `typeFilter: RuleType | '전체'`, `statusFilter: RuleStatus | '전체'` (기본 '활성'), `assetFilter: AssetClass | '전체'`. 필터링:

```ts
const visible = rules.filter(r =>
  (statusFilter === '전체' || r.status === statusFilter) &&
  (typeFilter === '전체' || r.type === typeFilter) &&
  (assetFilter === '전체' || r.scope.assetClass === assetFilter) &&
  (query === '' || r.name.includes(query) || r.id.includes(query) ||
    (r.scope.products !== '*' && r.scope.products.some(c => c.toUpperCase().includes(query.toUpperCase())))));
```

- [ ] **Step 2: 테이블** — '상태' 컬럼 추가(기존 pill 클래스: 활성=pill-active, 승인대기=pill-pending, 반려=pill-rejected, 기안/종료=pill-draft). 유형 컬럼은 `ruleTypeLabel`. 행 클릭 → `expandedId` 토글, 펼친 행 아래 `<tr><td colSpan={전체 컬럼 수}><RuleDetail rule={r} /></td></tr>` (Negotiated.tsx의 log 펼침 패턴 참조). 진행률 pct는 기존 로직 유지하되 활성 아닌 룰은 '-' 표시.

- [ ] **Step 3: 카드** — 4번째 카드 "예상 감면 누계": `rules.filter(r => r.status === '활성' && r.type !== 'BASE').reduce((a, r) => a + (r.sim?.saving ?? 0), 0)` → `toLocaleString()`원. 기존 카드 3장은 필터와 무관하게 전체 기준 유지.

- [ ] **Step 4: 검증 & 커밋** — 수동: 검색 '6A' 입력 시 CME 이벤트 노출, 상태 필터 '전체' 시 반려/종료 포함, 행 클릭 상세 확인. `git commit -m "feat: 대시보드 검색·필터 + 행 확장 상세 + 감면액 카드"`

---

### Task 6: 위저드 개선 묶음

**Files:**
- Modify: `src/screens/Wizard.tsx`, `src/styles.css`(추가만)

**Interfaces:**
- Consumes: `explainDominanceFailure` (Task 1), `ruleTypeLabel` (Task 4)

- [ ] **Step 1: 품목 0개 차단** — `canProceed2`에 매칭 품목 조건 추가: 현재 form 상태로 `scopeMatches`를 적용한 매칭 품목 수를 계산(`useMemo`)해 0이면 다음 비활성. 2단계 하단에 "매칭 품목 N개" 상시 카운트 표시(0이면 warn 톤 + "선택/제외 조건으로 매칭되는 품목이 없습니다").

- [ ] **Step 2: 실패 사유 구체화** — 5단계 dominance 실패 목록 생성부에서 `dominates()` false인 (품목, 기존룰) 쌍마다 `explainDominanceFailure(newSchedule, incumbentSchedule, sampleFor(p))` 호출, 메시지를 `` `${p.name}(${p.code}): 가격 ${f.price}에서 신규 ${f.candidateFee.toLocaleString()}원 > 기존 '${inc.name}' ${f.incumbentFee.toLocaleString()}원` `` 형태로. 동일 (기존룰ID, price) 조합은 품목명을 콤마로 묶어 1줄 그룹핑.

- [ ] **Step 3: CSV 자동 반영 통일** — 품목 CSV textarea의 "체크 반영" 버튼 제거, 계좌 CSV(`accountsParsed`)와 동일하게 입력 텍스트에서 매 렌더 파싱(`parseCsvCodes`)해 즉시 체크 상태에 합산 반영 + "인식 N건 / 무시 M건" 카운트 표시. 주의: 자동 반영 시 체크리스트 수동 토글과의 병합 규칙 — CSV로 인식된 코드는 체크 추가로만 동작(수동 해제한 항목을 CSV가 계속 되살리지 않도록, CSV 파싱 결과를 별도 상태로 두고 최종 선택 = 수동 선택 ∪ CSV 인식으로 계산 후 표시).

- [ ] **Step 4: 단위 suffix** — 요율표 편집기 값 input 옆에 rateType별 고정 라벨: 정률→`bp`, 정액→`원/계약`, minFee 입력엔 `원`. `.unit-suffix` 클래스 styles.css에 추가(입력과 같은 행, muted 톤).

- [ ] **Step 5: 유형 한글 병기** — 1단계 유형 select의 option 라벨을 `ruleTypeLabel` 기반으로 (value는 기존 enum 유지).

- [ ] **Step 6: 검증 & 커밋** — `npx vitest run` 전체 + 빌드 clean + dev 서버에서: 품목 전부 해제 시 2단계 차단, 비싼 요율 입력 시 5단계에 가격·금액 포함 사유, CSV 붙여넣기 즉시 카운트. `git commit -m "feat: 위저드 검증 강화·실패 사유 구체화·CSV 자동 반영·단위 표시"`

---

### Task 7: README 갱신 + 최종 검증

**Files:**
- Modify: `README.md`

- [ ] **Step 1**: 시연 시나리오에 "대시보드에서 룰 클릭 → 상세 확인", "검색창에 6A 입력" 단계 추가. 한계 절의 "새로고침 시 상태 초기화"는 유지하되 "탭 전환 시에는 위저드 입력이 보존됨" 명시.
- [ ] **Step 2**: `npx vitest run`(기존 30 + 신규 ≥4) + `npm run build` + README 시나리오 전체 클릭 확인. `git commit -m "docs: v0.1 README 갱신"`

---

## Self-Review 결과

- 스펙 커버리지: §1→Task 4·5, §2.1→Task 2·4·6, §2.2→Task 3, §2.3→Task 1·6, §3→Task 5, §4(Medium 4건)→Task 4(한글 병기)·5(감면액 카드)·6(suffix·CSV), §5 테스트→Task 1·2·3. 누락 없음.
- 타입 일관성: `matchedProducts?` optional — Task 2 정의와 Task 4 사용 일치. `explainDominanceFailure` 시그니처 Task 1↔6 일치. `wizardDraft` unknown 캐스팅 Task 3 내 일관.
- 실행 세션 주의: Wizard.tsx/Approvals.tsx는 이 계획 작성 시점에 라인 단위로 인용하지 않았으므로(내용은 v0 태스크 산출물), 각 태스크 구현자는 **수정 전 해당 파일을 먼저 읽고** 계획의 의도를 현재 코드 구조에 맞춰 적용할 것.
