import type { Account, Enrollment, FeeKey, FeeRule, FeeSchedule, ScopeSelector } from './types';
import { scopeMatchesKey } from './resolve';
import { isTarget, isBenefitActive } from './binding';

// 정책 순위 항목 — 기본 + 모든 이벤트를 하나의 요율 순위로 담는다(계좌 특정 여부와 무관).
export interface RankedPolicy {
  ruleId: string; source: 'base' | 'event'; name: string;
  scope: ScopeSelector; scheduleId: string; scheduleName: string;
  rule: FeeRule; rank: number;
}

// 구조 그룹 순위 키 — feeKey 안은 구조가 단일(정률/정액/최소+요율)이라 같은 단위끼리만 비교된다.
// 기준체결(합성 가격) 없이 고객부과 요율 파라미터로 직접 비교: 정률=요율 합, 정액=정액 합,
// 최소+요율(구간표)=대표 구간의 (요율+최소). 등록 시 단조·비교차가 보장돼 순서가 가격과 무관.
export function rankKey(schedule: FeeSchedule): number {
  let v = 0;
  for (const c of schedule.components) {
    if (c.payer !== '고객부과') continue;
    if (c.rateType === '정률') v += c.rateBp ?? 0;
    else if (c.rateType === '정액') v += c.flatAmount ?? 0;
    else { const b = (c.bands ?? [])[0]; if (b) v += (b.rateBp ?? 0) + (b.flat ?? 0); }
  }
  return v;
}

// 순위 편입 조건 — status 활성 + 기간. 단 상대형 이벤트는 기간이 계좌별 가입일 기준이라
// 룰 기간(신청 마감)이 지나도 편입하고, 실제 유효는 winnerFor의 isBenefitActive가 계좌별로 판정한다.
const inRanking = (r: FeeRule, today: string): boolean => {
  if (r.status !== '활성') return false;
  if (r.type === 'EVENT' && (r.benefit?.kind === '상대')) return true;
  return r.startDate <= today && today <= r.endDate;
};

// 동률 tie-break용 적용범위 구체성(제약 차원 수). 높을수록 더 구체적.
function scopeSpecificity(r: FeeRule): number {
  const s = r.scope; let n = 0;
  if (s.exchanges !== '*') n++;
  if (s.sessions !== '*') n++;
  if ((s.channels ?? '*') !== '*') n++;
  if (s.products !== '*') n++;
  if (s.excludeProducts.length) n++;
  return n;
}

export interface PolicyPriorityIndex {
  policies: RankedPolicy[];   // rank 오름차순(기본 + 전 이벤트)
  // 계좌가 실제 받는 승자(협의 제외): 순위를 내려가며 자격(대상·기간) 통과 첫 정책.
  winnerFor(key: FeeKey, acct: Account, enrollments: Enrollment[]): RankedPolicy | null;
  // 자격 무시 최상위(화면 참고용) — 이 feeKey의 이론상 최저.
  topFor(key: FeeKey): RankedPolicy | null;
}

export function buildPolicyPriority(rules: FeeRule[], schedules: FeeSchedule[], today: string): PolicyPriorityIndex {
  const policies: RankedPolicy[] = rules
    .filter((r) => (r.type === 'BASE' || r.type === 'EVENT') && inRanking(r, today))
    .map((r): RankedPolicy | null => {
      const sched = schedules.find((s) => s.id === r.scheduleId);
      if (!sched) return null;
      return {
        ruleId: r.id, source: r.type === 'BASE' ? 'base' : 'event', name: r.name,
        scope: r.scope, scheduleId: r.scheduleId, scheduleName: sched.name, rule: r, rank: rankKey(sched),
      };
    })
    .filter((p): p is RankedPolicy => p !== null)
    .sort((a, b) =>
      a.rank - b.rank                                         // ① 요율 최저(구조 그룹 순위)
      || scopeSpecificity(b.rule) - scopeSpecificity(a.rule)  // ② 동률: 더 구체적 적용범위
      || a.ruleId.localeCompare(b.ruleId));                   // ③ 식별자(결정성)

  // 자격: 기본은 항상, 이벤트는 대상 게이트(isTarget)·기간 게이트(isBenefitActive) 통과분만.
  const eligible = (p: RankedPolicy, acct: Account, enr: Enrollment[]) =>
    p.source === 'base' || (isTarget(p.rule, acct, enr) && isBenefitActive(p.rule, acct, enr, today));

  return {
    policies,
    winnerFor: (key, acct, enr) =>
      policies.find((p) => scopeMatchesKey(p.scope, key) && eligible(p, acct, enr)) ?? null,
    topFor: (key) => policies.find((p) => scopeMatchesKey(p.scope, key)) ?? null,
  };
}
