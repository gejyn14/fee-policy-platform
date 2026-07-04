# v0.3 수수료 결정 흐름 trace 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신규 탭 "수수료 결정 흐름" — 계좌×품목을 고르면 To-Be 로직(①계좌→②후보 룰→③최저가 경쟁→④확정 바인딩→⑤calcFee 금액)을 단계별 미니 테이블과 함께 시연.

**Architecture:** rebindAccount의 후보 수집·비용 비교·승자 선택을 `rankCandidates` 헬퍼로 추출(동작 불변)하고, 그 위에 `explainBinding`(결정 과정 전체 반환)을 TDD로 얹는다. 화면(FeeTrace.tsx)은 BindingTrace를 그리기만 한다. 스펙: `docs/superpowers/specs/2026-07-04-v03-fee-decision-trace-design.md` **먼저 읽을 것**.

**Tech Stack:** 기존 동일. 신규 의존성 금지.

## Global Constraints

- UI 문구 전부 한국어. src/domain/은 React-free. 리팩터는 동작 불변 — **기존 61개 테스트 전부 무수정 통과가 증거** (단언 조정 금지).
- 각 태스크 완료 시 `npx vitest run` + `npm run build`. 커밋 메시지 끝 `Co-Authored-By: Claude <noreply@anthropic.com>`.
- 병렬 실행 시 파일 겹침 금지·에이전트 커밋 금지(배리어에서 컨트롤러 순차 커밋) 관례 유지. 이번은 T1→T2→T3 순차 권장(의존 체인).

## 파일 구조

```
src/domain/binding.ts        # rankCandidates 추출 + explainBinding 추가 (T1)
src/domain/binding.test.ts   # explainBinding 테스트 추가 (T1)
src/screens/FeeTrace.tsx     # 신규 탭 화면 (T2)
src/App.tsx                  # 탭 '수수료 결정 흐름' 추가 (T2)
src/styles.css               # 추가만 — trace 체인/하이라이트 (T2)
README.md                    # 시연 시나리오 갱신 (T3)
```

---

### Task 1: rankCandidates 추출 + explainBinding (TDD)

**Files:**
- Modify: `src/domain/binding.ts`
- Test: `src/domain/binding.test.ts` (추가)

**Interfaces:**
- Produces:
```ts
export interface CandidateTrace { rule: FeeRule; schedule: FeeSchedule; avgCustomerFee: number; isWinner: boolean }
export interface RejectedTrace { rule: FeeRule; reason: '범위 불일치' | '기간 밖' | '대상 아님' }
export interface BindingTrace { candidates: CandidateTrace[]; rejected: RejectedTrace[]; binding: FeeBinding | null; tieBreakApplied: boolean }
export function explainBinding(acct: Account, product: Product, rules: FeeRule[], schedules: FeeSchedule[], enrollments: Enrollment[], today: string): BindingTrace
```
- 내부 헬퍼(비공개 가능): `rankCandidates(...)` — 후보 룰과 비용을 오름차순+tie-break 순으로 반환. `rebindAccount`와 `explainBinding` 둘 다 이것을 사용.

- [ ] **Step 1: 현재 코드 읽기** — `src/domain/binding.ts`의 `rebindAccount`(활성 필터 → scopeMatches → isTarget → 공동 union probe grid 평균 `cost` → `TIE_ORDER` 정렬 → 승자 바인딩 생성)를 정독. 이 로직을 그대로 헬퍼로 옮길 것이므로 수식·순서를 바꾸지 말 것.

- [ ] **Step 2: 실패하는 테스트 추가** — `src/domain/binding.test.ts`에 describe 추가 (기존 헬퍼 `flatSched`/`rule`/`p6A`/`acct` 재사용 — 실제 이름 확인 후 사용):

```ts
import { explainBinding } from './binding';

describe('explainBinding', () => {
  const schedules = [flatSched('S-BASE', 50), flatSched('S-EVT', 30)];
  const base = rule({ id: 'R-BASE', scheduleId: 'S-BASE' });
  const evt = rule({ id: 'R-EVT', type: 'EVENT', scheduleId: 'S-EVT' });

  it('승자가 rebindAccount 바인딩과 일치하고 candidates가 비용 오름차순', () => {
    const t = explainBinding(acct, p6A, [base, evt], schedules, [], '2026-07-04');
    expect(t.binding!.sourceRuleId).toBe('R-EVT');
    expect(t.candidates.map(c => c.rule.id)).toEqual(['R-EVT', 'R-BASE']);
    expect(t.candidates[0].isWinner).toBe(true);
    expect(t.candidates[1].isWinner).toBe(false);
    expect(t.candidates[0].avgCustomerFee).toBeLessThan(t.candidates[1].avgCustomerFee);
    // rebindAccount와 동일 승자 (일관성 계약)
    const bs = rebindAccount(acct, [base, evt], schedules, [], [p6A], '2026-07-04');
    expect(t.binding!.scheduleId).toBe(bs[0].scheduleId);
  });

  it('동률이면 tieBreakApplied=true + 협수 승', () => {
    const nego = rule({ id: 'R-NEGO', type: 'NEGOTIATED', applyMode: '신청형', scheduleId: 'S-EVT' });
    const enr = [{ accountId: acct.id, ruleId: 'R-NEGO', enrolledAt: '2026-01-02', channel: '지점' }];
    const t = explainBinding(acct, p6A, [base, evt, nego], schedules, enr, '2026-07-04');
    expect(t.binding!.sourceRuleId).toBe('R-NEGO');
    expect(t.tieBreakApplied).toBe(true);
  });

  it('rejected에 탈락 사유가 분류됨', () => {
    const expired = rule({ id: 'R-EXP', type: 'EVENT', scheduleId: 'S-EVT', endDate: '2026-06-30' });
    const wrongScope = rule({ id: 'R-6E', type: 'EVENT', scheduleId: 'S-EVT',
      scope: { assetClass: '해외파생', exchanges: '*', sessions: '*', currencies: '*', products: ['6E'], excludeProducts: [] } });
    const notTarget = rule({ id: 'R-APPLY', type: 'EVENT', applyMode: '신청형', scheduleId: 'S-EVT' }); // 신청 없음
    const t = explainBinding(acct, p6A, [base, expired, wrongScope, notTarget], schedules, [], '2026-07-04');
    const reason = (id: string) => t.rejected.find(r => r.rule.id === id)?.reason;
    expect(reason('R-EXP')).toBe('기간 밖');
    expect(reason('R-6E')).toBe('범위 불일치');
    expect(reason('R-APPLY')).toBe('대상 아님');
    expect(t.candidates.map(c => c.rule.id)).toEqual(['R-BASE']);
  });

  it('후보 0건이면 binding null', () => {
    const t = explainBinding(acct, p6A, [], schedules, [], '2026-07-04');
    expect(t.binding).toBeNull();
    expect(t.candidates).toEqual([]);
  });
});
```

- [ ] **Step 3: 실패 확인** — `npx vitest run src/domain/binding.test.ts` → 신규 4건 FAIL, 기존 통과.

- [ ] **Step 4: 구현** —
  1. `rebindAccount` 내부의 per-product 후보 수집+공동 grid 비용+정렬을 `function rankCandidates(acct, product, rules, schedules, enrollments, today): { rule: FeeRule; cost: number }[]`로 추출(활성+scope+isTarget 필터 포함, 반환은 비용 오름차순 → 동률 시 TIE_ORDER). `rebindAccount`는 `rankCandidates(...)[0]`로 승자를 얻어 기존과 동일한 FeeBinding 생성 — **수식·순서 불변**.
  2. `explainBinding`: `rankCandidates` 결과로 candidates(각각 schedule 조인, isWinner=첫 번째, avgCustomerFee=cost) 구성. rejected = 같은 assetClass 룰 중 후보 아닌 것들, 사유 판정 우선순위 **기간 밖 → 범위 불일치 → 대상 아님** (status!=='활성'은 '기간 밖'으로 묶지 말고 제외 — 활성 아닌 룰은 rejected에도 넣지 않음, 화면 노이즈 방지). tieBreakApplied = 상위 2개 cost가 동일한데 순서가 TIE_ORDER로 갈린 경우. binding = 승자 있으면 rebindAccount와 동일 필드로 구성, 없으면 null.

- [ ] **Step 5: 전체 통과 확인** — `npx vitest run` → 기존 61 + 신규 4 = 65 전부 통과 (기존 단언 무수정), `npm run build` clean.

- [ ] **Step 6: 커밋** — `git commit -m "feat: rankCandidates 추출 + explainBinding (결정 과정 trace)"`

---

### Task 2: FeeTrace 화면 + 탭

**Files:**
- Create: `src/screens/FeeTrace.tsx`
- Modify: `src/App.tsx`(탭 '수수료 결정 흐름'), `src/styles.css`(추가만)

**Interfaces:**
- Consumes: `explainBinding`/`BindingTrace`(T1), `calcFee`(src/domain/calc.ts — FeeResult{customerTotal, companyBorne, lines}), `useStore()`(accounts/products/rules/schedules/enrollments), `TODAY`, `ruleTypeLabel`(src/screens/labels.ts)

- [ ] **Step 1: 입력부** — 계좌 select(4건: id+이름+등급) + 품목 검색형 단일 선택: 검색 input(코드/이름, 대소문자 무시) → 결과 상위 20건 리스트에서 클릭 선택, 선택되면 `거래소:코드 이름` 라벨 표시 + [변경] 버튼. 계좌·품목 둘 다 선택돼야 [다음 단계] 활성. 계좌/품목 변경 시 step=1 리셋.

- [ ] **Step 2: 단계 체인 렌더** — `step` state(1~5). 지나온 단계는 남고 현재 단계 강조(`.trace-step.active`). 각 단계는 카드: 제목 + 미니 테이블 + 1줄 내레이션(스펙 §1 표의 문구 그대로). trace 계산은 `useMemo(() => explainBinding(acct, product, rules, schedules, enrollments, TODAY), [acct, product, rules, schedules, enrollments])`.
  - ①: 계좌 행(계좌번호/이름/등급/6개월평균자산·약정액 — 억 단위는 Negotiated.tsx의 formatEok 패턴 참고해 자체 헬퍼).
  - ②: trace.candidates의 룰 행들(ID/이름/유형(ruleTypeLabel)/적용형태/기간) + trace.rejected 회색 행(탈락 사유 표시, 최대 3건 + "외 N건").
  - ③: 후보별 요율표 이름 + `avgCustomerFee.toLocaleString()`원, 오름차순 표. 첫 행 하이라이트(`.trace-winner`) + "최저가" pill. `trace.tieBreakApplied`면 "동률 → 협수>이벤트>기본 순 적용" 문구.
  - ④: trace.binding을 FEE_BINDING 컬럼명(ACCOUNT_ID/SCOPE_KEY/SCHEDULE_ID/SOURCE_RULE_ID/VALID_FROM~TO/REASON)으로 1행 표시. **스토어 bindings에서 동일 (accountId, scopeKey) 행을 찾아 "실 바인딩 테이블과 일치 ✓" 배지**(불일치면 ⚠ — reconciliation 데모 포인트). binding null이면 "적용 가능한 룰 없음 — 기본 등급 fallback".
  - ⑤: 체결가·수량 input(기본 100/10) → `calcFee(winnerSchedule, {accountId, product, session: product.sessions[0], price, qty, notional: price*qty})` → 구성요소별 라인 테이블(이름/종류/부담주체/금액, 회사부담 `.warn`, 구간표 컴포넌트는 적용 구간 라벨 — AccountView.tsx의 bandLabel 패턴 참고) + 고객부과/회사부담 합계. 내레이션 "금액은 미리 저장하지 않고 요율표×체결로 즉석 계산".
  - [처음부터] 버튼 → step=1.

- [ ] **Step 3: App.tsx 탭 추가** — 기존 TABS 패턴 그대로 '수수료 결정 흐름' 추가. styles.css에 `.trace-step`/`.trace-winner` 등 추가(기존 규칙 수정 금지).

- [ ] **Step 4: 검증 & 커밋** — `npx vitest run` 65 유지 + `npm run build` clean + dev 서버에서: A-1001×CME:6A로 ①→⑤ 통주(③에서 여름 이벤트 승, ④ 일치 ✓, ⑤ 1,500원 분해), NXT:005930으로 국내주식 케이스 확인. `git commit -m "feat: 수수료 결정 흐름 trace 화면"`

---

### Task 3: README + 최종 검증

**Files:**
- Modify: `README.md`

- [ ] **Step 1**: 시연 시나리오에 "수수료 결정 흐름" 단계 추가(팀장 보고용 포인트 명시: 후보 경쟁·바인딩 한 행 조회·즉석 계산). 
- [ ] **Step 2**: `npx vitest run`(65) + `npm run build` + 시나리오 통주. `git commit -m "docs: v0.3 README"`

---

## Self-Review 결과

- 스펙 커버리지: §1 화면 5단계+입력부+빈 상태→T2, §2 explainBinding/rankCandidates/rejected 규칙→T1, §3 검증(TDD 4케이스+리팩터 안전망 61 유지)→T1, §4 범위 외 준수. 누락 없음.
- 타입 일관성: BindingTrace/CandidateTrace/RejectedTrace T1 정의 = T2 소비. explainBinding 시그니처 스펙 §2와 동일.
- 주의: binding.ts의 현재 `cost`/grid 코드는 v0.1 fix(공동 union grid) 반영본 — T1 실행자는 추출 시 반드시 현재 코드를 기준으로 하고 계획의 요약과 다르면 현재 코드가 우선.
