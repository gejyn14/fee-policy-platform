import { it, expect, describe } from 'vitest';
import { scopeMatchesKey, findBaseSchedule, buildScopeIndex, resolve } from './resolve';
import type { NegoException } from './resolve';
import type { Account, FeeKey, FeeRule, FeeSchedule, ScopeSelector } from './types';

const key = (over: Partial<FeeKey> = {}): FeeKey =>
  ({ assetClass: '국내주식', exchange: 'KRX', session: '정규', channel: 'MTS', product: null, ...over });
const derivKey = (over: Partial<FeeKey> = {}): FeeKey =>
  ({ assetClass: '해외파생', exchange: 'CME', session: '정규', channel: 'HTS', product: '6A', ...over });
const scope = (over: Partial<ScopeSelector> = {}): ScopeSelector =>
  ({ assetClass: '국내주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [], ...over });
const sched = (id: string, flat: number): FeeSchedule =>
  ({ id, name: id, components: [{ name: '위탁', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: flat }] });
const rule = (over: Partial<FeeRule>): FeeRule => ({
  id: 'R', name: 'r', type: 'BASE', status: '활성', applyMode: '일괄적용형',
  startDate: '2020-01-01', endDate: '2099-12-31', scope: scope(), scheduleId: 'S',
  warnings: { dominance: true, reverseMargin: false }, createdBy: 't', log: [], ...over });

describe('scopeMatchesKey', () => {
  it('채널 스코프 매칭', () => {
    expect(scopeMatchesKey(scope({ channels: ['MTS'] }), key({ channel: 'MTS' }))).toBe(true);
    expect(scopeMatchesKey(scope({ channels: ['HTS'] }), key({ channel: 'MTS' }))).toBe(false);
  });
  it('세션·거래소 매칭', () => {
    expect(scopeMatchesKey(scope({ exchanges: ['NXT'] }), key({ exchange: 'KRX' }))).toBe(false);
    expect(scopeMatchesKey(scope({ sessions: ['프리'] }), key({ session: '정규' }))).toBe(false);
  });
  it('주식은 품목 차원 무시(product null이면 scope.products 안 봄)', () => {
    expect(scopeMatchesKey(scope({ products: ['005930'] }), key({ product: null }))).toBe(true);
  });
  it('파생은 품목 매칭', () => {
    const s = scope({ assetClass: '해외파생', products: ['6A'] });
    expect(scopeMatchesKey(s, derivKey({ product: '6A' }))).toBe(true);
    expect(scopeMatchesKey(s, derivKey({ product: '6B' }))).toBe(false);
  });
  it('channels 미설정이면 제약 없음', () => {
    const s = { ...scope() }; delete (s as { channels?: unknown }).channels;
    expect(scopeMatchesKey(s as ScopeSelector, key({ channel: '반대매매' }))).toBe(true);
  });
});

describe('findBaseSchedule / buildScopeIndex', () => {
  const schedules = [sched('S-BASE', 100), sched('S-EVT', 50)];
  const base = rule({ id: 'R-BASE', scheduleId: 'S-BASE' });
  const evt = rule({ id: 'R-EVT', type: 'EVENT', scheduleId: 'S-EVT', scope: scope({ channels: ['MTS'] }) });
  const expired = rule({ id: 'R-OLD', type: 'EVENT', scheduleId: 'S-EVT', endDate: '2020-12-31' });

  it('활성 BASE 조회', () => {
    const r = findBaseSchedule(key(), [base, evt], schedules, '2026-07-04');
    expect(r?.rule.id).toBe('R-BASE');
    expect(r?.schedule.id).toBe('S-BASE');
  });
  it('scope_index는 활성+매칭 이벤트만', () => {
    const idx = buildScopeIndex([base, evt, expired], '2026-07-04');
    const c = idx.candidatesFor(key({ channel: 'MTS' }));
    expect(c.map(r => r.id)).toContain('R-EVT');
    expect(c.map(r => r.id)).not.toContain('R-OLD');   // 기간 밖
    expect(c.map(r => r.id)).not.toContain('R-BASE');  // BASE는 scope_index 아님
    expect(idx.candidatesFor(key({ channel: 'HTS' })).map(r => r.id)).not.toContain('R-EVT'); // 채널 불일치
  });
});

describe('resolve', () => {
  const acct: Account = { id: '110000001002', name: '이', grade: 'SILVER', dormantReturned: false, metric6mAsset: 600_000_000, metric6mVolume: 0 };
  const schedules = [sched('S-BASE', 100), sched('S-EVT', 50), sched('S-NEGO', 30)];
  const base = rule({ id: 'R-BASE', scheduleId: 'S-BASE' });
  const evt = rule({ id: 'R-EVT', type: 'EVENT', scheduleId: 'S-EVT', scope: scope({ channels: ['MTS'] }) });
  const idx = (rs = [base, evt]) => buildScopeIndex(rs, '2026-07-04');

  it('BASE만이면 base 승자', () => {
    const r = resolve(acct, key(), [base], schedules, [], idx([base]), '2026-07-04');
    expect(r!.source).toBe('base'); expect(r!.scheduleId).toBe('S-BASE');
  });
  it('이벤트가 더 싸면 event 승자', () => {
    const r = resolve(acct, key({ channel: 'MTS' }), [base, evt], schedules, [], idx(), '2026-07-04');
    expect(r!.source).toBe('event'); expect(r!.sourceRuleId).toBe('R-EVT');
    expect(r!.candidates[0].isWinner).toBe(true);
    expect(r!.candidates.map(c => c.avgCustomerFee)).toEqual([...r!.candidates.map(c => c.avgCustomerFee)].sort((a,b)=>a-b));
  });
  it('nego가 최저가면 nego 승자(rule null, sourceRuleId null)', () => {
    const nego: NegoException[] = [{ accountId: acct.id, scope: scope({ channels: '*' }), scheduleId: 'S-NEGO', validFrom: '2026-01-01', validTo: '2026-12-31' }];
    const r = resolve(acct, key({ channel: 'MTS' }), [base, evt], schedules, nego, idx(), '2026-07-04');
    expect(r!.source).toBe('nego'); expect(r!.sourceRuleId).toBeNull();
    expect(r!.scheduleId).toBe('S-NEGO');
  });
  it('다른 계좌 nego는 무시', () => {
    const nego: NegoException[] = [{ accountId: '999999999999', scope: scope(), scheduleId: 'S-NEGO', validFrom: '2026-01-01', validTo: '2026-12-31' }];
    const r = resolve(acct, key({ channel: 'MTS' }), [base, evt], schedules, nego, idx(), '2026-07-04');
    expect(r!.source).toBe('event');
  });
});
