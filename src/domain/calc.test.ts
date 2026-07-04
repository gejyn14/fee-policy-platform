import { describe, it, expect } from 'vitest';
import { calcFee } from './calc';
import type { FeeSchedule, Execution, Product } from './types';

const stock: Product = { assetClass: '국내주식', exchange: 'KRX', code: '005930', name: '삼성전자', currency: 'KRW', sessions: ['정규'] };
const exec = (price: number, qty: number): Execution =>
  ({ accountId: 'A-1', product: stock, session: '정규', price, qty, notional: price * qty });

it('정률: 거래대금 × bp', () => {
  const s: FeeSchedule = { id: 'S1', name: 't', components: [
    { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 15 }] };
  // 1,000,000 × 15bp = 1,500
  expect(calcFee(s, exec(100_000, 10)).customerTotal).toBe(1500);
});

it('정액: 계약당 금액 × 수량', () => {
  const s: FeeSchedule = { id: 'S2', name: 't', components: [
    { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: 300 }] };
  expect(calcFee(s, exec(100, 5)).customerTotal).toBe(1500);
});

it('구간표: 체결단가 구간으로 요율 결정', () => {
  const s: FeeSchedule = { id: 'S3', name: 't', components: [
    { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '구간표', bands: [
      { from: 0, to: 3, flat: 10 }, { from: 3, to: null, flat: 50 }] }] };
  expect(calcFee(s, exec(2.5, 10)).customerTotal).toBe(100);   // 저가 구간
  expect(calcFee(s, exec(5, 10)).customerTotal).toBe(500);     // 상위 구간
});

it('최소수수료 적용', () => {
  const s: FeeSchedule = { id: 'S4', name: 't', components: [
    { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 10, minFee: 5000 }] };
  expect(calcFee(s, exec(1000, 10)).customerTotal).toBe(5000); // 10원 < minFee
});

it('부담주체: 회사부담은 companyBorne, 면제는 0', () => {
  const s: FeeSchedule = { id: 'S5', name: 't', components: [
    { name: '자사 수수료', kind: '자사', payer: '면제', rateType: '정률', rateBp: 15 },
    { name: '거래소', kind: '유관기관', payer: '회사부담', rateType: '정률', rateBp: 2 },
    { name: '제세금', kind: '세금', payer: '고객부과', rateType: '정률', rateBp: 23 }] };
  const r = calcFee(s, exec(100_000, 10)); // 대금 1,000,000
  expect(r.customerTotal).toBe(2300);      // 세금만 고객부과
  expect(r.companyBorne).toBe(200);        // 거래소분 회사부담
  expect(r.lines.find(l => l.name === '자사 수수료')!.amount).toBe(0);
});
