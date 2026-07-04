import { it, expect, describe } from 'vitest';
import { qualifyOf } from './qualify';
import type { Account, QualifyPolicy } from './types';

const acct = (asset: number, vol = 0): Account =>
  ({ id: 'A', name: 'a', grade: 'GOLD', dormantReturned: false, metric6mAsset: asset, metric6mVolume: vol });
const pol: QualifyPolicy[] = [{ assetClass: '해외주식', metric: '6개월평균자산', threshold: 500_000_000 }];

describe('qualifyOf', () => {
  it('충족', () => { expect(qualifyOf(pol, '해외주식', acct(600_000_000)).met).toBe(true); });
  it('미충족', () => { expect(qualifyOf(pol, '해외주식', acct(400_000_000)).met).toBe(false); });
  it('정책 없으면 기준 없음 → met true, policy null', () => {
    const r = qualifyOf(pol, '국내주식', acct(0));
    expect(r.met).toBe(true); expect(r.policy).toBeNull();
  });
});
