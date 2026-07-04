import type { Account, AssetClass, QualifyPolicy } from './types';

// 상품군 표준 자격 정책 대비 계좌의 충족 여부. 정책이 없으면 기준 없음(met=true).
export function qualifyOf(policies: QualifyPolicy[], assetClass: AssetClass, acct: Account): { met: boolean; policy: QualifyPolicy | null } {
  const policy = policies.find((p) => p.assetClass === assetClass) ?? null;
  if (!policy) return { met: true, policy: null };
  const v = policy.metric === '6개월평균자산' ? acct.metric6mAsset : acct.metric6mVolume;
  return { met: v >= policy.threshold, policy };
}
