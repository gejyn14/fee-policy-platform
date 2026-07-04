import { describe, it, expect } from 'vitest';
import { generateInstruments, NEW_LISTING_POOL } from './instruments';

describe('generateInstruments', () => {
  const all = generateInstruments();

  it('결정적: 두 번 호출해도 동일', () => {
    expect(generateInstruments()).toEqual(all);
  });

  it('총량과 상품군 분포', () => {
    expect(all.length).toBeGreaterThanOrEqual(2500);
    const by = (ac: string) => all.filter(i => i.assetClass === ac).length;
    expect(by('국내주식')).toBeGreaterThanOrEqual(1500);
    expect(by('해외주식')).toBeGreaterThanOrEqual(800);
    expect(by('해외파생')).toBeGreaterThanOrEqual(35);
    expect(by('국내파생')).toBeGreaterThanOrEqual(10);
    expect(by('금현물')).toBeGreaterThanOrEqual(1);
  });

  it('레거시 6코드가 기존 속성으로 포함', () => {
    const find = (c: string) => all.find(i => i.code === c)!;
    expect(find('005930')).toMatchObject({ assetClass: '국내주식', exchange: 'KRX', currency: 'KRW', status: '정상', nxtTradable: true });
    expect(find('AAPL')).toMatchObject({ assetClass: '해외주식', exchange: 'NASDAQ', currency: 'USD' });
    expect(find('K200OPT')).toMatchObject({ assetClass: '국내파생', exchange: 'KRX' });
    expect(find('6A')).toMatchObject({ assetClass: '해외파생', exchange: 'CME', currency: 'USD' });
    expect(find('6B')).toMatchObject({ assetClass: '해외파생', exchange: 'CME' });
    expect(find('GOLD99')).toMatchObject({ assetClass: '금현물', exchange: 'KRX' });
  });

  it('코드 유일성 + NXT 병행/상태 존재', () => {
    expect(new Set(all.map(i => i.code)).size).toBe(all.length);
    expect(all.filter(i => i.nxtTradable).length).toBeGreaterThanOrEqual(500);
    expect(all.some(i => i.status === '거래정지')).toBe(true);
    expect(all.some(i => i.status === '상장폐지')).toBe(true);
  });

  it('신규상장 풀은 마스터와 코드 비중복', () => {
    const codes = new Set(all.map(i => i.code));
    expect(NEW_LISTING_POOL.length).toBeGreaterThanOrEqual(20);
    expect(NEW_LISTING_POOL.every(i => !codes.has(i.code))).toBe(true);
  });
});
