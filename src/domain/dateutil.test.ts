import { it, expect, describe } from 'vitest';
import { addMonths } from './dateutil';

describe('addMonths', () => {
  it('기본 덧셈', () => { expect(addMonths('2026-07-04', 2)).toBe('2026-09-04'); });
  it('월말 클램프', () => { expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'); });
  it('연도 넘김 + 클램프', () => { expect(addMonths('2026-11-30', 3)).toBe('2027-02-28'); });
  it('0개월은 동일', () => { expect(addMonths('2026-07-04', 0)).toBe('2026-07-04'); });
});
