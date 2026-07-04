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
