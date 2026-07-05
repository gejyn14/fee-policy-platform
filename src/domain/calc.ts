import type { FeeComponent, FeeSchedule, Execution, Payer } from './types';

export interface FeeLine { name: string; kind: FeeComponent['kind']; payer: Payer; amount: number }
export interface FeeResult { customerTotal: number; companyBorne: number; lines: FeeLine[] }

export function componentAmount(c: FeeComponent, exec: Execution): number {
  let amt = 0;
  if (c.rateType === '정률') {
    amt = (exec.notional * (c.rateBp ?? 0)) / 10_000;
  } else if (c.rateType === '정액') {
    amt = (c.flatAmount ?? 0) * exec.qty;
  } else {
    const band = (c.bands ?? []).find(
      (b) => exec.price >= b.from && (b.to === null || exec.price < b.to),
    );
    if (band) {
      // 구간별 정률 + 정액 add-on 동시 지원(예: 옵션 "0.14% + 13원"). 한쪽만 있으면 다른쪽 0.
      amt = (exec.notional * (band.rateBp ?? 0)) / 10_000 + (band.flat ?? 0) * exec.qty;
    }
  }
  if (c.minFee != null && amt < c.minFee) amt = c.minFee;
  return Math.round(amt * 100) / 100;
}

export function calcFee(schedule: FeeSchedule, exec: Execution): FeeResult {
  const lines: FeeLine[] = schedule.components.map((c) => ({
    name: c.name, kind: c.kind, payer: c.payer,
    amount: c.payer === '면제' ? 0 : componentAmount(c, exec),
  }));
  const sum = (ls: FeeLine[]) => Math.round(ls.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  return {
    customerTotal: sum(lines.filter((l) => l.payer === '고객부과')),
    companyBorne: sum(lines.filter((l) => l.payer === '회사부담')),
    lines,
  };
}
