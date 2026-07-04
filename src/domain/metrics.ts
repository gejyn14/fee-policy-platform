import type { Account } from './types';
// 신규 체결 유입을 흉내낸 결정적 +5% 증분 (원 단위 반올림).
export function nudgeMetrics(acct: Account): { metric6mAsset: number; metric6mVolume: number } {
  return {
    metric6mAsset: Math.round(acct.metric6mAsset * 1.05),
    metric6mVolume: Math.round(acct.metric6mVolume * 1.05),
  };
}
