import { it, expect, describe } from 'vitest';
import { buildPolicyPriority, isAccountIndependent, rankValue } from './policyRank';
import type { FeeKey, FeeRule, FeeSchedule, ScopeSelector } from './types';

const scope = (over: Partial<ScopeSelector> = {}): ScopeSelector =>
  ({ assetClass: '국내주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [], ...over });
const sched = (id: string, flat: number): FeeSchedule =>
  ({ id, name: id, components: [{ name: '위탁', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: flat }] });
const rule = (over: Partial<FeeRule>): FeeRule => ({
  id: 'R', name: 'r', type: 'BASE', status: '활성', applyMode: '타겟추출형',
  startDate: '2020-01-01', endDate: '2099-12-31', scope: scope(), scheduleId: 'S',
  warnings: { dominance: true, reverseMargin: false }, createdBy: 't', log: [], ...over });
const key = (over: Partial<FeeKey> = {}): FeeKey =>
  ({ assetClass: '국내주식', exchange: 'KRX', session: '정규', channel: 'MTS', product: null, ...over });

describe('rankValue', () => {
  it('기준 체결(수량 10)의 고객부과 총액', () => {
    expect(rankValue(sched('S', 50))).toBe(500);   // 50 × 10
  });
});

describe('isAccountIndependent', () => {
  it('BASE·전체 타겟추출형 이벤트는 계좌 무관, 신청/가입/지정계좌는 아님', () => {
    expect(isAccountIndependent(rule({ type: 'BASE' }))).toBe(true);
    expect(isAccountIndependent(rule({ type: 'EVENT', applyMode: '타겟추출형' }))).toBe(true);
    expect(isAccountIndependent(rule({ type: 'EVENT', applyMode: '타겟추출형', targetAccountIds: ['A'] }))).toBe(false);
    expect(isAccountIndependent(rule({ type: 'EVENT', applyMode: '신청형' }))).toBe(false);
    expect(isAccountIndependent(rule({ type: 'EVENT', applyMode: '가입형' }))).toBe(false);
  });
});

describe('buildPolicyPriority', () => {
  const schedules = [sched('S-BASE', 100), sched('S-EVT', 50)];
  const base = rule({ id: 'R-BASE', scheduleId: 'S-BASE' });
  const evt = rule({ id: 'R-EVT', type: 'EVENT', scheduleId: 'S-EVT', scope: scope({ channels: ['MTS'] }) });
  const expired = rule({ id: 'R-OLD', type: 'EVENT', scheduleId: 'S-EVT', endDate: '2020-12-31' });
  const applied = rule({ id: 'R-APP', type: 'EVENT', applyMode: '신청형', scheduleId: 'S-EVT' }); // 계좌 특정

  it('winnerFor: 계좌 무관 최저가(이벤트가 base보다 싸면 이벤트)', () => {
    const idx = buildPolicyPriority([base, evt, expired, applied], schedules, '2026-07-04');
    const w = idx.winnerFor(key({ channel: 'MTS' }));
    expect(w!.ruleId).toBe('R-EVT');   // rank 500 < base 1000
  });
  it('winnerFor: 이벤트 채널 불일치면 base', () => {
    const idx = buildPolicyPriority([base, evt], schedules, '2026-07-04');
    expect(idx.winnerFor(key({ channel: 'HTS' }))!.ruleId).toBe('R-BASE');
  });
  it('만료·계좌특정 정책은 순위에서 제외', () => {
    const idx = buildPolicyPriority([base, evt, expired, applied], schedules, '2026-07-04');
    expect(idx.policies.map((p) => p.ruleId).sort()).toEqual(['R-BASE', 'R-EVT']);
  });
});
