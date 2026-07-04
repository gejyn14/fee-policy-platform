import type { FeeRule } from './types';
export function classifyLifecycle(rule: FeeRule, today: string): 'activate' | 'expire' | 'none' {
  const inWindow = rule.startDate <= today && today <= rule.endDate;
  if (rule.status === '승인대기' && inWindow) return 'activate';
  if (rule.status === '활성' && today > rule.endDate) return 'expire';
  return 'none';
}
