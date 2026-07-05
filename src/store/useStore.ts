import { create } from 'zustand';
import type { Account, Enrollment, FeeRule, FeeSchedule, Product, Execution, BatchChange, BatchJobResult, FeeKey } from '../domain/types';
import { TODAY } from '../domain/types';
import { mockAccounts, mockSchedules, mockRules, mockEnrollments, mockNego, mockQualifyPolicies } from './mock';
import { scopeMatches, isTarget } from '../domain/binding';
import { calcFee } from '../domain/calc';
import { dominates, revalidateDominance } from '../domain/dominance';
import { generateInstruments, NEW_LISTING_POOL } from '../masterdata/instruments';
import type { Instrument } from '../masterdata/instruments';
import { deriveProducts } from '../masterdata/derive';
import { nudgeMetrics } from '../domain/metrics';
import { classifyLifecycle } from '../domain/lifecycle';
import { deriveFeeKey } from '../domain/feeKey';
import { resolve, scopeMatchesKey, type NegoException, type ResolveResult } from '../domain/resolve';
import { classifyNegoExtension, type ExtGroup } from '../domain/negoExtension';
import { buildPolicyPriority, type PolicyPriorityIndex } from '../domain/policyRank';
import { qualifyOf } from '../domain/qualify';
import type { QualifyPolicy, AssetClass, ScopeSelector } from '../domain/types';
import { ResolveCache, type CacheStat } from '../domain/cache';

const MASTER = generateInstruments();
const SYNC_BATCH_SIZE = 5;
const resolveCache = new ResolveCache();

export { evalCondition } from '../domain/eligibility';

interface State {
  accounts: Account[]; instruments: Instrument[]; products: Product[]; schedules: FeeSchedule[];
  rules: FeeRule[]; enrollments: Enrollment[];
  nego: NegoException[];
  qualifyPolicies: QualifyPolicy[];
  syncCursor: number;
  wizardDraft: { form: unknown; step: number } | null;
  reset(): void;
  resolveFee(accountId: string, key: FeeKey): (ResolveResult & { cacheHit: boolean }) | null;
  cacheStat(): CacheStat;
  submitRule(rule: FeeRule, schedule: FeeSchedule): void;
  approveRule(id: string): void;
  rejectRule(id: string, reason: string): void;
  extendNegotiated(id: string, newEndDate: string): void;
  policyPriority(): PolicyPriorityIndex;
  reviewNegoExtension(): ExtGroup[];
  applyNegoExtension(): { summary: string; 유지: number; 탈락: number };
  qualifyStatus(assetClass: AssetClass, accountId: string): { met: boolean; policy: QualifyPolicy | null };
  addSchedule(schedule: FeeSchedule): void;
  submitNegoRequest(input: { accountIds: string[]; scope: ScopeSelector; scheduleId: string; bypass: Record<string, string>; requestedBy: string }): { requestId: string; requested: number };
  approveNegoRequest(requestId: string): { activated: number };
  rejectNegoRequest(requestId: string, reason: string): void;
  setWizardDraft(d: { form: unknown; step: number } | null): void;
  syncFromLedger(): { added: number };
  registerInstruments(rows: Instrument[]): { accepted: number; rejected: string[] };
  batchActivateExpireRules(): BatchJobResult;
  batchRecomputeMetrics(): BatchJobResult;
  batchSyncInstruments(): BatchJobResult;
  batchReresolve(): BatchJobResult;
  batchRevalidateDominance(): BatchJobResult;
}

// '2026-12-31' → '2027-12-31' (Date 객체 금지, 문자열 연도만 +1)
function extendOneYear(dateStr: string): string {
  const [y, ...rest] = dateStr.split('-');
  return [String(Number(y) + 1), ...rest].join('-');
}

export const useStore = create<State>((set) => ({
  accounts: mockAccounts, instruments: MASTER, products: deriveProducts(MASTER), schedules: mockSchedules,
  rules: mockRules, enrollments: mockEnrollments,
  nego: mockNego,
  qualifyPolicies: mockQualifyPolicies,
  syncCursor: 0,
  wizardDraft: null,

  reset: () => set(() => {
    const init = { accounts: mockAccounts, instruments: MASTER, products: deriveProducts(MASTER), schedules: mockSchedules,
      rules: mockRules.map(r => ({ ...r, log: [...r.log] })), enrollments: mockEnrollments };
    resolveCache.clear();
    return { ...init, nego: mockNego, qualifyPolicies: mockQualifyPolicies, syncCursor: 0, wizardDraft: null };
  }),

  resolveFee: (accountId, key) => {
    const s = useStore.getState();
    const acct = s.accounts.find((a) => a.id === accountId);
    if (!acct) return null;
    const hit = resolveCache.get(accountId, key);
    if (hit) return { key, scheduleId: hit.scheduleId, sourceRuleId: hit.sourceRuleId, source: hit.source, candidates: [], cacheHit: true };
    const idx = buildPolicyPriority(s.rules, s.schedules, TODAY);
    const r = resolve(acct, key, s.rules, s.schedules, s.nego, idx, TODAY, s.enrollments);
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
      return { instruments, products, syncCursor: s.syncCursor + batch.length };
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
      return { instruments, products };
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

  approveRule: (id) => {
    let scope: FeeRule['scope'] | null = null;
    set((s) => {
      const rules = s.rules.map((r) => {
        if (r.id !== id) return r;
        scope = r.scope;
        return { ...r, status: '활성' as const, log: [...r.log, `${TODAY} 승인 → 활성`] };
      });
      return { rules };
    });
    // 활성화된 룰의 scope가 해석 결과를 바꿀 수 있으므로 캐시 무효화(안 하면 resolveFee가 stale 응답)
    if (scope) resolveCache.invalidateByScope((k) => scopeMatchesKey(scope!, k));
  },

  rejectRule: (id, reason) => set((s) => ({
    rules: s.rules.map((r) => r.id === id
      ? { ...r, status: '반려' as const, log: [...r.log, `${TODAY} 반려: ${reason}`] } : r),
  })),

  extendNegotiated: (id, newEndDate) => {
    let scope: FeeRule['scope'] | null = null;
    set((s) => {
      const rules = s.rules.map((r) => {
        if (r.id !== id) return r;
        scope = r.scope;
        return { ...r, endDate: newEndDate, log: [...r.log, `${TODAY} 기간 연장 → ${newEndDate}`] };
      });
      return { rules };
    });
    if (scope) resolveCache.invalidateByScope((k) => scopeMatchesKey(scope!, k));
  },

  // 계좌 무관 정책 우선순위(사전 산정) — 룰 변경 때만 재산정하는 정적 최저가 랭킹.
  policyPriority: (): PolicyPriorityIndex => {
    const s = useStore.getState();
    return buildPolicyPriority(s.rules, s.schedules, TODAY);
  },
  // 협의수수료 연장 대상 확인(무변경) — 활성 grant를 상품군 자격 기준으로 재평가해 유지/탈락 그룹 산출.
  reviewNegoExtension: (): ExtGroup[] => {
    const s = useStore.getState();
    return classifyNegoExtension(s.nego, s.accounts, s.qualifyPolicies);
  },
  // 담당자 일괄 승인 — 유지는 연장(유효기간 갱신), 탈락은 해지(반려). 영향 계좌 캐시 무효화.
  applyNegoExtension: (): { summary: string; 유지: number; 탈락: number } => {
    const s0 = useStore.getState();
    const groups = classifyNegoExtension(s0.nego, s0.accounts, s0.qualifyPolicies);
    const keepIds = new Set<string>(); const dropIds = new Set<string>();
    for (const g of groups) for (const c of g.candidates) (c.status === '유지' ? keepIds : dropIds).add(c.accountId);
    set((s) => ({
      nego: s.nego.map((n) => {
        if (n.status !== '활성') return n;
        if (keepIds.has(n.accountId)) return { ...n, validTo: extendOneYear(TODAY) };
        if (dropIds.has(n.accountId)) return { ...n, status: '반려' as const, reason: '연장 자격 미충족' };
        return n;
      }),
    }));
    [...keepIds, ...dropIds].forEach((id) => resolveCache.invalidateAccount(id));
    return { summary: `연장(유지) ${keepIds.size} · 해지(탈락) ${dropIds.size}`, 유지: keepIds.size, 탈락: dropIds.size };
  },

  // 협의 신청 시 계좌의 상품군 표준 자격 충족 여부
  qualifyStatus: (assetClass, accountId): { met: boolean; policy: QualifyPolicy | null } => {
    const s = useStore.getState();
    const acct = s.accounts.find((a) => a.id === accountId);
    if (!acct) return { met: false, policy: null };
    return qualifyOf(s.qualifyPolicies, assetClass, acct);
  },
  // 협의 신청 — 계좌 리스트마다 '요청' 상태 grant 생성(활성 아님 → 해석 무영향). 미충족은 bypass 사유로 '예외'.
  submitNegoRequest: (input): { requestId: string; requested: number } => {
    const s0 = useStore.getState();
    const requestId = `REQ-${TODAY}-${s0.nego.length + 1}`;
    const rows: NegoException[] = input.accountIds.map((id) => {
      const acct = s0.accounts.find((a) => a.id === id);
      const met = acct ? qualifyOf(s0.qualifyPolicies, input.scope.assetClass, acct).met : false;
      return {
        accountId: id, scope: input.scope, scheduleId: input.scheduleId, validFrom: '', validTo: '',
        status: '요청' as const, qualify: met ? '충족' as const : '예외' as const, reason: met ? undefined : input.bypass[id],
        requestId, requestedBy: input.requestedBy, requestedAt: TODAY,
      };
    });
    set((s) => ({ nego: [...s.nego, ...rows] }));
    return { requestId, requested: rows.length };
  },
  // 승인 — 요청 grant를 활성화(유효기간 승인일+1년). 영향 계좌 캐시 무효화.
  approveNegoRequest: (requestId): { activated: number } => {
    let activated = 0;
    set((s) => ({
      nego: s.nego.map((n) => {
        if (n.requestId !== requestId || n.status !== '요청') return n;
        activated += 1;
        return { ...n, status: '활성' as const, validFrom: TODAY, validTo: extendOneYear(TODAY), approvedAt: TODAY };
      }),
    }));
    useStore.getState().nego.filter((n) => n.requestId === requestId).forEach((n) => resolveCache.invalidateAccount(n.accountId));
    return { activated };
  },
  rejectNegoRequest: (requestId, reason) => set((s) => ({
    nego: s.nego.map((n) => n.requestId === requestId && n.status === '요청' ? { ...n, status: '반려' as const, reason } : n),
  })),
  addSchedule: (schedule) => set((s) => ({ schedules: [...s.schedules.filter((x) => x.id !== schedule.id), schedule] })),

  setWizardDraft: (d) => set({ wizardDraft: d }),

  batchActivateExpireRules: () => {
    const changes: BatchChange[] = [];
    const changedRules: FeeRule[] = [];
    set((s) => {
      const rules = s.rules.map((r) => {
        const c = classifyLifecycle(r, TODAY);
        if (c === 'activate') { changes.push({ label: r.id, detail: `발효: 승인대기 → 활성 (${r.name})` });
          const next = { ...r, status: '활성' as const, log: [...r.log, `${TODAY} 발효(배치) → 활성`] };
          changedRules.push(next);
          return next; }
        if (c === 'expire') { changes.push({ label: r.id, detail: `만료: 활성 → 종료 (${r.name})` });
          const next = { ...r, status: '종료' as const, log: [...r.log, `${TODAY} 만료(배치) → 종료`] };
          changedRules.push(next);
          return next; }
        return r;
      });
      return { rules };   // 전량 재해석 안 함 — 변경 룰 scope만 캐시 무효화
    });
    let invalidated = 0;
    for (const r of changedRules) invalidated += resolveCache.invalidateByScope((k) => scopeMatchesKey(r.scope, k));
    const act = changes.filter(c => c.detail.startsWith('발효')).length;
    const exp = changes.filter(c => c.detail.startsWith('만료')).length;
    return { summary: `발효 ${act} · 만료 ${exp} · 캐시무효화 ${invalidated}`, changes };
  },

  batchRecomputeMetrics: () => {
    const changes: BatchChange[] = [];
    let invalidatedAccounts = 0;
    set((s) => {
      const accounts = s.accounts.map((a) => {
        const n = nudgeMetrics(a);
        if (n.metric6mAsset !== a.metric6mAsset) {
          changes.push({ label: a.id,
            detail: `6개월평균자산 ${a.metric6mAsset.toLocaleString()} → ${n.metric6mAsset.toLocaleString()}` });
          resolveCache.invalidateAccount(a.id);
          invalidatedAccounts++;
        }
        return { ...a, ...n };
      });
      return { accounts };
    });
    return { summary: `지표변경 ${changes.length} · 캐시무효화 ${invalidatedAccounts}계좌`, changes };
  },

  batchSyncInstruments: () => {
    let added = 0; const changes: BatchChange[] = [];
    set((s) => {
      const batch = NEW_LISTING_POOL.slice(s.syncCursor, s.syncCursor + SYNC_BATCH_SIZE);
      added = batch.length;
      if (batch.length === 0) return {};
      batch.forEach((i) => changes.push({ label: i.code, detail: `신규 상장: ${i.name} (${i.exchange})` }));
      const instruments = [...s.instruments, ...batch];
      return { instruments, products: deriveProducts(instruments), syncCursor: s.syncCursor + batch.length }; // 재해석 안 함(신규 품목은 캐시에 없음)
    });
    return { summary: `신규 품목 ${added}`, changes };
  },


  batchReresolve: (): BatchJobResult => {
    const s = useStore.getState();
    const sample = s.products.find((p) => p.assetClass === '해외주식');   // 대표 해외주식 품목으로 캐스케이드 가시화
    const changes: BatchChange[] = [];
    if (sample) for (const a of s.accounts) {
      const r = s.resolveFee(a.id, deriveFeeKey(sample, '정규', 'MTS'));
      if (r) changes.push({ label: `${a.id} ${sample.exchange}:${sample.code}`, detail: `${r.source} (${r.scheduleId})` });
    }
    return { summary: `재해석 ${changes.length} · 캐시 ${s.cacheStat().size}건`, changes };
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

useStore.getState().reset(); // 초기 상태 세팅 + 캐시 클리어
