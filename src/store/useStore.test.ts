import { it, expect, beforeEach, describe } from 'vitest';
import { useStore, evalCondition } from './useStore';
import type { FeeRule, FeeSchedule, Product } from '../domain/types';

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
  const b = s.bindings.find(x => x.scopeKey === 'CME:6A' && x.accountId === '110000001001');
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

describe('배치 잡', () => {
  beforeEach(() => useStore.getState().reset());

  it('① 발효/만료: 승인대기→활성, 만료 활성→종료', () => {
    const res = useStore.getState().batchActivateExpireRules();
    const rules = useStore.getState().rules;
    expect(rules.find(r => r.id === 'RULE-EVENT-KR-PROMO')!.status).toBe('활성');
    expect(rules.find(r => r.id === 'RULE-EVENT-KR-SPRING')!.status).toBe('종료');
    expect(res.summary).toContain('발효');
  });

  it('② 지표 재산정: 110000001002 자산이 5억을 넘는다', () => {
    useStore.getState().batchRecomputeMetrics();
    const a = useStore.getState().accounts.find(x => x.id === '110000001002')!;
    expect(a.metric6mAsset).toBeGreaterThan(500_000_000);
  });

  it('④ 협수 조건 평가가 load-bearing: 충족 계좌는 자동 연장(endDate↑), 미충족 계좌는 해지 후보', () => {
    // reset 직후: 110000001001 8.5억(충족), 110000001002 4.9억(미충족). ② 없이 ④만 실행해 ④의 고유 효과를 검증.
    const s = useStore.getState();
    const beforeEnd = s.rules.find(r => r.id === 'RULE-NEGO-STOCK-US')!.endDate;
    const res = s.batchEvalNegotiations();
    const afterEnd = useStore.getState().rules.find(r => r.id === 'RULE-NEGO-STOCK-US')!.endDate;
    expect(afterEnd > beforeEnd).toBe(true);                                                      // 충족 계좌 존재 → 자동 연장
    expect(res.changes.some(c => c.detail.includes('미충족'))).toBe(true);                         // 110000001002 해지 후보
    expect(res.changes.some(c => c.detail.includes('충족') && !c.detail.includes('미충족'))).toBe(true); // 110000001001 자격 유지
  });

  it('④+⑤ 캐스케이드: 지표 재산정 후 110000001002가 해외주식 협수 자격을 얻어 바인딩에 반영', () => {
    const s = useStore.getState();
    s.batchRecomputeMetrics();     // 110000001002 → 5.145억
    s.batchEvalNegotiations();     // 조건 충족 → 자격/연장
    s.batchRebind();               // 수렴
    const b = useStore.getState().bindings.find(x => x.accountId === '110000001002' && x.scheduleId === 'FS-NEGO-STOCK-US');
    expect(b).toBeTruthy();
  });

  it('⑤ batchRebind는 before/after 변경 건수를 델타로 반환', () => {
    const s = useStore.getState();
    s.batchRecomputeMetrics(); s.batchEvalNegotiations();
    const res = s.batchRebind();
    expect(res.changes.length).toBeGreaterThan(0);
  });

  it('⑥ 지배관계 재검증: 위반 없으면 summary에 위반 0', () => {
    const res = useStore.getState().batchRevalidateDominance();
    expect(res.summary).toMatch(/위반\s*0|이상\s*없/);
  });
});

const usStock: Product = { assetClass: '해외주식', exchange: 'NASDAQ', code: 'AAPL', name: '애플', currency: 'USD', sessions: ['정규'] };

describe('resolveFee + 캐시', () => {
  beforeEach(() => useStore.getState().reset());

  it('A-1001(협의 grant 보유)은 해외주식이 nego로 해석', () => {
    const r = useStore.getState().resolveFee('110000001001', usStock, '정규', 'MTS');
    expect(r!.source).toBe('nego');
    expect(r!.scheduleId).toBe('FS-NEGO-STOCK-US');
    expect(r!.cacheHit).toBe(false);
  });
  it('두 번째 조회는 캐시 적중', () => {
    const s = useStore.getState();
    s.resolveFee('110000001001', usStock, '정규', 'MTS');
    const r2 = s.resolveFee('110000001001', usStock, '정규', 'MTS');
    expect(r2!.cacheHit).toBe(true);
    expect(useStore.getState().cacheStat().hits).toBeGreaterThanOrEqual(1);
  });
  it('A-1002(협의 grant 없음)는 해외주식이 base로 해석', () => {
    const r = useStore.getState().resolveFee('110000001002', usStock, '정규', 'MTS');
    expect(r!.source).toBe('base');
  });
});
