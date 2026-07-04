import type { FeeKey, FeeRule, FeeSchedule, ScopeSelector } from './types';

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
  k: FeeKey,
  rules: FeeRule[],
  schedules: FeeSchedule[],
  today: string
): { rule: FeeRule; schedule: FeeSchedule } | null {
  const r = rules.find((x) => x.type === 'BASE' && isActive(x, today) && scopeMatchesKey(x.scope, k));
  if (!r) return null;
  const schedule = schedules.find((s) => s.id === r.scheduleId);
  return schedule ? { rule: r, schedule } : null;
}

export interface ScopeIndex { candidatesFor(k: FeeKey): FeeRule[] }
export function buildScopeIndex(rules: FeeRule[], today: string): ScopeIndex {
  const overlays = rules.filter((r) => r.type !== 'BASE' && isActive(r, today));
  return { candidatesFor: (k) => overlays.filter((r) => scopeMatchesKey(r.scope, k)) };
}
