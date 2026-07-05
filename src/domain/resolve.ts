import type { Account, Enrollment, FeeKey, FeeRule, FeeSchedule, ScopeSelector } from './types';
import { rankKey, type PolicyPriorityIndex } from './policyRank';

export function scopeMatchesKey(s: ScopeSelector, k: FeeKey): boolean {
  if (s.assetClass !== k.assetClass) return false;
  if (s.exchanges !== '*' && !s.exchanges.includes(k.exchange)) return false;
  if (s.sessions !== '*' && !s.sessions.includes(k.session)) return false;
  const channels = s.channels ?? '*';
  if (channels !== '*' && !channels.includes(k.channel)) return false;
  if (k.product !== null) {              // 파생만 품목 차원
    if (s.products !== '*' && !s.products.includes(k.product)) return false;
    if (s.excludeProducts.includes(k.product)) return false;
  }
  return true;
}

const isActive = (r: FeeRule, today: string) => r.status === '활성' && r.startDate <= today && today <= r.endDate;

export function findBaseSchedule(
  k: FeeKey, rules: FeeRule[], schedules: FeeSchedule[], today: string
): { rule: FeeRule; schedule: FeeSchedule } | null {
  const r = rules.find((x) => x.type === 'BASE' && isActive(x, today) && scopeMatchesKey(x.scope, k));
  if (!r) return null;
  const schedule = schedules.find((s) => s.id === r.scheduleId);
  return schedule ? { rule: r, schedule } : null;
}

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

export interface ResolveCandidate {
  rule: FeeRule | null; schedule: FeeSchedule; avgCustomerFee: number;  // avgCustomerFee = 구조 그룹 순위값(요율/정액)
  source: 'nego' | 'event' | 'base'; isWinner: boolean;
}

export interface ResolveResult {
  key: FeeKey; scheduleId: string; sourceRuleId: string | null;
  source: 'nego' | 'event' | 'base'; candidates: ResolveCandidate[];
}

// 해석: ① 협의 무조건 우선(활성 협의 중 최저 요율) → ② 없으면 사전 산정 순위를 내려가며
// 자격(대상·기간) 통과 첫 정책(이벤트/기본). 요율 재계산 없음 — 순위는 policyRank가 미리 산정.
export function resolve(
  acct: Account,
  key: FeeKey,
  _rules: FeeRule[],
  schedules: FeeSchedule[],
  nego: NegoException[],
  index: PolicyPriorityIndex,
  today: string,
  enrollments: Enrollment[]
): ResolveResult | null {
  const schedOf = (id: string) => schedules.find((s) => s.id === id)!;

  const negoCands = nego.filter(
    (n) => n.accountId === acct.id && n.status === '활성' && n.validFrom <= today && today <= n.validTo && scopeMatchesKey(n.scope, key),
  );

  // 승자 결정
  let winner: { schedule: FeeSchedule; ruleId: string | null; source: 'nego' | 'event' | 'base' } | null = null;
  if (negoCands.length) {
    const best = negoCands.map((n) => schedOf(n.scheduleId)).sort((a, b) => rankKey(a) - rankKey(b))[0];
    winner = { schedule: best, ruleId: null, source: 'nego' };
  } else {
    const w = index.winnerFor(key, acct, enrollments);
    if (w) winner = { schedule: schedOf(w.scheduleId), ruleId: w.ruleId, source: w.source };
  }
  if (!winner) return null;

  // 표시용 후보 목록: 협의(각각) + 이 feeKey에 매칭되는 순위 정책(요율 오름차순). avgCustomerFee=순위값.
  const negoRows: ResolveCandidate[] = negoCands.map((n) => {
    const s = schedOf(n.scheduleId);
    return { rule: null, schedule: s, avgCustomerFee: rankKey(s), source: 'nego' as const, isWinner: winner!.source === 'nego' && s.id === winner!.schedule.id };
  });
  const polRows: ResolveCandidate[] = index.policies
    .filter((p) => scopeMatchesKey(p.scope, key))
    .map((p) => ({
      rule: p.rule, schedule: schedOf(p.scheduleId), avgCustomerFee: p.rank, source: p.source,
      isWinner: winner!.source !== 'nego' && p.ruleId === winner!.ruleId,
    }));

  return { key, scheduleId: winner.schedule.id, sourceRuleId: winner.ruleId, source: winner.source, candidates: [...negoRows, ...polRows] };
}
