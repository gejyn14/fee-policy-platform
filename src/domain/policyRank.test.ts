import { it, expect, describe } from 'vitest';
import { buildPolicyPriority, rankKey } from './policyRank';
import type { Account, Enrollment, FeeKey, FeeRule, FeeSchedule, ScopeSelector } from './types';

const scope = (over: Partial<ScopeSelector> = {}): ScopeSelector =>
  ({ assetClass: '국내주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [], ...over });
const flatSched = (id: string, flat: number): FeeSchedule =>
  ({ id, name: id, components: [{ name: '위탁', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: flat }] });
const bpSched = (id: string, bp: number): FeeSchedule =>
  ({ id, name: id, components: [{ name: '위탁', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: bp }] });
const rule = (over: Partial<FeeRule>): FeeRule => ({
  id: 'R', name: 'r', type: 'BASE', status: '활성', applyMode: '타겟추출형',
  startDate: '2020-01-01', endDate: '2099-12-31', scope: scope(), scheduleId: 'S',
  warnings: { dominance: true, reverseMargin: false }, createdBy: 't', log: [], ...over });
const key = (over: Partial<FeeKey> = {}): FeeKey =>
  ({ assetClass: '국내주식', exchange: 'KRX', session: '정규', channel: 'MTS', product: null, ...over });
const acct = (over: Partial<Account> = {}): Account =>
  ({ id: 'A', name: 'a', grade: 'SILVER', dormantReturned: false, metric6mAsset: 0, metric6mVolume: 0, ...over });

describe('rankKey', () => {
  it('고객부과 요율 파라미터 합 — 정액=정액, 정률=요율(기준체결 없음)', () => {
    expect(rankKey(flatSched('S', 50))).toBe(50);
    expect(rankKey(bpSched('S', 8))).toBe(8);
  });
});

describe('buildPolicyPriority', () => {
  const schedules = [flatSched('S-BASE', 100), flatSched('S-EVT', 50), flatSched('S-APP', 30)];
  const base = rule({ id: 'R-BASE', scheduleId: 'S-BASE' });
  const evt = rule({ id: 'R-EVT', type: 'EVENT', scheduleId: 'S-EVT', scope: scope({ channels: ['MTS'] }) });
  const applied = rule({ id: 'R-APP', type: 'EVENT', applyMode: '신청형', scheduleId: 'S-APP', scope: scope({ channels: ['MTS'] }) });
  const expired = rule({ id: 'R-OLD', type: 'EVENT', scheduleId: 'S-EVT', endDate: '2020-12-31' });
  const idx = () => buildPolicyPriority([base, evt, applied, expired], schedules, '2026-07-04');

  it('순위엔 기본 + 활성 전 이벤트(신청형 포함), 만료는 제외', () => {
    expect(idx().policies.map((p) => p.ruleId).sort()).toEqual(['R-APP', 'R-BASE', 'R-EVT']);
  });
  it('winnerFor: 신청 이력 없으면 신청형 건너뛰고 타겟추출/기본으로', () => {
    const w = idx().winnerFor(key({ channel: 'MTS' }), acct(), []);
    expect(w!.ruleId).toBe('R-EVT');   // R-APP(30) 더 싸지만 자격 없음 → R-EVT(50)
  });
  it('winnerFor: 신청 이력 있으면 더 싼 신청형이 승자', () => {
    const enr: Enrollment[] = [{ accountId: 'A', ruleId: 'R-APP', enrolledAt: '2026-06-01', channel: 'MTS' }];
    const w = idx().winnerFor(key({ channel: 'MTS' }), acct(), enr);
    expect(w!.ruleId).toBe('R-APP');   // rank 30 최저 + 자격 통과
  });
  it('winnerFor: 채널 불일치면 기본', () => {
    expect(idx().winnerFor(key({ channel: 'HTS' }), acct(), [])!.ruleId).toBe('R-BASE');
  });
  it('topFor: 자격 무시 최상위(신청형이라도)', () => {
    expect(idx().topFor(key({ channel: 'MTS' }))!.ruleId).toBe('R-APP');  // rank 30 최저
  });
});
