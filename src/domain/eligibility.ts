import type { Account, FeeRule } from './types';

export function evalCondition(rule: FeeRule, acct: Account): boolean {
  if (!rule.condition) return true;
  const value = rule.condition.metric === '6개월평균자산' ? acct.metric6mAsset : acct.metric6mVolume;
  return value >= rule.condition.threshold;
}
