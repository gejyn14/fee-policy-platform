import { it, expect, describe } from 'vitest';
import { classifyNegoExtension } from './negoExtension';
import type { Account, Enrollment, FeeRule, ScopeSelector } from './types';

const acct = (id: string, name: string, asset: number): Account =>
  ({ id, name, grade: 'GOLD', dormantReturned: false, metric6mAsset: asset, metric6mVolume: 0 });
const scope = (over: Partial<ScopeSelector> = {}): ScopeSelector =>
  ({ assetClass: '해외주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [], ...over });
const negoRule = (over: Partial<FeeRule> = {}): FeeRule => ({
  id: 'R-NEGO', name: '해외주식 협의', type: 'NEGOTIATED', status: '활성', applyMode: '신청형',
  startDate: '2026-01-01', endDate: '2026-12-31', scope: scope(), scheduleId: 'S-NEGO',
  condition: { metric: '6개월평균자산', threshold: 500_000_000, action: '승인후연장' },
  warnings: { dominance: true, reverseMargin: false }, createdBy: 't', log: [], ...over });

const enr = (accountId: string, ruleId = 'R-NEGO'): Enrollment => ({ accountId, ruleId, enrolledAt: '2026-01-02', channel: '지점' });

describe('classifyNegoExtension', () => {
  const accounts = [acct('A', '유지', 800_000_000), acct('B', '신규', 900_000_000), acct('C', '탈락', 30_000_000)];

  it('신규/유지/탈락 분류', () => {
    const enrollments = [enr('A'), enr('B'), enr('C')];
    const nego = [{ accountId: 'A', scheduleId: 'S-NEGO' }, { accountId: 'C', scheduleId: 'S-NEGO' }];
    const g = classifyNegoExtension([negoRule()], accounts, enrollments, nego, '2026-07-04');
    expect(g).toHaveLength(1);
    const byId = Object.fromEntries(g[0].candidates.map((c) => [c.accountId, c.status]));
    expect(byId).toEqual({ A: '유지', B: '신규', C: '탈락' });
    expect(g[0].counts).toEqual({ 신규: 1, 유지: 1, 탈락: 1 });
  });

  it('주식형은 상품군 축', () => {
    const g = classifyNegoExtension([negoRule()], accounts, [enr('A')], [{ accountId: 'A', scheduleId: 'S-NEGO' }], '2026-07-04');
    expect(g[0].axis).toBe('상품군');
    expect(g[0].groupKey).toBe('해외주식');
  });

  it('파생은 품목 축', () => {
    const deriv = negoRule({ id: 'R-D', scheduleId: 'S-D', scope: scope({ assetClass: '해외파생', products: ['6A'] }) });
    const g = classifyNegoExtension([deriv], accounts, [enr('A', 'R-D')], [{ accountId: 'A', scheduleId: 'S-D' }], '2026-07-04');
    expect(g[0].axis).toBe('품목');
    expect(g[0].groupKey).toBe('6A');
  });

  it('신청만 있고 미충족·미보유면 대상 아님', () => {
    const g = classifyNegoExtension([negoRule()], [acct('D', '미충족', 10_000_000)], [enr('D')], [], '2026-07-04');
    expect(g).toHaveLength(0);
  });
});
