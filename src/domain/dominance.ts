import type { FeeSchedule, Execution } from './types';
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
