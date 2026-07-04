import { it, expect, beforeEach } from 'vitest';
import { useStore, evalCondition } from './useStore';
import type { FeeRule, FeeSchedule } from '../domain/types';

beforeEach(() => useStore.getState().reset());

const newSched: FeeSchedule = { id: 'S-NEW', name: '테스트 이벤트 요율', components: [
  { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: 1 }] };
const newRule: FeeRule = {
  id: 'R-NEW', name: '6A 수수료 인하 이벤트', type: 'EVENT', status: '기안', applyMode: '일괄적용형',
  startDate: '2026-07-01', endDate: '2026-09-30',
  scope: { assetClass: '해외파생', exchanges: ['CME'], sessions: '*', currencies: '*', products: ['6A'], excludeProducts: [] },
  scheduleId: 'S-NEW', warnings: { dominance: true, reverseMargin: false }, createdBy: '담당자', log: [] };

it('submitRule → 승인대기 + 시뮬레이션 결과 기록', () => {
  useStore.getState().submitRule(newRule, newSched);
  const r = useStore.getState().rules.find(x => x.id === 'R-NEW')!;
  expect(r.status).toBe('승인대기');
  expect(r.sim!.targets).toBeGreaterThan(0);
});

it('approveRule → 활성 + 바인딩 재생성으로 이벤트 요율 반영', () => {
  useStore.getState().submitRule(newRule, newSched);
  useStore.getState().approveRule('R-NEW');
  const s = useStore.getState();
  expect(s.rules.find(x => x.id === 'R-NEW')!.status).toBe('활성');
  const b = s.bindings.find(x => x.scopeKey === 'CME:6A' && x.accountId === 'A-1001');
  expect(b!.sourceRuleId).toBe('R-NEW');   // 정액 1원이라 항상 최저가
});

it('rejectRule → 반려, 바인딩 영향 없음', () => {
  useStore.getState().submitRule(newRule, newSched);
  useStore.getState().rejectRule('R-NEW', '기간 조정 필요');
  const s = useStore.getState();
  expect(s.rules.find(x => x.id === 'R-NEW')!.status).toBe('반려');
  expect(s.bindings.every(b => b.sourceRuleId !== 'R-NEW')).toBe(true);
});

it('evalCondition: 6개월평균자산 임계값 판정', () => {
  const acct = useStore.getState().accounts[0]; // metric6mAsset: 850,000,000
  const nego = { ...newRule, type: 'NEGOTIATED' as const,
    condition: { metric: '6개월평균자산' as const, threshold: 500_000_000, action: '승인후연장' as const } };
  expect(evalCondition(nego, acct)).toBe(true);
  expect(evalCondition({ ...nego, condition: { ...nego.condition!, threshold: 1_000_000_000 } }, acct)).toBe(false);
});

it('extendNegotiated → 기간 연장 + log', () => {
  const nego = useStore.getState().rules.find(r => r.type === 'NEGOTIATED')!;
  useStore.getState().extendNegotiated(nego.id, '2027-06-30');
  const r = useStore.getState().rules.find(x => x.id === nego.id)!;
  expect(r.endDate).toBe('2027-06-30');
  expect(r.log.at(-1)).toContain('연장');
});

it('submitRule with zero matching products → 승인대기 + sim { targets: 0, saving: 0 }', () => {
  const noMatchRule: FeeRule = {
    id: 'R-NOMATCH', name: '0건 대상 규칙', type: 'EVENT', status: '기안', applyMode: '일괄적용형',
    startDate: '2026-07-01', endDate: '2026-09-30',
    scope: { assetClass: '해외파생', exchanges: ['EUREX'], sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'S-NEW', warnings: { dominance: true, reverseMargin: false }, createdBy: '담당자', log: [] };
  useStore.getState().submitRule(noMatchRule, newSched);
  const r = useStore.getState().rules.find(x => x.id === 'R-NOMATCH')!;
  expect(r.status).toBe('승인대기');
  expect(r.sim).toEqual({ targets: 0, saving: 0 });
});
