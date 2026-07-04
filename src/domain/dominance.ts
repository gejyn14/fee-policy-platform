import type { FeeSchedule, Execution, FeeRule, Product } from './types';
import { calcFee } from './calc';

/** 두 요율표의 모든 구간 경계 주변 + 기본 표본가로 검사 가격 목록 생성 */
export function probePrices(a: FeeSchedule, b: FeeSchedule): number[] {
  const pts = new Set<number>([1, 100, 100_000]);
  for (const s of [a, b])
    for (const c of s.components)
      for (const band of c.bands ?? []) {
        pts.add(band.from + 0.01);
        if (band.to !== null) pts.add(Math.max(band.from + 0.01, band.to - 0.01));
      }
  return [...pts].sort((x, y) => x - y);
}

/** candidate가 모든 검사 가격에서 incumbent 이하인가 (등록 시점 지배관계 검증) */
export function dominates(
  candidate: FeeSchedule, incumbent: FeeSchedule,
  sampleExec: (price: number) => Execution,
): boolean {
  return probePrices(candidate, incumbent).every(
    (p) => calcFee(candidate, sampleExec(p)).customerTotal <= calcFee(incumbent, sampleExec(p)).customerTotal,
  );
}

export interface DominanceFailure { price: number; candidateFee: number; incumbentFee: number }

/** candidate가 incumbent보다 비싼 지점 중 차액 최대 지점. 지배 성립이면 null */
export function explainDominanceFailure(
  candidate: FeeSchedule, incumbent: FeeSchedule,
  sampleExec: (price: number) => Execution,
): DominanceFailure | null {
  let worst: DominanceFailure | null = null;
  for (const price of probePrices(candidate, incumbent)) {
    const c = calcFee(candidate, sampleExec(price)).customerTotal;
    const i = calcFee(incumbent, sampleExec(price)).customerTotal;
    if (c > i && (!worst || c - i > worst.candidateFee - worst.incumbentFee)) {
      worst = { price, candidateFee: c, incumbentFee: i };
    }
  }
  return worst;
}

export function revalidateDominance(
  rules: FeeRule[], schedules: FeeSchedule[], today: string,
): { rule: FeeRule; ok: boolean }[] {
  const active = rules.filter((r) => r.status === '활성' && r.startDate <= today && today <= r.endDate);
  const schedOf = (id: string) => schedules.find((s) => s.id === id)!;
  const baseOf = (assetClass: string) =>
    active.find((r) => r.type === 'BASE' && r.scope.assetClass === assetClass);
  const result: { rule: FeeRule; ok: boolean }[] = [];
  for (const r of active) {
    if (r.type === 'BASE') continue;
    const base = baseOf(r.scope.assetClass);
    if (!base) continue;
    // calcFee는 product를 쓰지 않으므로 더미 product로 sampleExec 구성
    const dummy: Product = { assetClass: r.scope.assetClass, exchange: 'X', code: 'X', name: 'X', currency: 'KRW', sessions: ['주간'] };
    const sample = (price: number): Execution =>
      ({ accountId: 'SIM', product: dummy, session: '주간', price, qty: 10, notional: price * 10 });
    const ok = dominates(schedOf(r.scheduleId), schedOf(base.scheduleId), sample);
    result.push({ rule: r, ok });
  }
  return result;
}
