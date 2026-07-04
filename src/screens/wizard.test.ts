import { it, expect, describe } from 'vitest';
import { parseCsvCodes } from './pickerLogic';

describe('parseCsvCodes', () => {
  it('콤마와 개행이 섞인 텍스트를 파싱해 유효 코드만 accepted로 분류', () => {
    const valid = new Set(['6A', '6B', 'AAPL']);
    const { accepted, rejected } = parseCsvCodes('6A, 6B\nAAPL', valid);
    expect(accepted).toEqual(['6A', '6B', 'AAPL']);
    expect(rejected).toEqual([]);
  });

  it('유효하지 않은 코드는 rejected로 분류되고 accepted에서 제외', () => {
    const valid = new Set(['6A', '6B']);
    const { accepted, rejected } = parseCsvCodes('6A,XYZ\n6B,ZZZ', valid);
    expect(accepted).toEqual(['6A', '6B']);
    expect(rejected).toEqual(['XYZ', 'ZZZ']);
  });

  it('빈 토큰/공백/중복은 무시하고 accepted는 중복 제거된다', () => {
    const valid = new Set(['6A']);
    const { accepted, rejected } = parseCsvCodes('6A,, \n 6A \n6A', valid);
    expect(accepted).toEqual(['6A']);
    expect(rejected).toEqual([]);
  });
});
