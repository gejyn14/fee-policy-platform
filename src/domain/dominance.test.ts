import { it, expect } from 'vitest';
import { dominates, probePrices } from './dominance';
import type { FeeSchedule, Execution, Product } from './types';

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
