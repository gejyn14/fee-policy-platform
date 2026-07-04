import { it, expect, describe } from 'vitest';
import { classifyLifecycle } from './lifecycle';
import type { FeeRule } from './types';
const r = (over: Partial<FeeRule>): FeeRule => ({ id: 'R', name: 'r', type: 'EVENT', status: '활성', applyMode: '타겟추출형',
  startDate: '2026-01-01', endDate: '2026-12-31', scope: { assetClass: '국내주식', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
  scheduleId: 'S', warnings: { dominance: true, reverseMargin: false }, createdBy: 't', log: [], ...over });

describe('classifyLifecycle (today=2026-07-04)', () => {
  it('승인대기 + window 안이면 activate', () => {
    expect(classifyLifecycle(r({ status: '승인대기', startDate: '2026-07-01', endDate: '2026-12-31' }), '2026-07-04')).toBe('activate');
  });
  it('활성 + endDate 지났으면 expire', () => {
    expect(classifyLifecycle(r({ status: '활성', endDate: '2026-06-30' }), '2026-07-04')).toBe('expire');
  });
  it('활성 + window 안이면 none', () => {
    expect(classifyLifecycle(r({ status: '활성' }), '2026-07-04')).toBe('none');
  });
  it('승인대기 + 미래 시작이면 none', () => {
    expect(classifyLifecycle(r({ status: '승인대기', startDate: '2026-08-01' }), '2026-07-04')).toBe('none');
  });
});
