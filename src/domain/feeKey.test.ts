import { it, expect, describe } from 'vitest';
import { buildFeeKey, deriveFeeKey, feeKeyString, isDerivative } from './feeKey';
import type { Product } from './types';
const stock: Product = { assetClass: '국내주식', exchange: 'KRX', code: '005930', name: '삼성전자', currency: 'KRW', sessions: ['정규'] };
const deriv: Product = { assetClass: '해외파생', exchange: 'CME', code: '6A', name: 'AUD', currency: 'USD', sessions: ['정규'] };

describe('feeKey', () => {
  it('주식은 품목이 붕괴(null)', () => {
    const k = deriveFeeKey(stock, '정규', 'MTS');
    expect(k.product).toBeNull();
    expect(feeKeyString(k)).toBe('국내주식|KRX|정규|MTS');
  });
  it('파생은 품목 유지', () => {
    const k = deriveFeeKey(deriv, '정규', 'HTS');
    expect(k.product).toBe('6A');
    expect(feeKeyString(k)).toBe('해외파생|CME|정규|HTS|6A');
  });
  it('buildFeeKey — 주식형은 productCode를 줘도 품목 붕괴, 거래소·세션·채널만', () => {
    const k = buildFeeKey('국내주식', 'NXT', '프리', 'MTS', '005930');
    expect(k.product).toBeNull();
    expect(feeKeyString(k)).toBe('국내주식|NXT|프리|MTS');
  });
  it('buildFeeKey — 파생은 productCode 유지', () => {
    const k = buildFeeKey('해외파생', 'CME', '정규', 'HTS', '6A');
    expect(k.product).toBe('6A');
    expect(feeKeyString(k)).toBe('해외파생|CME|정규|HTS|6A');
  });
  it('isDerivative', () => {
    expect(isDerivative('국내파생')).toBe(true);
    expect(isDerivative('해외파생')).toBe(true);
    expect(isDerivative('국내주식')).toBe(false);
    expect(isDerivative('해외주식')).toBe(false);
  });
});
