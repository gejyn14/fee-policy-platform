import { create } from 'zustand';
import type { Account, Enrollment, FeeBinding, FeeRule, FeeSchedule, Product, Execution } from '../domain/types';
import { TODAY } from '../domain/types';
import { mockAccounts, mockProducts, mockSchedules, mockRules, mockEnrollments } from './mock';
import { rebindAccount, scopeMatches, isTarget } from '../domain/binding';
import { calcFee } from '../domain/calc';
import { dominates } from '../domain/dominance';

export function evalCondition(rule: FeeRule, acct: Account): boolean {
  if (!rule.condition) return true;
  const value = rule.condition.metric === '6개월평균자산' ? acct.metric6mAsset : acct.metric6mVolume;
  return value >= rule.condition.threshold;
}

interface State {
  accounts: Account[]; products: Product[]; schedules: FeeSchedule[];
  rules: FeeRule[]; enrollments: Enrollment[]; bindings: FeeBinding[];
  reset(): void; rebindAll(): void;
  submitRule(rule: FeeRule, schedule: FeeSchedule): void;
  approveRule(id: string): void;
  rejectRule(id: string, reason: string): void;
  extendNegotiated(id: string, newEndDate: string): void;
}

function allBindings(s: Pick<State, 'accounts' | 'rules' | 'schedules' | 'enrollments' | 'products'>): FeeBinding[] {
  return s.accounts.flatMap((a) => rebindAccount(a, s.rules, s.schedules, s.enrollments, s.products, TODAY));
}

export const useStore = create<State>((set, get) => ({
  accounts: mockAccounts, products: mockProducts, schedules: mockSchedules,
  rules: mockRules, enrollments: mockEnrollments, bindings: [],

  reset: () => set((s) => {
    const init = { accounts: mockAccounts, products: mockProducts, schedules: mockSchedules,
      rules: mockRules.map(r => ({ ...r, log: [...r.log] })), enrollments: mockEnrollments };
    return { ...init, bindings: allBindings(init) };
  }),

  rebindAll: () => set((s) => ({ bindings: allBindings(s) })),

  submitRule: (rule, schedule) => set((s) => {
    // ① 지배관계: 같은 scope의 기존 바인딩 요율표(대표: BASE) 대비 전 구간 비교
    const targetProducts = s.products.filter((p) => scopeMatches(rule.scope, p));

    // Guard: if no products match scope, submit with empty sim
    if (targetProducts.length === 0) {
      const submitted: FeeRule = { ...rule, status: '승인대기',
        warnings: { dominance: true, reverseMargin: false },
        sim: { targets: 0, saving: 0 },
        log: [...rule.log, `${TODAY} 기안 상신 (${rule.createdBy})`] };
      return { schedules: [...s.schedules.filter((x) => x.id !== schedule.id), schedule],
        rules: [...s.rules.filter((x) => x.id !== rule.id), submitted] };
    }

    const incumbents = s.rules.filter((r) => r.status === '활성' &&
      targetProducts.some((p) => scopeMatches(r.scope, p)));
    const sample = (p: Product) => (price: number): Execution =>
      ({ accountId: 'SIM', product: p, session: p.sessions[0], price, qty: 10, notional: price * 10 });
    const dominanceOk = incumbents.every((inc) => targetProducts.every((p) =>
      dominates(schedule, s.schedules.find((x) => x.id === inc.scheduleId)!, sample(p))));
    // ② 역마진: 표본 체결에서 회사부담 > 자사 수취
    const probe = calcFee(schedule, sample(targetProducts[0])(100));
    const ownReceived = probe.lines.filter((l) => l.kind === '자사' && l.payer === '고객부과')
      .reduce((a, l) => a + l.amount, 0);
    const reverseMargin = probe.companyBorne > ownReceived;
    // ③ 시뮬레이션: 대상 계좌 × 표본 60건 기준 감면액
    const targets = s.accounts.filter((a) => isTarget({ ...rule, status: '활성' }, a, s.enrollments));
    const saving = targets.length * targetProducts.length * 60 *
      Math.max(0, calcFee(s.schedules.find((x) => x.id === incumbents[0]?.scheduleId)
        ?? schedule, sample(targetProducts[0])(100)).customerTotal - probe.customerTotal);
    const submitted: FeeRule = { ...rule, status: '승인대기',
      warnings: { dominance: dominanceOk, reverseMargin },
      sim: { targets: targets.length, saving: Math.round(saving) },
      log: [...rule.log, `${TODAY} 기안 상신 (${rule.createdBy})`] };
    return { schedules: [...s.schedules.filter((x) => x.id !== schedule.id), schedule],
      rules: [...s.rules.filter((x) => x.id !== rule.id), submitted] };
  }),

  approveRule: (id) => set((s) => {
    const rules = s.rules.map((r) => r.id === id
      ? { ...r, status: '활성' as const, log: [...r.log, `${TODAY} 승인 → 활성`] } : r);
    const next = { ...s, rules };
    return { rules, bindings: allBindings(next) };
  }),

  rejectRule: (id, reason) => set((s) => ({
    rules: s.rules.map((r) => r.id === id
      ? { ...r, status: '반려' as const, log: [...r.log, `${TODAY} 반려: ${reason}`] } : r),
  })),

  extendNegotiated: (id, newEndDate) => set((s) => {
    const rules = s.rules.map((r) => r.id === id
      ? { ...r, endDate: newEndDate, log: [...r.log, `${TODAY} 기간 연장 → ${newEndDate}`] } : r);
    const next = { ...s, rules };
    return { rules, bindings: allBindings(next) };
  }),
}));

useStore.getState().reset(); // 초기 바인딩 생성
