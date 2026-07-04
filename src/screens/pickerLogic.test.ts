import { it, expect } from 'vitest';
import { toggleCode, selectCodes, selectAllMode, clearSelection, removeChip, summarize, parseCsvCodes } from './pickerLogic';
import type { Selection } from './pickerLogic';

const empty: Selection = { products: [], excludeProducts: [], exchanges: '*' };

it('지정 모드에서 toggleCode는 선택을 넣고 뺀다', () => {
  const a = toggleCode(empty, '005930');
  expect(a.products).toEqual(['005930']);
  expect(toggleCode(a, '005930').products).toEqual([]);
});

it('전체(*) 모드에서 toggleCode는 제외를 토글한다', () => {
  const all: Selection = { products: '*', excludeProducts: [], exchanges: ['CME'] };
  const a = toggleCode(all, '6E');
  expect(a.excludeProducts).toEqual(['6E']);
  expect(toggleCode(a, '6E').excludeProducts).toEqual([]);
});

it('selectCodes는 merge + 제외 해제', () => {
  const s: Selection = { products: ['6A'], excludeProducts: ['6B'], exchanges: '*' };
  const a = selectCodes(s, ['6B', '6C', '6A']);
  expect([...a.products as string[]].sort()).toEqual(['6A', '6B', '6C']);
  expect(a.excludeProducts).toEqual([]);
});

it('selectAllMode → 전체+거래소, clearSelection → 초기화', () => {
  const a = selectAllMode(empty, ['CME']);
  expect(a.products).toBe('*');
  expect(a.exchanges).toEqual(['CME']);
  expect(clearSelection(a)).toEqual(empty);
});

it('removeChip은 선택·제외 양쪽에서 제거', () => {
  expect(removeChip({ products: ['6A', '6B'], excludeProducts: [], exchanges: '*' }, '6A').products).toEqual(['6B']);
  expect(removeChip({ products: '*', excludeProducts: ['6E'], exchanges: '*' }, '6E').excludeProducts).toEqual([]);
});

it('summarize', () => {
  expect(summarize({ products: '*', excludeProducts: [], exchanges: '*' })).toBe('전체');
  expect(summarize({ products: '*', excludeProducts: ['6E'], exchanges: '*' })).toBe('전체 · 제외 1건');
  expect(summarize({ products: ['6A'], excludeProducts: [], exchanges: '*' })).toBe('지정 1건');
});

it('parseCsvCodes는 콤마/개행 구분 코드를 유효/무효로 분류한다', () => {
  const r = parseCsvCodes('6A, 6X\n6B', new Set(['6A', '6B']));
  expect(r.accepted).toEqual(['6A', '6B']);
  expect(r.rejected).toEqual(['6X']);
});
