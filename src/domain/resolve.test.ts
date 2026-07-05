import { it, expect, describe } from 'vitest';
import { scopeMatchesKey, findBaseSchedule, buildScopeIndex, resolve } from './resolve';
import type { NegoException } from './resolve';
import type { Account, Enrollment, FeeKey, FeeRule, FeeSchedule, ScopeSelector } from './types';

const key = (over: Partial<FeeKey> = {}): FeeKey =>
  ({ assetClass: '국내주식', exchange: 'KRX', session: '정규', channel: 'MTS', product: null, ...over });
const derivKey = (over: Partial<FeeKey> = {}): FeeKey =>
  ({ assetClass: '해외파생', exchange: 'CME', session: '정규', channel: 'HTS', product: '6A', ...over });
const scope = (over: Partial<ScopeSelector> = {}): ScopeSelector =>
  ({ assetClass: '국내주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [], ...over });
const sched = (id: string, flat: number): FeeSchedule =>
  ({ id, name: id, components: [{ name: '위탁', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: flat }] });
const rule = (over: Partial<FeeRule>): FeeRule => ({
  id: 'R', name: 'r', type: 'BASE', status: '활성', applyMode: '타겟추출형',
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
  const closed = rule({ id: 'R-CLOSED', type: 'EVENT', status: '종료', scheduleId: 'S-EVT' });

  it('활성 BASE 조회', () => {
    const r = findBaseSchedule(key(), [base, evt], schedules, '2026-07-04');
    expect(r?.rule.id).toBe('R-BASE');
    expect(r?.schedule.id).toBe('S-BASE');
  });
  it('scope_index는 활성 상태·스코프 매칭 룰(기간 게이팅은 resolve로 이동)', () => {
    const idx = buildScopeIndex([base, evt, closed], '2026-07-04');
    const c = idx.candidatesFor(key({ channel: 'MTS' }));
    expect(c.map(r => r.id)).toContain('R-EVT');
    expect(c.map(r => r.id)).not.toContain('R-CLOSED');  // 종료 상태 제외
    expect(c.map(r => r.id)).not.toContain('R-BASE');    // BASE는 scope_index 아님
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
    const r = resolve(acct, key(), [base], schedules, [], idx([base]), '2026-07-04', []);
    expect(r!.source).toBe('base'); expect(r!.scheduleId).toBe('S-BASE');
  });
  it('이벤트가 더 싸면 event 승자', () => {
    const r = resolve(acct, key({ channel: 'MTS' }), [base, evt], schedules, [], idx(), '2026-07-04', []);
    expect(r!.source).toBe('event'); expect(r!.sourceRuleId).toBe('R-EVT');
    expect(r!.candidates[0].isWinner).toBe(true);
    expect(r!.candidates.map(c => c.avgCustomerFee)).toEqual([...r!.candidates.map(c => c.avgCustomerFee)].sort((a,b)=>a-b));
  });
  const grant = (over: Partial<NegoException>): NegoException =>
    ({ accountId: acct.id, scope: scope({ channels: '*' }), scheduleId: 'S-NEGO', validFrom: '2026-01-01', validTo: '2026-12-31',
      status: '활성', qualify: '충족', requestId: 'R1', requestedBy: 't', requestedAt: '2026-01-01', ...over });

  it('nego가 최저가면 nego 승자(rule null, sourceRuleId null)', () => {
    const r = resolve(acct, key({ channel: 'MTS' }), [base, evt], schedules, [grant({})], idx(), '2026-07-04', []);
    expect(r!.source).toBe('nego'); expect(r!.sourceRuleId).toBeNull();
    expect(r!.scheduleId).toBe('S-NEGO');
  });
  it('다른 계좌 nego는 무시', () => {
    const r = resolve(acct, key({ channel: 'MTS' }), [base, evt], schedules, [grant({ accountId: '999999999999' })], idx(), '2026-07-04', []);
    expect(r!.source).toBe('event');
  });
  it('요청/반려 상태 grant는 해석에서 제외', () => {
    const r = resolve(acct, key({ channel: 'MTS' }), [base, evt], schedules, [grant({ status: '요청' })], idx(), '2026-07-04', []);
    expect(r!.source).toBe('event');
  });
  it('협의는 이벤트보다 무조건 우선(명목 요율이 이벤트보다 높아도 협의 승자)', () => {
    const schedHi = [...schedules, sched('S-NEGO-HI', 70)];   // 협의 70 > 이벤트 50
    const r = resolve(acct, key({ channel: 'MTS' }), [base, evt], schedHi, [grant({ scheduleId: 'S-NEGO-HI' })], idx(), '2026-07-04', []);
    expect(r!.source).toBe('nego'); expect(r!.scheduleId).toBe('S-NEGO-HI');
  });
});

describe('resolve — 적용기간(benefit)', () => {
  const acct: Account = { id: '110000001002', name: '이', grade: 'SILVER', dormantReturned: false, metric6mAsset: 600_000_000, metric6mVolume: 0 };
  const schedules = [sched('S-BASE', 100), sched('S-EVT', 50)];
  const base = rule({ id: 'R-BASE', scheduleId: 'S-BASE' });
  const relEvt = rule({ id: 'R-REL', type: 'EVENT', applyMode: '가입형', scheduleId: 'S-EVT',
    scope: scope({ channels: ['MTS'] }), benefit: { kind: '상대', months: 2 }, startDate: '2026-04-01', endDate: '2026-06-30' });
  const calX = rule({ id: 'R-CALX', type: 'EVENT', applyMode: '타겟추출형', scheduleId: 'S-EVT',
    scope: scope({ channels: ['MTS'] }), endDate: '2020-12-31' });
  const enr = (enrolledAt: string): Enrollment[] => [{ accountId: acct.id, ruleId: 'R-REL', enrolledAt, channel: 'MTS' }];

  it('상대형: 가입일+N 안이면 event 승자(신청 마감 지나도)', () => {
    const idx = buildScopeIndex([base, relEvt], '2026-07-04');
    const r = resolve(acct, key({ channel: 'MTS' }), [base, relEvt], schedules, [], idx, '2026-07-04', enr('2026-06-20'));
    expect(r!.source).toBe('event'); expect(r!.sourceRuleId).toBe('R-REL');
  });
  it('상대형: 가입일+N 지나면 base', () => {
    const idx = buildScopeIndex([base, relEvt], '2026-07-04');
    const r = resolve(acct, key({ channel: 'MTS' }), [base, relEvt], schedules, [], idx, '2026-07-04', enr('2026-04-10'));
    expect(r!.source).toBe('base');
  });
  it('상대형: 가입 이력 없으면 base', () => {
    const idx = buildScopeIndex([base, relEvt], '2026-07-04');
    const r = resolve(acct, key({ channel: 'MTS' }), [base, relEvt], schedules, [], idx, '2026-07-04', []);
    expect(r!.source).toBe('base');
  });
  it('캘린더형 만료 이벤트는 제외(base)', () => {
    const idx = buildScopeIndex([base, calX], '2026-07-04');
    const r = resolve(acct, key({ channel: 'MTS' }), [base, calX], schedules, [], idx, '2026-07-04', []);
    expect(r!.source).toBe('base');
  });
});

describe('resolve — 동일 계층 동률 tie-break', () => {
  const acct: Account = { id: '110000001002', name: '이', grade: 'SILVER', dormantReturned: false, metric6mAsset: 0, metric6mVolume: 0 };
  const schedules = [sched('S-BASE', 100), sched('S-EVT', 50)];
  const base = rule({ id: 'R-BASE', scheduleId: 'S-BASE' });
  // 같은 요율표(동일 고객부담)의 두 이벤트: 하나는 넓은 범위, 하나는 세션 한정(더 구체적)
  const broad = rule({ id: 'R-BROAD', type: 'EVENT', scheduleId: 'S-EVT', scope: scope({ channels: ['MTS'] }) });
  const narrow = rule({ id: 'R-NARROW', type: 'EVENT', scheduleId: 'S-EVT', scope: scope({ channels: ['MTS'], sessions: ['정규'] }) });

  it('동률 이벤트끼리는 더 구체적인 적용범위가 승자', () => {
    const idx = buildScopeIndex([base, broad, narrow], '2026-07-04');
    const r = resolve(acct, key({ channel: 'MTS', session: '정규' }), [base, broad, narrow], schedules, [], idx, '2026-07-04', []);
    expect(r!.source).toBe('event');
    expect(r!.sourceRuleId).toBe('R-NARROW');   // 세션 한정이 더 구체적
  });
});
