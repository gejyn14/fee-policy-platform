import { it, expect } from 'vitest';
import { deriveProducts } from './derive';
import type { Instrument } from './instruments';

const base: Instrument = { assetClass: '국내주식', exchange: 'KRX', code: '005930', name: '삼성전자',
  currency: 'KRW', sessions: ['정규'], status: '정상', nxtTradable: true, listedAt: '1975-06-11' };

it('NXT 병행 국내주식은 KRX/NXT 2건으로 확장', () => {
  const ps = deriveProducts([base]);
  expect(ps).toHaveLength(2);
  expect(ps.map(p => p.exchange).sort()).toEqual(['KRX', 'NXT']);
  expect(ps.every(p => p.code === '005930')).toBe(true);
});

it('nxtTradable 아니면 1건', () => {
  expect(deriveProducts([{ ...base, nxtTradable: false }])).toHaveLength(1);
});

it('상장폐지는 제외, 거래정지는 포함', () => {
  expect(deriveProducts([{ ...base, status: '상장폐지' }])).toHaveLength(0);
  expect(deriveProducts([{ ...base, nxtTradable: false, status: '거래정지' }])).toHaveLength(1);
});

it('비국내주식은 nxtTradable 무관 1건', () => {
  const fut: Instrument = { assetClass: '해외파생', exchange: 'CME', code: '6A', name: 'AUD',
    currency: 'USD', sessions: ['주간'], status: '정상', listedAt: '1987-01-13' };
  expect(deriveProducts([fut])).toHaveLength(1);
});
