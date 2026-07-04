import { create } from 'zustand';
import type { Account, Enrollment, FeeBinding, FeeRule, FeeSchedule, Product, Execution, BatchChange, BatchJobResult, Session, Channel } from '../domain/types';
import { TODAY } from '../domain/types';
import { mockAccounts, mockSchedules, mockRules, mockEnrollments, mockNego } from './mock';
import { rebindAccount, scopeMatches, isTarget } from '../domain/binding';
import { calcFee } from '../domain/calc';
import { dominates, revalidateDominance } from '../domain/dominance';
import { generateInstruments, NEW_LISTING_POOL } from '../masterdata/instruments';
import type { Instrument } from '../masterdata/instruments';
import { deriveProducts } from '../masterdata/derive';
import { nudgeMetrics } from '../domain/metrics';
import { classifyLifecycle } from '../domain/lifecycle';
import { evalCondition } from '../domain/eligibility';
import { deriveFeeKey } from '../domain/feeKey';
import { resolve, buildScopeIndex, type NegoException, type ResolveResult } from '../domain/resolve';
import { ResolveCache, type CacheStat } from '../domain/cache';

const MASTER = generateInstruments();
const SYNC_BATCH_SIZE = 5;
const resolveCache = new ResolveCache();

export { evalCondition } from '../domain/eligibility';

interface State {
  accounts: Account[]; instruments: Instrument[]; products: Product[]; schedules: FeeSchedule[];
  rules: FeeRule[]; enrollments: Enrollment[]; bindings: FeeBinding[];
  nego: NegoException[];
  syncCursor: number;
  wizardDraft: { form: unknown; step: number } | null;
  reset(): void; rebindAll(): void;
  resolveFee(accountId: string, product: Product, session: Session, channel: Channel): (ResolveResult & { cacheHit: boolean }) | null;
  cacheStat(): CacheStat;
  submitRule(rule: FeeRule, schedule: FeeSchedule): void;
  approveRule(id: string): void;
  rejectRule(id: string, reason: string): void;
  extendNegotiated(id: string, newEndDate: string): void;
  setWizardDraft(d: { form: unknown; step: number } | null): void;
  syncFromLedger(): { added: number };
  registerInstruments(rows: Instrument[]): { accepted: number; rejected: string[] };
  batchActivateExpireRules(): BatchJobResult;
  batchRecomputeMetrics(): BatchJobResult;
  batchSyncInstruments(): BatchJobResult;
  batchEvalNegotiations(): BatchJobResult;
  batchRebind(): BatchJobResult;
  batchRevalidateDominance(): BatchJobResult;
}

// '2026-12-31' → '2027-12-31' (Date 객체 금지, 문자열 연도만 +1)
function extendOneYear(dateStr: string): string {
  const [y, ...rest] = dateStr.split('-');
  return [String(Number(y) + 1), ...rest].join('-');
}

function allBindings(s: Pick<State, 'accounts' | 'rules' | 'schedules' | 'enrollments' | 'products'>): FeeBinding[] {
  return s.accounts.flatMap((a) => rebindAccount(a, s.rules, s.schedules, s.enrollments, s.products, TODAY));
}

export const useStore = create<State>((set) => ({
  accounts: mockAccounts, instruments: MASTER, products: deriveProducts(MASTER), schedules: mockSchedules,
  rules: mockRules, enrollments: mockEnrollments, bindings: [],
  nego: mockNego,
  syncCursor: 0,
  wizardDraft: null,

  reset: () => set(() => {
    const init = { accounts: mockAccounts, instruments: MASTER, products: deriveProducts(MASTER), schedules: mockSchedules,
      rules: mockRules.map(r => ({ ...r, log: [...r.log] })), enrollments: mockEnrollments };
    resolveCache.clear();
    return { ...init, bindings: allBindings(init), nego: mockNego, syncCursor: 0, wizardDraft: null };
  }),

  rebindAll: () => set((s) => ({ bindings: allBindings(s) })),

  resolveFee: (accountId, product, session, channel) => {
    const s = useStore.getState();
    const acct = s.accounts.find((a) => a.id === accountId);
    if (!acct) return null;
    const key = deriveFeeKey(product, session, channel);
    const hit = resolveCache.get(accountId, key);
    if (hit) return { key, scheduleId: hit.scheduleId, sourceRuleId: hit.sourceRuleId, source: hit.source, candidates: [], cacheHit: true };
    const idx = buildScopeIndex(s.rules, TODAY);
    const r = resolve(acct, key, s.rules, s.schedules, s.nego, idx, TODAY);
    if (!r) return null;
    resolveCache.set(accountId, key, { scheduleId: r.scheduleId, sourceRuleId: r.sourceRuleId, source: r.source });
    return { ...r, cacheHit: false };
  },
  cacheStat: () => resolveCache.stat(),

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

  batchActivateExpireRules: () => {
    const changes: BatchChange[] = [];
    set((s) => {
      const rules = s.rules.map((r) => {
        const c = classifyLifecycle(r, TODAY);
        if (c === 'activate') { changes.push({ label: r.id, detail: `발효: 승인대기 → 활성 (${r.name})` });
          return { ...r, status: '활성' as const, log: [...r.log, `${TODAY} 발효(배치) → 활성`] }; }
        if (c === 'expire') { changes.push({ label: r.id, detail: `만료: 활성 → 종료 (${r.name})` });
          return { ...r, status: '종료' as const, log: [...r.log, `${TODAY} 만료(배치) → 종료`] }; }
        return r;
      });
      return { rules };   // rebind 안 함
    });
    const act = changes.filter(c => c.detail.startsWith('발효')).length;
    const exp = changes.filter(c => c.detail.startsWith('만료')).length;
    return { summary: `발효 ${act} · 만료 ${exp}`, changes };
  },

  batchRecomputeMetrics: () => {
    const changes: BatchChange[] = [];
    set((s) => {
      const accounts = s.accounts.map((a) => {
        const n = nudgeMetrics(a);
        if (n.metric6mAsset !== a.metric6mAsset) changes.push({ label: a.id,
          detail: `6개월평균자산 ${a.metric6mAsset.toLocaleString()} → ${n.metric6mAsset.toLocaleString()}` });
        return { ...a, ...n };
      });
      return { accounts };
    });
    return { summary: `지표변경 ${changes.length}`, changes };
  },

  batchSyncInstruments: () => {
    let added = 0; const changes: BatchChange[] = [];
    set((s) => {
      const batch = NEW_LISTING_POOL.slice(s.syncCursor, s.syncCursor + SYNC_BATCH_SIZE);
      added = batch.length;
      if (batch.length === 0) return {};
      batch.forEach((i) => changes.push({ label: i.code, detail: `신규 상장: ${i.name} (${i.exchange})` }));
      const instruments = [...s.instruments, ...batch];
      return { instruments, products: deriveProducts(instruments), syncCursor: s.syncCursor + batch.length }; // rebind 안 함
    });
    return { summary: `신규 품목 ${added}`, changes };
  },

  batchEvalNegotiations: () => {
    const changes: BatchChange[] = [];
    set((s) => {
      const rules = s.rules.map((r) => {
        if (r.type !== 'NEGOTIATED' || !r.condition) return r;
        const enrolledAccts = s.accounts.filter((a) => s.enrollments.some((e) => e.accountId === a.id && e.ruleId === r.id));
        let anyMet = false;
        for (const a of enrolledAccts) {
          const met = evalCondition(r, a);
          changes.push({ label: `${a.id}·${r.scope.assetClass}`,
            detail: met ? `조건 충족 → 자격 유지/연장` : `조건 미충족 → 해지 후보` });
          if (met) anyMet = true;
        }
        return anyMet ? { ...r, endDate: extendOneYear(r.endDate), log: [...r.log, `${TODAY} 배치 자동연장`] } : r;
      });
      return { rules };
    });
    const met = changes.filter(c => c.detail.includes('충족') && !c.detail.includes('미충족')).length;
    const unmet = changes.filter(c => c.detail.includes('미충족')).length;
    return { summary: `자격 유지 ${met} · 해지후보 ${unmet}`, changes };
  },

  batchRebind: () => {
    const before = new Map<string, string>(useStore.getState().bindings.map((b) => [`${b.accountId}|${b.scopeKey}`, b.scheduleId]));
    set((s) => ({ bindings: allBindings(s) }));
    const after = useStore.getState().bindings;
    // 변경 행을 새 바인딩 출처 룰 유형(협수>이벤트>기본) 순으로 정렬해, 소수의 협수 캐스케이드가
    // 대량 이벤트 변경(예: 국내주식 프로모션 일괄 적용)에 묻히지 않고 상단에 오게 한다.
    const typeOf = new Map(useStore.getState().rules.map((r) => [r.id, r.type] as const));
    const rank: Record<string, number> = { NEGOTIATED: 0, EVENT: 1, BASE: 2 };
    const rows: { change: BatchChange; r: number }[] = [];
    for (const b of after) {
      const key = `${b.accountId}|${b.scopeKey}`;
      const prev = before.get(key);
      if (prev !== b.scheduleId) rows.push({
        change: { label: `${b.accountId} ${b.scopeKey}`, detail: `${prev ?? '(신규)'} → ${b.scheduleId}` },
        r: rank[typeOf.get(b.sourceRuleId) ?? 'BASE'] ?? 2,
      });
    }
    rows.sort((a, b) => a.r - b.r);
    const changes = rows.map((x) => x.change);
    return { summary: `바인딩 변경 ${changes.length}`, changes };
  },

  batchRevalidateDominance: () => {
    const s = useStore.getState();
    const res = revalidateDominance(s.rules, s.schedules, TODAY);
    const violations = res.filter((r) => !r.ok);
    const changes: BatchChange[] = res.map((r) => ({ label: r.rule.id,
      detail: r.ok ? `BASE 대비 전 구간 저렴 ✓` : `⚠ BASE보다 비싼 구간 존재` }));
    return { summary: `재검증 ${res.length} · 위반 ${violations.length}`, changes };
  },
}));

useStore.getState().reset(); // 초기 바인딩 생성
