import { it, expect, describe } from 'vitest';
import { scopeMatches, isTarget, isBenefitActive, rebindAccount, explainBinding } from './binding';
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
  id: 'R', name: 'r', type: 'BASE', status: '활성', applyMode: '타겟추출형',
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
  it('신청형은 Enrollment 필요, 타겟추출형은 불필요', () => {
    const evt = rule({ id: 'E1', type: 'EVENT', applyMode: '신청형' });
    expect(isTarget(evt, acct, [])).toBe(false);
    expect(isTarget(evt, acct, [{ accountId: 'A-1', ruleId: 'E1', enrolledAt: '2026-07-01', channel: 'MTS' }])).toBe(true);
    expect(isTarget(rule({ type: 'EVENT', applyMode: '타겟추출형' }), acct, [])).toBe(true);
  });
  it('휴면복귀형은 dormantReturned 계좌만', () => {
    const evt = rule({ type: 'EVENT', applyMode: '휴면복귀형' });
    expect(isTarget(evt, acct, [])).toBe(false);
    expect(isTarget(evt, { ...acct, dormantReturned: true }, [])).toBe(true);
  });
});

describe('isTarget 조건 게이트', () => {
  const acctRich = { ...acct, metric6mAsset: 600_000_000 };
  const negoCond = rule({ id: 'R-COND', type: 'NEGOTIATED', applyMode: '신청형',
    condition: { metric: '6개월평균자산', threshold: 500_000_000, action: '승인후연장' } });
  const enr = [{ accountId: acct.id, ruleId: 'R-COND', enrolledAt: '2026-01-02', channel: '지점' }];

  it('condition 미충족이면 신청했어도 대상 아님', () => {
    expect(isTarget(negoCond, acct, enr)).toBe(false);        // acct.metric6mAsset 0 < 5억
  });
  it('condition 충족 + 신청이면 대상', () => {
    expect(isTarget(negoCond, acctRich, enr)).toBe(true);     // 6억 ≥ 5억
  });
  it('condition 충족이어도 신청 없으면 대상 아님', () => {
    expect(isTarget(negoCond, acctRich, [])).toBe(false);     // 신청+조건 둘 다 필요
  });
  it('condition 없는 룰은 기존 로직 그대로', () => {
    const evt = rule({ id: 'R-NC', type: 'EVENT', applyMode: '타겟추출형' });
    expect(isTarget(evt, acct, [])).toBe(true);
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

describe('explainBinding', () => {
  const schedules = [flatSched('S-BASE', 50), flatSched('S-EVT', 30)];
  const base = rule({ id: 'R-BASE', scheduleId: 'S-BASE' });
  const evt = rule({ id: 'R-EVT', type: 'EVENT', scheduleId: 'S-EVT' });

  it('승자가 rebindAccount 바인딩과 일치하고 candidates가 비용 오름차순', () => {
    const t = explainBinding(acct, p6A, [base, evt], schedules, [], '2026-07-04');
    expect(t.binding!.sourceRuleId).toBe('R-EVT');
    expect(t.candidates.map(c => c.rule.id)).toEqual(['R-EVT', 'R-BASE']);
    expect(t.candidates[0].isWinner).toBe(true);
    expect(t.candidates[1].isWinner).toBe(false);
    expect(t.candidates[0].avgCustomerFee).toBeLessThan(t.candidates[1].avgCustomerFee);
    const bs = rebindAccount(acct, [base, evt], schedules, [], [p6A], '2026-07-04');
    expect(t.binding!.scheduleId).toBe(bs[0].scheduleId);
  });

  it('동률이면 tieBreakApplied=true + 협수 승', () => {
    const nego = rule({ id: 'R-NEGO', type: 'NEGOTIATED', applyMode: '신청형', scheduleId: 'S-EVT' });
    const enr = [{ accountId: acct.id, ruleId: 'R-NEGO', enrolledAt: '2026-01-02', channel: '지점' }];
    const t = explainBinding(acct, p6A, [base, evt, nego], schedules, enr, '2026-07-04');
    expect(t.binding!.sourceRuleId).toBe('R-NEGO');
    expect(t.tieBreakApplied).toBe(true);
  });

  it('rejected에 탈락 사유가 분류됨', () => {
    const expired = rule({ id: 'R-EXP', type: 'EVENT', scheduleId: 'S-EVT', endDate: '2026-06-30' });
    const wrongScope = rule({ id: 'R-6E', type: 'EVENT', scheduleId: 'S-EVT',
      scope: { assetClass: '해외파생', exchanges: '*', sessions: '*', currencies: '*', products: ['6E'], excludeProducts: [] } });
    const notTarget = rule({ id: 'R-APPLY', type: 'EVENT', applyMode: '신청형', scheduleId: 'S-EVT' }); // 신청 없음
    const t = explainBinding(acct, p6A, [base, expired, wrongScope, notTarget], schedules, [], '2026-07-04');
    const reason = (id: string) => t.rejected.find(r => r.rule.id === id)?.reason;
    expect(reason('R-EXP')).toBe('기간 밖');
    expect(reason('R-6E')).toBe('범위 불일치');
    expect(reason('R-APPLY')).toBe('대상 아님');
    expect(t.candidates.map(c => c.rule.id)).toEqual(['R-BASE']);
  });

  it('같은 유형끼리 cost 동률이면 tieBreakApplied=false (tie-break 미작동)', () => {
    // 두 EVENT가 같은 요율표(S-EVT)로 cost 동률 → 승자는 배열 순서로 결정, TIE_ORDER는 no-op
    const evt2 = rule({ id: 'R-EVT2', type: 'EVENT', scheduleId: 'S-EVT' });
    const t = explainBinding(acct, p6A, [evt, evt2], schedules, [], '2026-07-04');
    expect(t.candidates[0].avgCustomerFee).toBe(t.candidates[1].avgCustomerFee);
    expect(t.tieBreakApplied).toBe(false);
  });

  it('후보 0건이면 binding null', () => {
    const t = explainBinding(acct, p6A, [], schedules, [], '2026-07-04');
    expect(t.binding).toBeNull();
    expect(t.candidates).toEqual([]);
  });
});

describe('isBenefitActive', () => {
  const a: Account = { id: '110000001001', name: '김', grade: 'GOLD', dormantReturned: false, metric6mAsset: 0, metric6mVolume: 0 };
  const mk = (over: Partial<FeeRule>): FeeRule => ({
    id: 'R', name: 'r', type: 'EVENT', status: '활성', applyMode: '가입형',
    startDate: '2026-04-01', endDate: '2026-06-30', scope: {
      assetClass: '국내주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [],
    }, scheduleId: 'S', warnings: { dominance: true, reverseMargin: false }, createdBy: 't', log: [], ...over });

  it('캘린더: 창 안이면 true', () => {
    expect(isBenefitActive(mk({ endDate: '2026-12-31' }), a, [], '2026-07-04')).toBe(true);
  });
  it('캘린더: 창 밖이면 false', () => {
    expect(isBenefitActive(mk({ endDate: '2026-06-30' }), a, [], '2026-07-04')).toBe(false);
  });
  it('상대: 가입일+N 안이면 true', () => {
    const enr: Enrollment[] = [{ accountId: a.id, ruleId: 'R', enrolledAt: '2026-06-20', channel: 'MTS' }];
    expect(isBenefitActive(mk({ benefit: { kind: '상대', months: 2 } }), a, enr, '2026-07-04')).toBe(true);
  });
  it('상대: 신청 마감 지나도 가입일+N 안이면 true', () => {
    const enr: Enrollment[] = [{ accountId: a.id, ruleId: 'R', enrolledAt: '2026-06-20', channel: 'MTS' }];
    expect(isBenefitActive(mk({ benefit: { kind: '상대', months: 2 }, endDate: '2026-06-30' }), a, enr, '2026-07-04')).toBe(true);
  });
  it('상대: 가입일+N 지나면 false', () => {
    const enr: Enrollment[] = [{ accountId: a.id, ruleId: 'R', enrolledAt: '2026-04-10', channel: 'MTS' }];
    expect(isBenefitActive(mk({ benefit: { kind: '상대', months: 2 } }), a, enr, '2026-07-04')).toBe(false);
  });
  it('상대: 가입 이력 없으면 false', () => {
    expect(isBenefitActive(mk({ benefit: { kind: '상대', months: 2 } }), a, [], '2026-07-04')).toBe(false);
  });
});
