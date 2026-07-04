import { it, expect, describe } from 'vitest';
import { scopeMatches, isTarget, rebindAccount } from './binding';
import type { ScopeSelector, Product, FeeRule, FeeSchedule, Account, Enrollment } from './types';

const p6A: Product = { assetClass: '해외파생', exchange: 'CME', code: '6A', name: 'AUD', currency: 'USD', sessions: ['주간'] };
const p6E: Product = { assetClass: '해외파생', exchange: 'CME', code: '6E', name: 'EUR', currency: 'USD', sessions: ['주간'] };
const acct: Account = { id: 'A-1', name: '김', grade: 'GOLD', dormantReturned: false, metric6mAsset: 0, metric6mVolume: 0 };

const flatSched = (id: string, flat: number): FeeSchedule =>
  ({ id, name: id, components: [{ name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: flat }] });
const bandSched = (id: string, boundary: number, cheapFlat: number, expFlat: number): FeeSchedule =>
  ({ id, name: id, components: [{ name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '구간표',
    bands: [{ from: 0, to: boundary, flat: cheapFlat }, { from: boundary, to: null, flat: expFlat }] }] });
const rule = (over: Partial<FeeRule>): FeeRule => ({
  id: 'R', name: 'r', type: 'BASE', status: '활성', applyMode: '일괄적용형',
  startDate: '2026-01-01', endDate: '2026-12-31',
  scope: { assetClass: '해외파생', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
  scheduleId: 'S', warnings: { dominance: true, reverseMargin: false }, createdBy: 't', log: [], ...over });

describe('scopeMatches', () => {
  it('제외 리스트가 포함보다 우선', () => {
    const s: ScopeSelector = { assetClass: '해외파생', exchanges: ['CME'], sessions: '*', currencies: '*', products: '*', excludeProducts: ['6E'] };
    expect(scopeMatches(s, p6A)).toBe(true);
    expect(scopeMatches(s, p6E)).toBe(false);
  });
});

describe('isTarget', () => {
  it('신청형은 Enrollment 필요, 일괄적용형은 불필요', () => {
    const evt = rule({ id: 'E1', type: 'EVENT', applyMode: '신청형' });
    expect(isTarget(evt, acct, [])).toBe(false);
    expect(isTarget(evt, acct, [{ accountId: 'A-1', ruleId: 'E1', enrolledAt: '2026-07-01', channel: 'MTS' }])).toBe(true);
    expect(isTarget(rule({ type: 'EVENT', applyMode: '일괄적용형' }), acct, [])).toBe(true);
  });
  it('휴면복귀형은 dormantReturned 계좌만', () => {
    const evt = rule({ type: 'EVENT', applyMode: '휴면복귀형' });
    expect(isTarget(evt, acct, [])).toBe(false);
    expect(isTarget(evt, { ...acct, dormantReturned: true }, [])).toBe(true);
  });
});

describe('rebindAccount', () => {
  const schedules = [flatSched('S-BASE', 50), flatSched('S-EVT', 30)];
  const base = rule({ id: 'R-BASE', scheduleId: 'S-BASE' });
  const evt = rule({ id: 'R-EVT', type: 'EVENT', scheduleId: 'S-EVT' });

  it('최저가 룰이 바인딩으로 선택되고 근거가 남는다', () => {
    const bs = rebindAccount(acct, [base, evt], schedules, [], [p6A], '2026-07-04');
    expect(bs).toHaveLength(1);
    expect(bs[0].scheduleId).toBe('S-EVT');
    expect(bs[0].sourceRuleId).toBe('R-EVT');
    expect(bs[0].scopeKey).toBe('CME:6A');
  });

  it('기간 밖 룰은 후보에서 제외', () => {
    const expired = { ...evt, endDate: '2026-06-30' };
    const bs = rebindAccount(acct, [base, expired], schedules, [], [p6A], '2026-07-04');
    expect(bs[0].scheduleId).toBe('S-BASE');
  });

  it('동률이면 협수 > 이벤트 > 기본', () => {
    const nego = rule({ id: 'R-NEGO', type: 'NEGOTIATED', applyMode: '신청형', scheduleId: 'S-EVT' });
    const enr: Enrollment[] = [{ accountId: 'A-1', ruleId: 'R-NEGO', enrolledAt: '2026-01-02', channel: '지점' }];
    const bs = rebindAccount(acct, [base, evt, nego], schedules, enr, [p6A], '2026-07-04');
    expect(bs[0].sourceRuleId).toBe('R-NEGO');
  });

  it('구간표 경계가 다른 후보끼리는 공동 probe grid로 비교해야 한다', () => {
    // S-A: price<50 → flat10(=100), price>=50 → flat11(=110)
    // S-B: price<50000 → flat9(=90), price>=50000 → flat15(=150)
    // qty=10 이므로 customerTotal = flat*10
    //
    // [버그 있는 사설 그리드] 각자 자기 스케줄의 probePrices(own, own)만으로 평균:
    //   A own grid = {0.01, 1, 49.99, 50.01, 100, 100000} → 저가 3개(0.01,1,49.99) + 고가 3개
    //     평균 = (3*100 + 3*110) / 6 = 105
    //   B own grid = {0.01, 1, 100, 49999.99, 50000.01, 100000} → 저가 4개 + 고가 2개
    //     평균 = (4*90 + 2*150) / 6 = 110
    //   → 버그 코드라면 105 < 110 이므로 A가 승자로 (잘못) 선택됨
    //
    // [공동 grid, 수정 후] union(A own grid, B own grid)
    //   = {0.01, 1, 49.99, 50.01, 49999.99, 50000.01, 100, 100000} (8개)
    //   A: <50 인 점 3개(0.01,1,49.99) + >=50 인 점 5개
    //     평균 = (3*100 + 5*110) / 8 = 106.25
    //   B: <50000 인 점 6개(0.01,1,49.99,50.01,100,49999.99) + >=50000 인 점 2개
    //     평균 = (6*90 + 2*150) / 8 = 105
    //   → 105 < 106.25 이므로 B가 진짜 승자 (버그 있었다면 A가 선택되어 이 테스트가 실패)
    const sA = bandSched('S-A', 50, 10, 11);
    const sB = bandSched('S-B', 50000, 9, 15);
    const rA = rule({ id: 'R-A', scheduleId: 'S-A' });
    const rB = rule({ id: 'R-B', type: 'EVENT', scheduleId: 'S-B' });
    const bs = rebindAccount(acct, [rA, rB], [sA, sB], [], [p6A], '2026-07-04');
    expect(bs[0].scheduleId).toBe('S-B');
    expect(bs[0].sourceRuleId).toBe('R-B');
  });
});
