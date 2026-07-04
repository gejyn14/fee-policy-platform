import { it, expect, describe } from 'vitest';
import { nudgeMetrics } from './metrics';
import type { Account } from './types';
const a = (asset: number): Account => ({ id: 'A', name: 'a', grade: 'GOLD', dormantReturned: false, metric6mAsset: asset, metric6mVolume: asset * 2 });

describe('nudgeMetrics', () => {
  it('결정적: 같은 입력 같은 출력', () => {
    expect(nudgeMetrics(a(490_000_000))).toEqual(nudgeMetrics(a(490_000_000)));
  });
  it('증가하며 4.9억을 5억 위로 넘긴다(캐스케이드 트리거)', () => {
    const r = nudgeMetrics(a(490_000_000));
    expect(r.metric6mAsset).toBeGreaterThan(500_000_000);
    expect(r.metric6mAsset).toBeGreaterThan(490_000_000);
  });
});
