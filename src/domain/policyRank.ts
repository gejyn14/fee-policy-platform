import type { Execution, FeeKey, FeeRule, FeeSchedule, Product, ScopeSelector } from './types';
import { calcFee } from './calc';
import { scopeMatchesKey } from './resolve';

// 같은 feeKey 안에서는 승자가 가격 무관이므로(구조 일관 + 지배관계 + 교차 없음),
// 기준 체결 한 점에서만 평가하면 그 순위가 전 구간에서 성립한다.
export interface RankedPolicy {
  ruleId: string; source: 'base' | 'event'; name: string;
  scope: ScopeSelector; scheduleId: string; scheduleName: string; rank: number;
}

const REF_PRODUCT: Product = { assetClass: '국내주식', exchange: 'X', code: 'X', name: 'X', currency: 'KRW', sessions: [] };
// 기준 체결: 가격 100 · 수량 10(거래대금 1000). calcFee는 품목을 안 쓴다.
const refExec: Execution = { accountId: 'REF', product: REF_PRODUCT, session: '정규', channel: 'MTS', price: 100, qty: 10, notional: 1000 };

export function rankValue(schedule: FeeSchedule): number {
  return calcFee(schedule, refExec).customerTotal;
}

const isActive = (r: FeeRule, today: string) => r.status === '활성' && r.startDate <= today && today <= r.endDate;

// 계좌 무관 정책 = 기본(BASE) + 전체 대상 이벤트(타겟추출형, 지정 계좌 없음).
// 신청/가입/휴면/지정계좌/상대형은 계좌 특정 → 제외(체결 시 오버레이로 얹음).
export function isAccountIndependent(r: FeeRule): boolean {
  if (r.type === 'BASE') return true;
  if (r.type !== 'EVENT') return false;
  return r.applyMode === '타겟추출형' && (!r.targetAccountIds || r.targetAccountIds.length === 0);
}

export interface PolicyPriorityIndex {
  policies: RankedPolicy[];               // rank 오름차순(전 정책)
  winnerFor(key: FeeKey): RankedPolicy | null;   // 그 feeKey에 걸리는 계좌 무관 최저가
}

export function buildPolicyPriority(rules: FeeRule[], schedules: FeeSchedule[], today: string): PolicyPriorityIndex {
  const policies: RankedPolicy[] = rules
    .filter((r) => isActive(r, today) && isAccountIndependent(r))
    .map((r): RankedPolicy | null => {
      const sched = schedules.find((s) => s.id === r.scheduleId);
      if (!sched) return null;
      return { ruleId: r.id, source: r.type === 'BASE' ? 'base' : 'event', name: r.name,
        scope: r.scope, scheduleId: r.scheduleId, scheduleName: sched.name, rank: rankValue(sched) };
    })
    .filter((p): p is RankedPolicy => p !== null)
    .sort((a, b) => a.rank - b.rank);

  return {
    policies,
    // policies가 rank 오름차순이므로 매칭되는 첫 정책 = 최소 rank.
    winnerFor: (key) => policies.find((p) => scopeMatchesKey(p.scope, key)) ?? null,
  };
}
