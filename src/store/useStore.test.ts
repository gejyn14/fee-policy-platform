import { it, expect, beforeEach, describe } from 'vitest';
import { useStore, evalCondition } from './useStore';
import { deriveFeeKey } from '../domain/feeKey';
import type { FeeRule, FeeSchedule, Product } from '../domain/types';

beforeEach(() => useStore.getState().reset());

const newSched: FeeSchedule = { id: 'S-NEW', name: '테스트 이벤트 요율', components: [
  { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: 1 }] };
const newRule: FeeRule = {
  id: 'R-NEW', name: '6A 수수료 인하 이벤트', type: 'EVENT', status: '기안', applyMode: '타겟추출형',
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

it('approveRule → 활성 + resolveFee가 신규 이벤트 요율 반영', () => {
  const s = useStore.getState();
  const cme6a = s.products.find(p => p.exchange === 'CME' && p.code === '6A')!;
  s.submitRule(newRule, newSched);
  s.approveRule('R-NEW');
  const r = useStore.getState().resolveFee('110000001001', deriveFeeKey(cme6a, '정규', 'HTS'));
  expect(r!.sourceRuleId).toBe('R-NEW');   // 정액 1원이라 최저가
});

it('rejectRule → 반려, resolveFee 영향 없음', () => {
  const s = useStore.getState();
  const cme6a = s.products.find(p => p.exchange === 'CME' && p.code === '6A')!;
  s.submitRule(newRule, newSched);
  s.rejectRule('R-NEW', '기간 조정 필요');
  const rules = useStore.getState().rules;
  expect(rules.find(x => x.id === 'R-NEW')!.status).toBe('반려');
  const r = useStore.getState().resolveFee('110000001001', deriveFeeKey(cme6a, '정규', 'HTS'));
  expect(r!.sourceRuleId).not.toBe('R-NEW');
});

it('evalCondition: 6개월평균자산 임계값 판정', () => {
  const acct = useStore.getState().accounts[0]; // metric6mAsset: 850,000,000
  const nego = { ...newRule, type: 'NEGOTIATED' as const,
    condition: { metric: '6개월평균자산' as const, threshold: 500_000_000, action: '승인후연장' as const } };
  expect(evalCondition(nego, acct)).toBe(true);
  expect(evalCondition({ ...nego, condition: { ...nego.condition!, threshold: 1_000_000_000 } }, acct)).toBe(false);
});


it('submitRule with zero matching products → 승인대기 + sim { targets: 0, saving: 0 }', () => {
  const noMatchRule: FeeRule = {
    id: 'R-NOMATCH', name: '0건 대상 규칙', type: 'EVENT', status: '기안', applyMode: '타겟추출형',
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
  useStore.getState().cacheStat(); // 무관 액션
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

it('syncFromLedger: 결정적 유입 + products 갱신, 소진 시 0', () => {
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

  it('⑤ batchReresolve: 계좌 수만큼 재해석 결과 반환, summary에 재해석 표기', () => {
    const s = useStore.getState();
    const res = s.batchReresolve();
    expect(res.changes.length).toBe(s.accounts.length);
    expect(res.summary).toContain('재해석');
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
    const r = useStore.getState().resolveFee('110000001001', deriveFeeKey(usStock, '정규', 'MTS'));
    expect(r!.source).toBe('nego');
    expect(r!.scheduleId).toBe('FS-NEGO-STOCK-US');
    expect(r!.cacheHit).toBe(false);
  });
  it('두 번째 조회는 캐시 적중', () => {
    const s = useStore.getState();
    s.resolveFee('110000001001', deriveFeeKey(usStock, '정규', 'MTS'));
    const r2 = s.resolveFee('110000001001', deriveFeeKey(usStock, '정규', 'MTS'));
    expect(r2!.cacheHit).toBe(true);
    expect(useStore.getState().cacheStat().hits).toBeGreaterThanOrEqual(1);
  });
  it('A-1002(협의 grant 없음)는 해외주식이 base로 해석', () => {
    const r = useStore.getState().resolveFee('110000001002', deriveFeeKey(usStock, '정규', 'MTS'));
    expect(r!.source).toBe('base');
  });
  it('상대형 이벤트: 가입일+2개월 안의 계좌만 무료요율로 해석', () => {
    const s = useStore.getState();
    const krStock = s.products.find(p => p.assetClass === '국내주식' && p.exchange === 'KRX')!;
    const k = deriveFeeKey(krStock, '정규', 'MTS');
    const valid = s.resolveFee('110000001001', k)!;   // 2026-06-20 가입 → 유효
    const expired = s.resolveFee('110000001004', k)!; // 2026-04-10 가입 → 만료
    expect(valid.sourceRuleId).toBe('RULE-EVENT-STOCK-SIGNUP2M');
    expect(expired.sourceRuleId).not.toBe('RULE-EVENT-STOCK-SIGNUP2M');
  });
});

describe('협의수수료 연장 리뷰/적용', () => {
  beforeEach(() => useStore.getState().reset());

  it('리뷰: 해외주식 그룹에서 001 유지·003 탈락(자산 3천만)', () => {
    const groups = useStore.getState().reviewNegoExtension();
    const stockG = groups.find(g => g.groupKey === '해외주식')!;
    const byId = Object.fromEntries(stockG.candidates.map(c => [c.accountId, c.status]));
    expect(byId['110000001001']).toBe('유지');
    expect(byId['110000001003']).toBe('탈락');
  });

  it('파생 협의는 품목(6A) 축', () => {
    const groups = useStore.getState().reviewNegoExtension();
    expect(groups.some(g => g.axis === '품목' && g.groupKey === '6A')).toBe(true);
  });

  it('일괄 승인: 탈락(003) 협의 해지, 유지(001) 활성 유지', () => {
    useStore.getState().applyNegoExtension();
    const nego = useStore.getState().nego;
    const active = (id: string) => nego.some(n => n.accountId === id && n.scheduleId === 'FS-NEGO-STOCK-US' && n.status === '활성');
    expect(active('110000001003')).toBe(false); // 탈락 → 반려
    expect(active('110000001001')).toBe(true);  // 유지
  });
});

describe('협의 신청·승인', () => {
  beforeEach(() => useStore.getState().reset());
  const usScope = { assetClass: '해외주식' as const, exchanges: '*' as const, sessions: '*' as const, channels: '*' as const, currencies: '*' as const, products: '*' as const, excludeProducts: [] };

  it('신청 → 요청 grant 생성, 승인 → 활성화', () => {
    const s = useStore.getState();
    const { requestId, requested } = s.submitNegoRequest({ accountIds: ['110000001004'], scope: usScope, scheduleId: 'FS-NEGO-STOCK-US', bypass: {}, requestedBy: 'PB' });
    expect(requested).toBe(1);
    expect(useStore.getState().nego.some(n => n.requestId === requestId && n.status === '요청')).toBe(true);
    useStore.getState().approveNegoRequest(requestId);
    expect(useStore.getState().nego.some(n => n.requestId === requestId && n.status === '활성' && !!n.approvedAt)).toBe(true);
  });

  it('미충족 계좌는 bypass 사유로 예외 요청', () => {
    const s = useStore.getState();
    const { requestId } = s.submitNegoRequest({ accountIds: ['110000001002'], scope: usScope, scheduleId: 'FS-NEGO-STOCK-US', bypass: { '110000001002': '영업 필요' }, requestedBy: 'PB' });
    const g = useStore.getState().nego.find(n => n.requestId === requestId)!;
    expect(g.qualify).toBe('예외'); expect(g.reason).toBe('영업 필요');
  });

  it('자격 판정: 001 충족, 003 미충족', () => {
    const s = useStore.getState();
    expect(s.qualifyStatus('해외주식', '110000001001').met).toBe(true);
    expect(s.qualifyStatus('해외주식', '110000001003').met).toBe(false);
  });

  it('반려', () => {
    const s = useStore.getState();
    const { requestId } = s.submitNegoRequest({ accountIds: ['110000001004'], scope: usScope, scheduleId: 'FS-NEGO-STOCK-US', bypass: {}, requestedBy: 'PB' });
    s.rejectNegoRequest(requestId, '검토 보류');
    expect(useStore.getState().nego.some(n => n.requestId === requestId && n.status === '반려')).toBe(true);
  });
});

describe('정책 우선순위 사전 산정', () => {
  beforeEach(() => useStore.getState().reset());

  it('계좌 무관 winnerFor가 오버레이 없는 계좌의 resolve 승자와 일치', () => {
    const s = useStore.getState();
    const idx = s.policyPriority();
    // 국내주식(협의·가입 없음) → base
    const krStock = s.products.find(p => p.assetClass === '국내주식' && p.exchange === 'KRX')!;
    const kKr = deriveFeeKey(krStock, '정규', 'MTS');
    expect(idx.winnerFor(kKr)!.scheduleId).toBe(s.resolveFee('110000001003', kKr)!.scheduleId);
    // 해외파생 CME 6A: 002는 grant 없음 → 타겟추출형 CME 이벤트가 승자
    const cme6a = s.products.find(p => p.exchange === 'CME' && p.code === '6A')!;
    const kCme = deriveFeeKey(cme6a, '정규', 'HTS');
    const w = idx.winnerFor(kCme)!;
    expect(w.ruleId).toBe('RULE-EVENT-CME-SUMMER');
    expect(w.scheduleId).toBe(s.resolveFee('110000001002', kCme)!.scheduleId);
  });

  it('순위는 rank 오름차순', () => {
    const pol = useStore.getState().policyPriority().policies;
    for (let i = 1; i < pol.length; i++) expect(pol[i].rank).toBeGreaterThanOrEqual(pol[i - 1].rank);
  });
});
