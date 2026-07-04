import { describe, it, expect } from 'vitest';
import { parseMasterCsv } from './InstrumentMaster';

describe('parseMasterCsv', () => {
  it('정상 행(필수값·상품군 enum·비중복)은 수용된다', () => {
    const { accepted, rejected } = parseMasterCsv('000660,SK하이닉스,국내주식,KRX,KRW', new Set());
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      code: '000660',
      name: 'SK하이닉스',
      assetClass: '국내주식',
      exchange: 'KRX',
      currency: 'KRW',
      status: '정상',
      listedAt: '2026-07-04',
    });
  });

  it('상품군이 enum 밖이면 거부된다', () => {
    const { accepted, rejected } = parseMasterCsv('X001,이상한종목,암호화폐,KRX,KRW', new Set());
    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/상품군/);
  });

  it('기존 코드와 중복이면 거부된다', () => {
    const { accepted, rejected } = parseMasterCsv('005930,삼성전자,국내주식,KRX,KRW', new Set(['005930']));
    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/중복/);
  });

  it('같은 배치 내 동일 코드가 두 번 나오면 두 번째는 거부된다', () => {
    const { accepted, rejected } = parseMasterCsv(
      '000660,SK하이닉스,국내주식,KRX,KRW\n000660,SK하이닉스,국내주식,KRX,KRW',
      new Set(),
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0].code).toBe('000660');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/중복/);
  });
});
