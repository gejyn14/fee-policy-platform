import { it, expect, describe } from 'vitest';
import { addMonths } from './Negotiated';

describe('addMonths', () => {
  it('평월: 말일 overflow 없이 단순 월 이동', () => {
    expect(addMonths('2026-03-15', 6)).toBe('2026-09-15');
  });

  it('월말 overflow: 8/31 + 6개월 → 2/28 (2월은 28일)', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
  });

  it('연도 넘김: overflow 없이 해를 넘긴다', () => {
    expect(addMonths('2026-10-01', 6)).toBe('2027-04-01');
  });
});
