import { it, expect, describe, beforeEach } from 'vitest';
import { ResolveCache } from './cache';
import type { FeeKey } from './types';
const key = (over: Partial<FeeKey> = {}): FeeKey =>
  ({ assetClass: '국내주식', exchange: 'KRX', session: '정규', channel: 'MTS', product: null, ...over });

describe('ResolveCache', () => {
  let c: ResolveCache;
  beforeEach(() => { c = new ResolveCache(); });

  it('set 후 get 적중(hits++), 미설정 get miss(misses++)', () => {
    expect(c.get('A', key())).toBeNull();                 // miss
    c.set('A', key(), { scheduleId: 'S1', sourceRuleId: null, source: 'base' });
    expect(c.get('A', key())).toEqual({ scheduleId: 'S1', sourceRuleId: null, source: 'base' }); // hit
    const s = c.stat();
    expect(s.hits).toBe(1); expect(s.misses).toBe(1); expect(s.size).toBe(1);
  });

  it('계좌·feeKey가 다르면 별도 항목', () => {
    c.set('A', key(), { scheduleId: 'S1', sourceRuleId: null, source: 'base' });
    c.set('B', key(), { scheduleId: 'S2', sourceRuleId: null, source: 'base' });
    c.set('A', key({ channel: 'HTS' }), { scheduleId: 'S3', sourceRuleId: null, source: 'base' });
    expect(c.stat().size).toBe(3);
  });

  it('invalidateAccount는 그 계좌 항목만 제거하고 건수 반환', () => {
    c.set('A', key(), { scheduleId: 'S1', sourceRuleId: null, source: 'base' });
    c.set('A', key({ channel: 'HTS' }), { scheduleId: 'S2', sourceRuleId: null, source: 'base' });
    c.set('B', key(), { scheduleId: 'S3', sourceRuleId: null, source: 'base' });
    expect(c.invalidateAccount('A')).toBe(2);
    expect(c.stat().size).toBe(1);
    expect(c.get('B', key())).not.toBeNull();
  });

  it('invalidateByScope(pred)는 조건 매칭 키만 제거', () => {
    c.set('A', key({ exchange: 'KRX' }), { scheduleId: 'S1', sourceRuleId: null, source: 'base' });
    c.set('A', key({ exchange: 'NXT' }), { scheduleId: 'S2', sourceRuleId: null, source: 'base' });
    const n = c.invalidateByScope((k) => k.exchange === 'NXT');
    expect(n).toBe(1);
    expect(c.stat().size).toBe(1);
  });

  it('clear는 전부 제거 + 통계 리셋', () => {
    c.set('A', key(), { scheduleId: 'S1', sourceRuleId: null, source: 'base' });
    c.get('A', key());
    c.clear();
    expect(c.stat()).toEqual({ hits: 0, misses: 0, size: 0 });
  });
});
