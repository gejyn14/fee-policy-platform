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

it('submitRule은 매칭 품목 수를 sim.matchedProducts에 기록', () => {
  useStore.getState().submitRule(newRule, newSched); // 기존 픽스처: CME 6A 대상
  expect(useStore.getState().rules.find(x => x.id === 'R-NEW')!.sim!.matchedProducts).toBe(1);
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
    scope: { assetClass: '해외파생', exchanges: ['ZZZ-NONEXISTENT'], sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'S-NEW', warnings: { dominance: true, reverseMargin: false }, createdBy: '담당자', log: [] };
  useStore.getState().submitRule(noMatchRule, newSched);
  const r = useStore.getState().rules.find(x => x.id === 'R-NOMATCH')!;
  expect(r.status).toBe('승인대기');
  expect(r.sim).toEqual({ targets: 0, saving: 0, matchedProducts: 0 });
});

it('wizardDraft는 다른 액션 후에도 유지되고 null로 리셋 가능', () => {
  useStore.getState().setWizardDraft({ form: { name: '작성중' }, step: 3 });
  useStore.getState().rebindAll(); // 무관 액션
  expect(useStore.getState().wizardDraft?.step).toBe(3);
  useStore.getState().setWizardDraft(null);
  expect(useStore.getState().wizardDraft).toBeNull();
});

it('reset()은 wizardDraft도 null로 초기화', () => {
  useStore.getState().setWizardDraft({ form: { name: '작성중' }, step: 2 });
  useStore.getState().reset();
  expect(useStore.getState().wizardDraft).toBeNull();
});

it('초기 상태: 마스터 기반 products (레거시 포함, 대량)', () => {
  const s = useStore.getState();
  expect(s.products.length).toBeGreaterThanOrEqual(2500);
  expect(s.products.some(p => p.exchange === 'NXT' && p.code === '005930')).toBe(true);
  expect(s.products.some(p => p.exchange === 'CME' && p.code === '6A')).toBe(true);
});

it('syncFromLedger: 결정적 유입 + products/bindings 갱신, 소진 시 0', () => {
  const before = useStore.getState().products.length;
  const r1 = useStore.getState().syncFromLedger();
  expect(r1.added).toBeGreaterThan(0);
  expect(useStore.getState().products.length).toBeGreaterThan(before);
  let total = r1.added;
  for (let i = 0; i < 20; i++) total += useStore.getState().syncFromLedger().added;
  expect(useStore.getState().syncFromLedger().added).toBe(0); // 풀 소진
});

it('registerInstruments: 중복 코드 거부', () => {
  const dup = { ...useStore.getState().instruments[0] };
  const r = useStore.getState().registerInstruments([dup]);
  expect(r.accepted).toBe(0);
  expect(r.rejected).toContain(dup.code);
});

it('reset() 이후 bindings는 비어있지 않다 (마스터데이터 변경으로 0건이 되는 회귀 방지)', () => {
  useStore.getState().reset();
  expect(useStore.getState().bindings.length).toBeGreaterThan(0);
});

it('성능: rebindAll이 2초 이내', () => {
  const t0 = performance.now();
  useStore.getState().rebindAll();
  expect(performance.now() - t0).toBeLessThan(2000);
});
