import { it, expect, describe } from 'vitest';
import { classifyNegoExtension } from './negoExtension';
import type { Account, QualifyPolicy, ScopeSelector } from './types';
import type { NegoException } from './resolve';

const acct = (id: string, name: string, asset: number): Account =>
  ({ id, name, grade: 'GOLD', dormantReturned: false, metric6mAsset: asset, metric6mVolume: 0 });
const scope = (over: Partial<ScopeSelector> = {}): ScopeSelector =>
  ({ assetClass: '해외주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [], ...over });
const grant = (accountId: string, over: Partial<NegoException> = {}): NegoException =>
  ({ accountId, scope: scope(), scheduleId: 'S', validFrom: '2026-01-01', validTo: '2026-07-31',
    status: '활성', qualify: '충족', requestId: 'R', requestedBy: 't', requestedAt: '2026-01-01', ...over });
const pol: QualifyPolicy[] = [{ assetClass: '해외주식', metric: '6개월평균자산', threshold: 500_000_000 }];

describe('classifyNegoExtension', () => {
  const accounts = [acct('A', '유지', 800_000_000), acct('B', '탈락', 30_000_000), acct('C', '예외', 10_000_000)];

  it('충족 유지 / 미충족 탈락 / 예외 유지', () => {
    const nego = [grant('A'), grant('B'), grant('C', { qualify: '예외', reason: '영업' })];
    const g = classifyNegoExtension(nego, accounts, pol);
    const byId = Object.fromEntries(g[0].candidates.map((c) => [c.accountId, c.status]));
    expect(byId).toEqual({ A: '유지', B: '탈락', C: '유지' });
    expect(g[0].counts).toEqual({ 유지: 2, 탈락: 1 });
  });

  it('요청/반려 grant는 연장 대상 아님', () => {
    const g = classifyNegoExtension([grant('A', { status: '요청' })], accounts, pol);
    expect(g).toHaveLength(0);
  });

  it('파생은 품목 축', () => {
    const dg = classifyNegoExtension([grant('A', { scope: scope({ assetClass: '해외파생', products: ['6A'] }) })], [acct('A', 'a', 0)], []);
    expect(dg[0].axis).toBe('품목'); expect(dg[0].groupKey).toBe('6A');
  });
});
