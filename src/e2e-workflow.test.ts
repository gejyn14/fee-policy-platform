import { it, expect, beforeEach } from 'vitest';
import { useStore } from './store/useStore';
import { calcFee } from './domain/calc';
import { deriveFeeKey } from './domain/feeKey';
import type { FeeRule, FeeSchedule, Execution } from './domain/types';

// README 시연 시나리오의 스토어 레벨 재현:
// ① CME 6A 대상 신규 EVENT 룰 + 요율표 상신
// ② 승인 전: 110000001001의 CME:6A는 resolveFee가 아직 신규 룰을 가리키지 않음
// ③ 승인 후: resolveFee가 신규 룰로 교체 + calcFee로 수수료 인하 확인
// ④ 반려 케이스: resolveFee 결과 불변

beforeEach(() => useStore.getState().reset());

const cheapSchedule: FeeSchedule = {
  id: 'S-E2E-CHEAP',
  name: '2026 가을 CME 6A 특가 이벤트 요율',
  components: [
    { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: 100 },
  ],
};

const cheapRule: FeeRule = {
  id: 'R-E2E-CHEAP',
  name: '2026 가을 CME 6A 수수료 인하 이벤트',
  type: 'EVENT', status: '기안', applyMode: '일괄적용형',
  startDate: '2026-07-01', endDate: '2026-09-30',
  scope: { assetClass: '해외파생', exchanges: ['CME'], sessions: '*', currencies: '*', products: ['6A'], excludeProducts: [] },
  scheduleId: cheapSchedule.id,
  warnings: { dominance: false, reverseMargin: false },
  createdBy: '마케팅팀-테스트',
  log: [],
};

it('승인 전: 110000001001의 CME:6A resolveFee 출처는 아직 신규 룰이 아니다', () => {
  const s = useStore.getState();
  const cme6a = s.products.find((p) => p.exchange === 'CME' && p.code === '6A')!;
  s.submitRule(cheapRule, cheapSchedule);
  const r = useStore.getState().resolveFee('110000001001', deriveFeeKey(cme6a, '정규', 'HTS'));
  expect(r).toBeDefined();
  expect(r!.sourceRuleId).not.toBe('R-E2E-CHEAP');
});

it('승인 후: resolveFee 출처가 신규 룰로 바뀌고 calcFee 수수료가 인하된다', () => {
  const s = useStore.getState();
  const cme6a = s.products.find((p) => p.exchange === 'CME' && p.code === '6A')!;
  s.submitRule(cheapRule, cheapSchedule);

  // 승인 전 수수료 (기존 최저가 룰 기준)
  const before = useStore.getState().resolveFee('110000001001', deriveFeeKey(cme6a, '정규', 'HTS'))!;
  const beforeSchedule = useStore.getState().schedules.find((sc) => sc.id === before.scheduleId)!;
  const exec: Execution = { accountId: '110000001001', product: cme6a, session: cme6a.sessions[0], price: 100, qty: 10, notional: 1000 };
  const beforeFee = calcFee(beforeSchedule, exec);

  useStore.getState().approveRule('R-E2E-CHEAP');

  const afterRule = useStore.getState().rules.find((r) => r.id === 'R-E2E-CHEAP')!;
  expect(afterRule.status).toBe('활성');

  // approveRule의 캐시 무효화가 안 됐다면 아래 resolveFee가 승인 전 결과를 그대로 반환(stale)한다.
  const after = useStore.getState().resolveFee('110000001001', deriveFeeKey(cme6a, '정규', 'HTS'))!;
  expect(after.sourceRuleId).toBe('R-E2E-CHEAP');

  const afterSchedule = useStore.getState().schedules.find((sc) => sc.id === after.scheduleId)!;
  const afterFee = calcFee(afterSchedule, exec);

  expect(afterFee.customerTotal).toBeLessThan(beforeFee.customerTotal);
});

it('반려 케이스: 반려된 룰은 resolveFee 결과에 영향을 주지 않는다', () => {
  const rejectedRule: FeeRule = { ...cheapRule, id: 'R-E2E-REJECTED', scheduleId: 'S-E2E-REJECTED' };
  const rejectedSchedule: FeeSchedule = { ...cheapSchedule, id: 'S-E2E-REJECTED' };

  const s = useStore.getState();
  const cme6a = s.products.find((p) => p.exchange === 'CME' && p.code === '6A')!;
  s.submitRule(rejectedRule, rejectedSchedule);
  const before = useStore.getState().resolveFee('110000001001', deriveFeeKey(cme6a, '정규', 'HTS'));

  useStore.getState().rejectRule('R-E2E-REJECTED', '검토 보류');

  const after = useStore.getState();
  expect(after.rules.find((r) => r.id === 'R-E2E-REJECTED')!.status).toBe('반려');
  // rejectRule이 캐시/해석 결과를 건드리지 않는 store 불변식 검증
  const afterResolve = useStore.getState().resolveFee('110000001001', deriveFeeKey(cme6a, '정규', 'HTS'));
  expect(afterResolve!.sourceRuleId).not.toBe('R-E2E-REJECTED');
  expect(afterResolve!.scheduleId).toBe(before!.scheduleId);
  expect(afterResolve!.sourceRuleId).toBe(before!.sourceRuleId);
});
