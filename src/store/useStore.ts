import { create } from 'zustand';
import type { Account, Enrollment, FeeBinding, FeeRule, FeeSchedule, Product, Execution } from '../domain/types';
import { TODAY } from '../domain/types';
import { mockAccounts, mockSchedules, mockRules, mockEnrollments } from './mock';
import { rebindAccount, scopeMatches, isTarget } from '../domain/binding';
import { calcFee } from '../domain/calc';
import { dominates } from '../domain/dominance';
import { generateInstruments, NEW_LISTING_POOL } from '../masterdata/instruments';
import type { Instrument } from '../masterdata/instruments';
import { deriveProducts } from '../masterdata/derive';

const MASTER = generateInstruments();
const SYNC_BATCH_SIZE = 5;

export function evalCondition(rule: FeeRule, acct: Account): boolean {
  if (!rule.condition) return true;
  const value = rule.condition.metric === '6개월평균자산' ? acct.metric6mAsset : acct.metric6mVolume;
  return value >= rule.condition.threshold;
}

interface State {
  accounts: Account[]; instruments: Instrument[]; products: Product[]; schedules: FeeSchedule[];
  rules: FeeRule[]; enrollments: Enrollment[]; bindings: FeeBinding[];
  syncCursor: number;
  wizardDraft: { form: unknown; step: number } | null;
  reset(): void; rebindAll(): void;
  submitRule(rule: FeeRule, schedule: FeeSchedule): void;
  approveRule(id: string): void;
  rejectRule(id: string, reason: string): void;
  extendNegotiated(id: string, newEndDate: string): void;
  setWizardDraft(d: { form: unknown; step: number } | null): void;
  syncFromLedger(): { added: number };
  registerInstruments(rows: Instrument[]): { accepted: number; rejected: string[] };
}

function allBindings(s: Pick<State, 'accounts' | 'rules' | 'schedules' | 'enrollments' | 'products'>): FeeBinding[] {
  return s.accounts.flatMap((a) => rebindAccount(a, s.rules, s.schedules, s.enrollments, s.products, TODAY));
}

export const useStore = create<State>((set) => ({
  accounts: mockAccounts, instruments: MASTER, products: deriveProducts(MASTER), schedules: mockSchedules,
  rules: mockRules, enrollments: mockEnrollments, bindings: [],
  syncCursor: 0,
  wizardDraft: null,

  reset: () => set(() => {
    const init = { accounts: mockAccounts, instruments: MASTER, products: deriveProducts(MASTER), schedules: mockSchedules,
      rules: mockRules.map(r => ({ ...r, log: [...r.log] })), enrollments: mockEnrollments };
    return { ...init, bindings: allBindings(init), syncCursor: 0, wizardDraft: null };
  }),

  rebindAll: () => set((s) => ({ bindings: allBindings(s) })),

  syncFromLedger: () => {
    let added = 0;
    set((s) => {
      const batch = NEW_LISTING_POOL.slice(s.syncCursor, s.syncCursor + SYNC_BATCH_SIZE);
      added = batch.length;
      if (batch.length === 0) return {};
      const instruments = [...s.instruments, ...batch];
      const products = deriveProducts(instruments);
      const next = { ...s, instruments, products };
      return { instruments, products, syncCursor: s.syncCursor + batch.length, bindings: allBindings(next) };
    });
    return { added };
  },

  registerInstruments: (rows) => {
    let accepted = 0;
    const rejected: string[] = [];
    set((s) => {
      const existingCodes = new Set(s.instruments.map((i) => i.code));
      const toAdd: Instrument[] = [];
      for (const row of rows) {
        if (existingCodes.has(row.code)) {
          rejected.push(row.code);
        } else {
          existingCodes.add(row.code);
          toAdd.push(row);
        }
      }
      accepted = toAdd.length;
      if (toAdd.length === 0) return {};
      const instruments = [...s.instruments, ...toAdd];
      const products = deriveProducts(instruments);
      const next = { ...s, instruments, products };
      return { instruments, products, bindings: allBindings(next) };
    });
    return { accepted, rejected };
  },

  submitRule: (rule, schedule) => set((s) => {
    // ① 지배관계: 같은 scope의 기존 바인딩 요율표(대표: BASE) 대비 전 구간 비교
    const targetProducts = s.products.filter((p) => scopeMatches(rule.scope, p));

    // Guard: if no products match scope, submit with empty sim
    if (targetProducts.length === 0) {
      const submitted: FeeRule = { ...rule, status: '승인대기',
        warnings: { dominance: true, reverseMargin: false },
        sim: { targets: 0, saving: 0, matchedProducts: 0 },
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
    // ③ 시뮬레이션: 품목별로 scope 매칭되는 incumbent 중 최저가를 현행으로 삼아 신규와 차액을 합산,
    // 대상 계좌 × 표본 60건 기준 감면액 (위저드 5단계 표와 동일 기준)
    const targets = s.accounts.filter((a) => isTarget({ ...rule, status: '활성' }, a, s.enrollments));
    const perProductSaving = targetProducts.reduce((sum, p) => {
      const matchingIncumbents = incumbents.filter((r) => scopeMatches(r.scope, p));
      if (matchingIncumbents.length === 0) return sum;
      const current = Math.min(...matchingIncumbents.map((inc) =>
        calcFee(s.schedules.find((x) => x.id === inc.scheduleId)!, sample(p)(100)).customerTotal));
      const next = calcFee(schedule, sample(p)(100)).customerTotal;
      return sum + Math.max(0, current - next);
    }, 0);
    const saving = targets.length * 60 * perProductSaving;
    const submitted: FeeRule = { ...rule, status: '승인대기',
      warnings: { dominance: dominanceOk, reverseMargin },
      sim: { targets: targets.length, saving: Math.round(saving), matchedProducts: targetProducts.length },
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

  setWizardDraft: (d) => set({ wizardDraft: d }),
}));

useStore.getState().reset(); // 초기 바인딩 생성
