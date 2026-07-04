import { it, expect, describe } from 'vitest';
import { dominates, probePrices, explainDominanceFailure, revalidateDominance } from './dominance';
import type { FeeSchedule, Execution, Product, FeeRule } from './types';

const opt: Product = { assetClass: '국내파생', exchange: 'KRX', code: 'K200OPT', name: 'KOSPI200옵션', currency: 'KRW', sessions: ['정규'] };
const sample = (price: number): Execution =>
  ({ accountId: 'A-1', product: opt, session: '정규', price, qty: 10, notional: price * 10 });
const sched = (bands: { from: number; to: number | null; flat: number }[]): FeeSchedule =>
  ({ id: 'x', name: 'x', components: [{ name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '구간표', bands }] });

it('전 구간에서 싸면 지배 성립', () => {
  const base = sched([{ from: 0, to: 3, flat: 10 }, { from: 3, to: null, flat: 50 }]);
  const event = sched([{ from: 0, to: 3, flat: 5 }, { from: 3, to: null, flat: 30 }]);
  expect(dominates(event, base, sample)).toBe(true);
});

it('구간 교차(저가는 싸고 고가는 비쌈)면 지배 불성립', () => {
  const base = sched([{ from: 0, to: 3, flat: 10 }, { from: 3, to: null, flat: 50 }]);
  const cross = sched([{ from: 0, to: 3, flat: 5 }, { from: 3, to: null, flat: 80 }]);
  expect(dominates(cross, base, sample)).toBe(false);
});

it('probePrices는 양쪽 구간 경계를 모두 포함', () => {
  const a = sched([{ from: 0, to: 3, flat: 1 }, { from: 3, to: null, flat: 2 }]);
  const b = sched([{ from: 0, to: 7, flat: 1 }, { from: 7, to: null, flat: 2 }]);
  const ps = probePrices(a, b);
  expect(ps.some(p => p > 3 && p < 7)).toBe(true);  // 3~7 사이 표본 존재
  expect(ps.some(p => p > 7)).toBe(true);            // 7 초과 표본 존재
});

it('교차 구간에서 최대 역전 지점을 반환', () => {
  const base = sched([{ from: 0, to: 3, flat: 10 }, { from: 3, to: null, flat: 50 }]);
  const cross = sched([{ from: 0, to: 3, flat: 5 }, { from: 3, to: null, flat: 80 }]);
  const f = explainDominanceFailure(cross, base, sample)!;
  expect(f).not.toBeNull();
  expect(f.candidateFee).toBeGreaterThan(f.incumbentFee);
  expect(f.price).toBeGreaterThanOrEqual(3); // 역전은 상위 구간에서만 발생
});

it('전 구간 지배 성립이면 null', () => {
  const base = sched([{ from: 0, to: 3, flat: 10 }, { from: 3, to: null, flat: 50 }]);
  const event = sched([{ from: 0, to: 3, flat: 5 }, { from: 3, to: null, flat: 30 }]);
  expect(explainDominanceFailure(event, base, sample)).toBeNull();
});

const flatSched = (id: string, flat: number): FeeSchedule =>
  ({ id, name: id, components: [{ name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '구간표', bands: [{ from: 0, to: null, flat }] }] });

const rule = (over: Partial<FeeRule>): FeeRule => ({
  id: 'R', name: 'r', type: 'EVENT', status: '활성', applyMode: '타겟추출형',
  startDate: '2026-01-01', endDate: '2026-12-31',
  scope: { assetClass: '국내주식', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
  scheduleId: 'S', warnings: { dominance: true, reverseMargin: false }, createdBy: 't', log: [], ...over,
});

describe('revalidateDominance (today=2026-07-04)', () => {
  it('활성 EVENT가 같은 상품군 BASE보다 싸면 ok=true, BASE는 결과에서 제외', () => {
    const base = rule({ id: 'BASE-1', type: 'BASE', scheduleId: 'base-sched' });
    const event = rule({ id: 'EVENT-1', type: 'EVENT', scheduleId: 'event-sched' });
    const schedules = [flatSched('base-sched', 100), flatSched('event-sched', 50)];
    const result = revalidateDominance([base, event], schedules, '2026-07-04');
    expect(result.length).toBe(1);
    expect(result[0].rule.id).toBe('EVENT-1');
    expect(result[0].ok).toBe(true);
  });

  it('EVENT가 BASE보다 비싼 구간이 있으면 ok=false', () => {
    const base = rule({ id: 'BASE-1', type: 'BASE', scheduleId: 'base-sched' });
    const event = rule({ id: 'EVENT-1', type: 'EVENT', scheduleId: 'event-sched' });
    const schedules = [flatSched('base-sched', 100), flatSched('event-sched', 200)];
    const result = revalidateDominance([base, event], schedules, '2026-07-04');
    expect(result.length).toBe(1);
    expect(result[0].rule.id).toBe('EVENT-1');
    expect(result[0].ok).toBe(false);
  });

  it('비교할 BASE가 없는 상품군의 EVENT는 결과에서 제외', () => {
    const event = rule({ id: 'EVENT-1', type: 'EVENT', scheduleId: 'event-sched' });
    const schedules = [flatSched('event-sched', 50)];
    const result = revalidateDominance([event], schedules, '2026-07-04');
    expect(result.length).toBe(0);
  });
});
