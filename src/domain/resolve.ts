import type { Account, Enrollment, Execution, FeeKey, FeeRule, FeeSchedule, Product, ScopeSelector } from './types';
import { calcFee } from './calc';
import { probePrices } from './dominance';
import { isTarget, isBenefitActive } from './binding';

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
export function buildScopeIndex(rules: FeeRule[], _today: string): ScopeIndex {
  // 상태만으로 인덱싱 — 기간(혜택 유효)은 resolve의 isBenefitActive가 계좌별로 판정한다
  // (상대형 혜택이 신청 마감 이후에도 후보로 남게 하기 위함).
  const overlays = rules.filter((r) => r.type === 'EVENT' && r.status === '활성');
  return { candidatesFor: (k) => overlays.filter((r) => scopeMatchesKey(r.scope, k)) };
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
  rule: FeeRule | null; schedule: FeeSchedule; avgCustomerFee: number;
  source: 'nego' | 'event' | 'base'; isWinner: boolean;
}

export interface ResolveResult {
  key: FeeKey; scheduleId: string; sourceRuleId: string | null;
  source: 'nego' | 'event' | 'base'; candidates: ResolveCandidate[];
}

const SRC_RANK: Record<'nego' | 'event' | 'base', number> = { nego: 0, event: 1, base: 2 };
// 협의는 이벤트·기본보다 무조건 먼저 본다(협의 요율/수수료액이 항상 더 낮음).
const negoFirst = (s: 'nego' | 'event' | 'base'): number => (s === 'nego' ? 0 : 1);

// 동일 계층 동률 tie-break용 적용범위 구체성 점수(제약 차원 수). 높을수록 더 구체적.
function scopeSpecificity(r: FeeRule | null): number {
  if (!r) return 0;
  const s = r.scope; let n = 0;
  if (s.exchanges !== '*') n++;
  if (s.sessions !== '*') n++;
  if ((s.channels ?? '*') !== '*') n++;
  if (s.products !== '*') n++;
  if (s.excludeProducts.length) n++;
  return n;
}

export function resolve(
  acct: Account,
  key: FeeKey,
  rules: FeeRule[],
  schedules: FeeSchedule[],
  nego: NegoException[],
  index: ScopeIndex,
  today: string,
  enrollments: Enrollment[]
): ResolveResult | null {
  const schedOf = (id: string) => schedules.find((s) => s.id === id)!;
  type Cand = { rule: FeeRule | null; schedule: FeeSchedule; source: 'nego' | 'event' | 'base' };
  const cands: Cand[] = [];

  for (const n of nego)
    if (n.accountId === acct.id && n.status === '활성' && n.validFrom <= today && today <= n.validTo && scopeMatchesKey(n.scope, key))
      cands.push({ rule: null, schedule: schedOf(n.scheduleId), source: 'nego' });

  for (const r of index.candidatesFor(key))
    if (isTarget(r, acct, enrollments) && isBenefitActive(r, acct, enrollments, today))
      cands.push({ rule: r, schedule: schedOf(r.scheduleId), source: 'event' });

  const b = findBaseSchedule(key, rules, schedules, today);
  if (b) cands.push({ rule: b.rule, schedule: b.schedule, source: 'base' });

  if (cands.length === 0) return null;

  const dummy: Product = { assetClass: key.assetClass, exchange: key.exchange, code: key.product ?? 'X', name: 'X', currency: 'KRW', sessions: [] };
  const sample = (price: number): Execution => ({ accountId: acct.id, product: dummy, session: key.session, channel: key.channel, price, qty: 10, notional: price * 10 });
  const grid = [...new Set(cands.flatMap((c) => probePrices(c.schedule, c.schedule)))].sort((a, b) => a - b);
  const cost = (s: FeeSchedule) => grid.reduce((a, p) => a + calcFee(s, sample(p)).customerTotal, 0) / grid.length;

  const ranked = cands
    .map((c) => ({ ...c, avgCustomerFee: cost(c.schedule) }))
    .sort((a, b) =>
      negoFirst(a.source) - negoFirst(b.source)                        // ① 협의는 무조건 우선(항상 더 낮음)
      || a.avgCustomerFee - b.avgCustomerFee                           // ② 이벤트·기본은 그 아래에서 최저가
      || SRC_RANK[a.source] - SRC_RANK[b.source]                       // ③ 동률이면 계층: 이벤트>기본
      || scopeSpecificity(b.rule) - scopeSpecificity(a.rule)          // ④ 동일 계층: 더 구체적 범위 우선
      || (b.rule?.startDate ?? '').localeCompare(a.rule?.startDate ?? '') // ⑤ 더 최근 시작
      || (a.rule?.id ?? '').localeCompare(b.rule?.id ?? ''));          // ⑥ 식별자(결정성)

  const candidates: ResolveCandidate[] = ranked.map((c, i) => ({
    rule: c.rule, schedule: c.schedule, avgCustomerFee: c.avgCustomerFee, source: c.source, isWinner: i === 0,
  }));
  const w = ranked[0];
  return { key, scheduleId: w.schedule.id, sourceRuleId: w.rule ? w.rule.id : null, source: w.source, candidates };
}
