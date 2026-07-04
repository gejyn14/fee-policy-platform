import type { RuleType } from '../domain/types';

export const ruleTypeLabel = (t: RuleType): string =>
  t === 'BASE' ? '기본(BASE)' : t === 'EVENT' ? '이벤트(EVENT)' : '협의수수료(NEGOTIATED)';
