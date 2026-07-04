import { it, expect, beforeEach } from 'vitest';
import { useStore } from './store/useStore';
import { calcFee } from './domain/calc';
import type { FeeRule, FeeSchedule, Execution } from './domain/types';

// README 시연 시나리오의 스토어 레벨 재현:
// ① CME 6A 대상 신규 EVENT 룰 + 요율표 상신
// ② 승인 전: A-1001의 CME:6A 바인딩은 아직 신규 룰이 아님
// ③ 승인 후: 바인딩이 신규 룰로 교체 + calcFee로 수수료 인하 확인
// ④ 반려 케이스: 바인딩 불변

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

it('승인 전: A-1001의 CME:6A 바인딩 출처는 아직 신규 룰이 아니다', () => {
  useStore.getState().submitRule(cheapRule, cheapSchedule);
  const s = useStore.getState();
  const binding = s.bindings.find((b) => b.accountId === 'A-1001' && b.scopeKey === 'CME:6A');
  expect(binding).toBeDefined();
  expect(binding!.sourceRuleId).not.toBe('R-E2E-CHEAP');
});

it('승인 후: 바인딩 출처가 신규 룰로 바뀌고 calcFee 수수료가 인하된다', () => {
  useStore.getState().submitRule(cheapRule, cheapSchedule);

  // 승인 전 수수료 (기존 최저가 룰 기준)
  const before = useStore.getState();
  const beforeBinding = before.bindings.find((b) => b.accountId === 'A-1001' && b.scopeKey === 'CME:6A')!;
  const beforeSchedule = before.schedules.find((sc) => sc.id === beforeBinding.scheduleId)!;
  const product = before.products.find((p) => p.exchange === 'CME' && p.code === '6A')!;
  const exec: Execution = { accountId: 'A-1001', product, session: product.sessions[0], price: 100, qty: 10, notional: 1000 };
  const beforeFee = calcFee(beforeSchedule, exec);

  useStore.getState().approveRule('R-E2E-CHEAP');

  const after = useStore.getState();
  const afterRule = after.rules.find((r) => r.id === 'R-E2E-CHEAP')!;
  expect(afterRule.status).toBe('활성');

  const afterBinding = after.bindings.find((b) => b.accountId === 'A-1001' && b.scopeKey === 'CME:6A')!;
  expect(afterBinding.sourceRuleId).toBe('R-E2E-CHEAP');

  const afterSchedule = after.schedules.find((sc) => sc.id === afterBinding.scheduleId)!;
  const afterFee = calcFee(afterSchedule, exec);

  expect(afterFee.customerTotal).toBeLessThan(beforeFee.customerTotal);
});

it('반려 케이스: 반려된 룰은 바인딩에 영향을 주지 않는다', () => {
  const rejectedRule: FeeRule = { ...cheapRule, id: 'R-E2E-REJECTED', scheduleId: 'S-E2E-REJECTED' };
  const rejectedSchedule: FeeSchedule = { ...cheapSchedule, id: 'S-E2E-REJECTED' };

  useStore.getState().submitRule(rejectedRule, rejectedSchedule);
  const beforeBinding = useStore.getState().bindings
    .find((b) => b.accountId === 'A-1001' && b.scopeKey === 'CME:6A')!;

  useStore.getState().rejectRule('R-E2E-REJECTED', '검토 보류');

  const after = useStore.getState();
  expect(after.rules.find((r) => r.id === 'R-E2E-REJECTED')!.status).toBe('반려');
  const afterBinding = after.bindings.find((b) => b.accountId === 'A-1001' && b.scopeKey === 'CME:6A')!;
  expect(afterBinding.sourceRuleId).not.toBe('R-E2E-REJECTED');
  expect(afterBinding).toEqual(beforeBinding);
});
