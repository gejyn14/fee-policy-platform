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

/**
 * 활성+scope+대상 필터를 통과한 후보 룰을 공동 union probe grid 평균 비용
 * 오름차순(동률 시 TIE_ORDER)으로 정렬해 반환한다. rebindAccount와 explainBinding이 공유하는 헬퍼.
 */
function rankCandidates(
  acct: Account, product: Product, rules: FeeRule[], schedules: FeeSchedule[],
  enrollments: Enrollment[], today: string,
): { rule: FeeRule; cost: number }[] {
  const active = rules.filter((r) => r.status === '활성' && r.startDate <= today && today <= r.endDate);
  const schedOf = (id: string) => schedules.find((s) => s.id === id)!;
  const candidates = active.filter((r) => scopeMatches(r.scope, product) && isTarget(r, acct, enrollments));
  if (candidates.length === 0) return [];

  const sample = (price: number): Execution =>
    ({ accountId: acct.id, product, session: product.sessions[0], price, qty: 10, notional: price * 10 });
  // 검사 가격 평균 고객부과액으로 비교: 모든 후보가 공동 probe grid를 공유해야 공정한 비교가 된다
  // (구간표 경계가 후보마다 다르면 각자 사설 그리드로 평균 낼 경우 비교가 왜곡됨)
  const scheds = candidates.map((r) => schedOf(r.scheduleId));
  const grid = [...new Set(scheds.flatMap((s) => probePrices(s, s)))].sort((a, b) => a - b);
  const cost = (r: FeeRule) =>
    grid.reduce((a, price) => a + calcFee(schedOf(r.scheduleId), sample(price)).customerTotal, 0) / grid.length;

  return candidates
    .map((rule) => ({ rule, cost: cost(rule) }))
    .sort((a, b) => a.cost - b.cost || TIE_ORDER[a.rule.type] - TIE_ORDER[b.rule.type]);
}

export function rebindAccount(
  acct: Account, rules: FeeRule[], schedules: FeeSchedule[],
  enrollments: Enrollment[], products: Product[], today: string,
): FeeBinding[] {
  const bindings: FeeBinding[] = [];

  for (const p of products) {
    const ranked = rankCandidates(acct, p, rules, schedules, enrollments, today);
    if (ranked.length === 0) continue;
    const winner = ranked[0].rule;

    bindings.push({
      accountId: acct.id, scopeKey: `${p.exchange}:${p.code}`,
      scheduleId: winner.scheduleId, sourceRuleId: winner.id,
      validFrom: winner.startDate, validTo: winner.endDate,
      reason: `${winner.type === 'BASE' ? '기본(등급)' : winner.type === 'EVENT' ? '이벤트' : '협의수수료'} '${winner.name}' 최저가 적용`,
    });
  }
  return bindings;
}

export interface CandidateTrace { rule: FeeRule; schedule: FeeSchedule; avgCustomerFee: number; isWinner: boolean }
export interface RejectedTrace { rule: FeeRule; reason: '범위 불일치' | '기간 밖' | '대상 아님' }
export interface BindingTrace { candidates: CandidateTrace[]; rejected: RejectedTrace[]; binding: FeeBinding | null; tieBreakApplied: boolean }

export function explainBinding(
  acct: Account, product: Product, rules: FeeRule[], schedules: FeeSchedule[],
  enrollments: Enrollment[], today: string,
): BindingTrace {
  const schedOf = (id: string) => schedules.find((s) => s.id === id)!;
  const ranked = rankCandidates(acct, product, rules, schedules, enrollments, today);
  const candidateIds = new Set(ranked.map((c) => c.rule.id));

  const candidates: CandidateTrace[] = ranked.map(({ rule, cost }, i) => ({
    rule, schedule: schedOf(rule.scheduleId), avgCustomerFee: cost, isWinner: i === 0,
  }));

  const rejected: RejectedTrace[] = rules
    .filter((r) => r.status === '활성' && r.scope.assetClass === product.assetClass && !candidateIds.has(r.id))
    .map((rule) => {
      const reason: RejectedTrace['reason'] =
        today < rule.startDate || today > rule.endDate ? '기간 밖'
        : !scopeMatches(rule.scope, product) ? '범위 불일치'
        : '대상 아님';
      return { rule, reason };
    });

  const tieBreakApplied = ranked.length >= 2 && ranked[0].cost === ranked[1].cost;

  const winner = ranked[0]?.rule ?? null;
  const binding: FeeBinding | null = winner ? {
    accountId: acct.id, scopeKey: `${product.exchange}:${product.code}`,
    scheduleId: winner.scheduleId, sourceRuleId: winner.id,
    validFrom: winner.startDate, validTo: winner.endDate,
    reason: `${winner.type === 'BASE' ? '기본(등급)' : winner.type === 'EVENT' ? '이벤트' : '협의수수료'} '${winner.name}' 최저가 적용`,
  } : null;

  return { candidates, rejected, binding, tieBreakApplied };
}
