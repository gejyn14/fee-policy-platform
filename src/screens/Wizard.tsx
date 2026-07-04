import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { calcFee } from '../domain/calc';
import { explainDominanceFailure, type DominanceFailure } from '../domain/dominance';
import { scopeMatches, isTarget } from '../domain/binding';
import { buildFeeKey, isDerivative } from '../domain/feeKey';
import { scopeMatchesKey } from '../domain/resolve';
import { TODAY } from '../domain/types';
import { ruleTypeLabel } from './labels';
import InstrumentPicker from './InstrumentPicker';
import { parseCsvCodes, summarize, type Selection } from './pickerLogic';
import type {
  ApplyMode, AssetClass, BenefitPeriod, Channel, Execution, FeeComponent, FeeKey, FeeRule, FeeSchedule,
  NegotiatedCondition, Payer, Product, RateBand, ScopeSelector, Session,
} from '../domain/types';

// ---------------------------------------------------------------------------
// 순수 헬퍼
// ---------------------------------------------------------------------------
// parseCsvCodes는 InstrumentPicker(./pickerLogic)로 이관되었다 — 위저드는 계좌 CSV
// 파싱에만 그 함수를 재사용한다(로직 자체는 그대로, 소유권만 픽커로 이동).

// 세션은 v0.5의 고정 차원 {프리·정규·애프터}다 — 종목 마스터의 거래시간(정규/야간/프리마켓 등)에서
// 유도하지 않는다. feeKey.session이 이 3값이므로 위저드도 이 3값을 그대로 제시한다.
const SESSION_DIM: Session[] = ['프리', '정규', '애프터'];

// 상품군별 거래소 옵션 — 주식형(국내주식/해외주식)의 거래소 체크박스에 쓰인다.
// 통화는 v0.2부터 위저드에서 다루지 않는다(스코프는 항상 '*').
function optionsForAssetClass(products: Product[], ac: AssetClass) {
  const inClass = products.filter((p) => p.assetClass === ac);
  const exchanges = [...new Set(inClass.map((p) => p.exchange))];
  return { exchanges, sessions: SESSION_DIM as string[] };
}

const emptySelection = (): Selection => ({ products: '*', excludeProducts: [], exchanges: '*' });

const sampleFor = (p: Product) => (price: number): Execution =>
  ({ accountId: 'SIM', product: p, session: p.sessions[0], price, qty: 10, notional: price * 10 });

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const ASSET_CLASSES: AssetClass[] = ['국내주식', '해외주식', '국내파생', '해외파생', '금현물'];
const CHANNELS: Channel[] = ['HTS', 'MTS', 'API', 'ARS', '센터', '반대매매'];
const APPLY_MODES: ApplyMode[] = ['신청형', '가입형', '휴면복귀형', '타겟추출형'];
const KINDS: FeeComponent['kind'][] = ['자사', '유관기관', '세금'];
const PAYERS: Payer[] = ['고객부과', '회사부담', '면제'];
const RATE_TYPES: FeeComponent['rateType'][] = ['정률', '정액', '구간표'];
const METRICS: NegotiatedCondition['metric'][] = ['6개월평균자산', '6개월약정액'];
const ACTIONS: NegotiatedCondition['action'][] = ['자동연장', '승인후연장'];
const STEP_LABELS = ['기본정보', '적용범위', '요율표', '대상', '시뮬레이션', '상신'];
const STEP5_DISPLAY_CAP = 50;

// 시뮬레이션 단위 행 — 파생은 품목, 주식은 feeKey 구간(거래소·세션·채널).
type SimRow = { key: string; label: string; current: number | null; next: number };

// ---------------------------------------------------------------------------
// 폼 상태
// ---------------------------------------------------------------------------

interface WizardForm {
  name: string;
  type: 'EVENT' | 'NEGOTIATED';
  applyMode: ApplyMode;
  startDate: string;
  endDate: string;
  condMetric: NegotiatedCondition['metric'];
  condThreshold: number;
  condAction: NegotiatedCondition['action'];

  benefitKind: '캘린더' | '상대';   // 적용기간 유형
  benefitMonths: number;            // 상대일 때 개월 수

  assetClass: AssetClass;
  exchangesSel: string[];       // 국내주식 전용(KRX/NXT 체크박스) — 그 외 상품군은 미사용(picker가 selection.exchanges로 처리)
  sessionsSel: string[];
  channelsSel: Channel[];       // 채널 축(HTS/MTS/API/ARS/센터/반대매매) — 전 상품군 공통, additive
  selection: Selection;        // 픽커(InstrumentPicker) 선택 상태 — products/excludeProducts/exchanges

  copyScheduleId: string;
  components: FeeComponent[];

  targetMode: 'all' | 'accounts';
  accountsCsvText: string;
}

function makeInitialForm(products: Product[]): WizardForm {
  const assetClass: AssetClass = ASSET_CLASSES[0];
  const { exchanges, sessions } = optionsForAssetClass(products, assetClass);
  return {
    name: '', type: 'EVENT', applyMode: '타겟추출형',
    startDate: TODAY, endDate: '2026-12-31',
    condMetric: '6개월평균자산', condThreshold: 500_000_000, condAction: '승인후연장',
    benefitKind: '캘린더', benefitMonths: 2,
    assetClass,
    exchangesSel: exchanges, sessionsSel: sessions,
    channelsSel: [...CHANNELS],
    selection: emptySelection(),
    copyScheduleId: '',
    components: [{ name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 10 }],
    targetMode: 'all', accountsCsvText: '',
  };
}

// ---------------------------------------------------------------------------
// 위저드
// ---------------------------------------------------------------------------

export default function Wizard() {
  const { products, schedules, rules, accounts, enrollments, submitRule, setWizardDraft } = useStore();
  // 마운트 시 1회만 draft를 읽어 로컬 상태를 초기화한다 (렌더마다 재구독하지 않음 — 루프 방지).
  const [step, setStep] = useState<number>(() => useStore.getState().wizardDraft?.step ?? 1);
  const [form, setForm] = useState<WizardForm>(() => {
    const draft = useStore.getState().wizardDraft;
    return draft ? (draft.form as WizardForm) : makeInitialForm(products);
  });
  const [done, setDone] = useState(false);
  // handleReset이 setWizardDraft(null)을 호출한 직후 form/step을 초기값으로 되돌리면
  // 아래 동기화 effect가 재실행되어 null을 다시 { form, step }으로 덮어써 버린다.
  // 이 ref는 그 1회 재실행만 건너뛰게 해 리셋 직후 draft가 null로 유지되도록 한다.
  const skipNextSync = useRef(false);

  // 로컬 상태 → draft 단방향 동기화. wizardDraft는 의존성에 넣지 않는다(넣으면
  // draft 변경이 이 effect를 재실행시켜 다시 draft를 쓰는 무한 루프가 될 수 있음).
  useEffect(() => {
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    setWizardDraft({ form, step });
  }, [form, step]);

  const update = (patch: Partial<WizardForm>) => setForm((f) => ({ ...f, ...patch }));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const toggleChannel = (list: Channel[], v: Channel) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  // 차원 관련성 매트릭스(v0.5): 주식은 품목(종목) 차원이 붕괴되므로 종목을 고르지 않는다.
  // - 국내주식/해외주식: 거래소가 "선택 차원"(체크박스). 품목 픽커 없음.
  // - 국내파생/해외파생: 품목 픽커로 종목을 고르고, 거래소는 품목의 속성으로 따라온다.
  // - 금현물: 거래소 KRX 고정·세션 숨김(정규), 품목 픽커도 없음(주식형).
  const derivative = isDerivative(form.assetClass);
  const { exchanges, sessions } = optionsForAssetClass(products, form.assetClass);
  const showProductPicker = derivative;                              // 파생만 종목 선택
  const showExchangeCheckboxes = form.assetClass === '국내주식' || form.assetClass === '해외주식';
  const showSessionCheckboxes = form.assetClass !== '금현물'; // 금현물은 세션도 숨김(정규만 존재)

  const showTrigger = form.applyMode !== '타겟추출형';
  const accountsParsed = !showTrigger && form.targetMode === 'accounts'
    ? parseCsvCodes(form.accountsCsvText, new Set(accounts.map((a) => a.id)))
    : { accepted: [] as string[], rejected: [] as string[] };

  function handleAssetClassChange(ac: AssetClass) {
    // 상품군이 바뀌면 scope 관련 폼(거래소/세션/선택)을 전부 새 상품군 기준으로 초기화한다.
    const opt = optionsForAssetClass(products, ac);
    update({
      assetClass: ac, exchangesSel: opt.exchanges, sessionsSel: opt.sessions,
      selection: emptySelection(),
    });
  }

  // 적용기간(혜택 기간). 타겟추출형은 신청 개념이 없어 항상 캘린더.
  function buildBenefit(): BenefitPeriod {
    return (form.applyMode !== '타겟추출형' && form.benefitKind === '상대')
      ? { kind: '상대', months: form.benefitMonths }
      : { kind: '캘린더' };
  }

  function buildScope(): ScopeSelector {
    // 국내주식: 거래소는 위저드 체크박스(KRX/NXT)가 결정. 그 외 상품군: 픽커의 selection.exchanges
    // (전체선택 시 특정 거래소로, 개별 선택 시 '*'로 유지)가 결정.
    const scopeExchanges = showExchangeCheckboxes
      ? (form.exchangesSel.length === exchanges.length ? '*' : form.exchangesSel)
      : form.selection.exchanges;
    return {
      assetClass: form.assetClass,
      exchanges: scopeExchanges,
      sessions: form.sessionsSel.length === sessions.length ? '*' : form.sessionsSel,
      currencies: '*', // v0 결정: 통화는 위저드 차원이 아니라 요율표(schedule) 차원 — 항상 전체
      products: form.selection.products,
      excludeProducts: form.selection.excludeProducts,
      // 채널 축(additive): 전체선택 또는 미선택(0개)이면 '*'(전체), 일부만 선택했으면 선택된 배열.
      channels: (form.channelsSel.length === 0 || form.channelsSel.length === CHANNELS.length)
        ? '*' : form.channelsSel,
    };
  }

  function handleCopySchedule(id: string) {
    const src = schedules.find((s) => s.id === id);
    update({
      copyScheduleId: id,
      components: src ? (JSON.parse(JSON.stringify(src.components)) as FeeComponent[]) : form.components,
    });
  }

  function updateComponent(idx: number, patch: Partial<FeeComponent>) {
    update({ components: form.components.map((c, i) => (i === idx ? { ...c, ...patch } : c)) });
  }
  function addComponent() {
    update({ components: [...form.components, { name: '', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 0 }] });
  }
  function removeComponent(idx: number) {
    update({ components: form.components.filter((_, i) => i !== idx) });
  }
  function addBand(idx: number) {
    const bands: RateBand[] = [...(form.components[idx].bands ?? []), { from: 0, to: null, rateBp: 0 }];
    updateComponent(idx, { bands });
  }
  function updateBand(idx: number, bandIdx: number, patch: Partial<RateBand>) {
    const bands = (form.components[idx].bands ?? []).map((b, i) => (i === bandIdx ? { ...b, ...patch } : b));
    updateComponent(idx, { bands });
  }
  function removeBand(idx: number, bandIdx: number) {
    const bands = (form.components[idx].bands ?? []).filter((_, i) => i !== bandIdx);
    updateComponent(idx, { bands });
  }

  // computeSimulation은 매 렌더/키입력마다 전체 상품 목록을 scopeMatches로 훑고 지배관계
  // 검사까지 수행하므로 비용이 크다 — 실제 입력(form/products/rules/schedules/accounts/
  // enrollments)이 바뀔 때만 재계산되도록 useMemo로 감싼다. 게이트(canProceed5 = sim.dominanceOk)와
  // draft 동기화 effect(deps: [form, step])는 이 메모의 영향을 받지 않는다 — sim은 파생 값일 뿐
  // 별도 state를 쓰지 않는다.
  const sim = useMemo(() => {
    const scope = buildScope();
    const schedule: FeeSchedule = { id: 'PREVIEW', name: form.name || '(임시)', components: form.components };
    const derivativeLocal = isDerivative(form.assetClass);
    const activeRules = rules.filter((r) => r.status === '활성');

    // 대상 계좌(트리거/전체/명시) — 상품군 무관
    const previewRule: FeeRule = {
      id: 'PREVIEW', name: form.name, type: form.type, status: '활성', applyMode: form.applyMode,
      startDate: form.startDate, endDate: form.endDate, benefit: buildBenefit(), scope, scheduleId: 'PREVIEW',
      targetAccountIds: !showTrigger && form.targetMode === 'accounts' ? accountsParsed.accepted : undefined,
      warnings: { dominance: true, reverseMargin: false }, createdBy: '', log: [],
    };
    const targets = accounts.filter((a) => isTarget(previewRule, a, enrollments));
    const empty = {
      targets, matchedCount: 0, unitNoun: derivativeLocal ? '품목' : 'feeKey 구간',
      unitSamples: [] as string[], rows: [] as SimRow[],
      dominanceFailures: [] as string[], dominanceOk: true, reverseMargin: false,
    };

    if (derivativeLocal) {
      // 파생: feeKey에 품목이 남으므로 종목 단위로 시뮬레이션.
      const targetProducts = products.filter((p) => scopeMatches(scope, p));
      if (targetProducts.length === 0) return empty;
      const incumbents = activeRules.filter((r) => targetProducts.some((p) => scopeMatches(r.scope, p)));
      const dominanceFailures: string[] = [];
      for (const inc of incumbents) {
        const incSched = schedules.find((x) => x.id === inc.scheduleId);
        if (!incSched) continue;
        // 동일 (기존룰, price) 조합에서 실패한 품목은 품목명을 콤마로 묶어 1줄로 그룹핑한다.
        const groups = new Map<number, { fail: DominanceFailure; names: string[] }>();
        for (const p of targetProducts) {
          const fail = explainDominanceFailure(schedule, incSched, sampleFor(p));
          if (!fail) continue;
          const g = groups.get(fail.price);
          if (g) g.names.push(`${p.name}(${p.code})`);
          else groups.set(fail.price, { fail, names: [`${p.name}(${p.code})`] });
        }
        for (const { fail, names } of groups.values())
          dominanceFailures.push(`${names.join(', ')}: 가격 ${fail.price}에서 신규 ${fail.candidateFee.toLocaleString()}원 > 기존 '${inc.name}' ${fail.incumbentFee.toLocaleString()}원`);
      }
      const probe = calcFee(schedule, sampleFor(targetProducts[0])(100));
      const ownReceived = probe.lines.filter((l) => l.kind === '자사' && l.payer === '고객부과').reduce((a, l) => a + l.amount, 0);
      const rows: SimRow[] = targetProducts.map((p) => {
        const matching = incumbents.filter((r) => scopeMatches(r.scope, p));
        let current: number | null = null;
        for (const inc of matching) {
          const incSched = schedules.find((x) => x.id === inc.scheduleId);
          if (incSched) { const fee = calcFee(incSched, sampleFor(p)(100)).customerTotal; current = current === null ? fee : Math.min(current, fee); }
        }
        return { key: `${p.exchange}:${p.code}`, label: `${p.code} (${p.name})`, current, next: calcFee(schedule, sampleFor(p)(100)).customerTotal };
      });
      return {
        targets, matchedCount: targetProducts.length, unitNoun: '품목',
        unitSamples: targetProducts.map((p) => `${p.code}(${p.name})`), rows,
        dominanceFailures, dominanceOk: dominanceFailures.length === 0, reverseMargin: probe.companyBorne > ownReceived,
      };
    }

    // 주식형: 품목 붕괴 → feeKey(거래소×세션×채널) 단위로 시뮬레이션(종목 전개 없음).
    const exAll = [...new Set(products.filter((p) => p.assetClass === form.assetClass).map((p) => p.exchange))];
    const exList = scope.exchanges === '*' ? exAll : scope.exchanges;
    const seList = (scope.sessions === '*' ? SESSION_DIM : scope.sessions) as Session[];
    const chList = ((scope.channels ?? '*') === '*' ? CHANNELS : scope.channels) as Channel[];
    if (exList.length === 0) return empty;

    // calcFee는 품목·세션·채널을 안 쓰므로 대표 execution 하나면 충분(product-independent).
    const rep: Product = { assetClass: form.assetClass, exchange: exList[0], code: '(전체)', name: '대표', currency: form.assetClass.startsWith('해외') ? 'USD' : 'KRW', sessions: [seList[0] ?? '정규'] };
    const sampleAt = (price: number): Execution => ({ accountId: 'SIM', product: rep, session: seList[0] ?? '정규', price, qty: 10, notional: price * 10 });
    const probe = calcFee(schedule, sampleAt(100));
    const ownReceived = probe.lines.filter((l) => l.kind === '자사' && l.payer === '고객부과').reduce((a, l) => a + l.amount, 0);
    const nextFee = probe.customerTotal;

    const feeKeys: FeeKey[] = [];
    for (const ex of exList) for (const se of seList) for (const ch of chList) feeKeys.push(buildFeeKey(form.assetClass, ex, se, ch));

    // 지배관계: feeKey들에 겹치는 활성 룰의 합집합에 대해 1회씩 검사.
    const incMap = new Map<string, FeeRule>();
    for (const fk of feeKeys) for (const r of activeRules) if (scopeMatchesKey(r.scope, fk)) incMap.set(r.id, r);
    const dominanceFailures: string[] = [];
    for (const inc of incMap.values()) {
      const incSched = schedules.find((x) => x.id === inc.scheduleId);
      if (!incSched) continue;
      const fail = explainDominanceFailure(schedule, incSched, sampleAt);
      if (fail) dominanceFailures.push(`가격 ${fail.price}에서 신규 ${fail.candidateFee.toLocaleString()}원 > 기존 '${inc.name}' ${fail.incumbentFee.toLocaleString()}원`);
    }

    // 표: feeKey 구간을 (겹치는 활성 룰 집합 + 현행 최저요율)이 같은 것끼리 묶어 요약 1줄로.
    const groups = new Map<string, { exs: Set<string>; ses: Set<string>; chs: Set<string>; current: number | null }>();
    for (const fk of feeKeys) {
      const matching = activeRules.filter((r) => scopeMatchesKey(r.scope, fk));
      let current: number | null = null;
      for (const inc of matching) {
        const incSched = schedules.find((x) => x.id === inc.scheduleId);
        if (incSched) { const fee = calcFee(incSched, sampleAt(100)).customerTotal; current = current === null ? fee : Math.min(current, fee); }
      }
      const sig = matching.map((r) => r.id).sort().join(',') + '|' + current;
      const g = groups.get(sig) ?? { exs: new Set<string>(), ses: new Set<string>(), chs: new Set<string>(), current };
      g.exs.add(fk.exchange); g.ses.add(fk.session); g.chs.add(fk.channel);
      groups.set(sig, g);
    }
    const dim = (set: Set<string>, full: number, word: string) => set.size >= full ? word : [...set].join('·');
    const rows: SimRow[] = [...groups.entries()].map(([sig, g]) => ({
      key: sig,
      label: `${dim(g.exs, exAll.length, '전 거래소')} · ${dim(g.ses, SESSION_DIM.length, '전 세션')} · ${dim(g.chs, CHANNELS.length, '전 채널')}`,
      current: g.current, next: nextFee,
    }));
    return {
      targets, matchedCount: feeKeys.length, unitNoun: 'feeKey 구간',
      unitSamples: rows.map((r) => r.label), rows,
      dominanceFailures, dominanceOk: dominanceFailures.length === 0, reverseMargin: probe.companyBorne > ownReceived,
    };
  }, [form, products, rules, schedules, accounts, enrollments]);
  // 2단계 게이트용 매칭 수 — 파생=품목 수, 주식=feeKey 구간 수.
  const matchedProductCount = sim.matchedCount;

  const canProceed1 = form.name.trim() !== '' && form.startDate <= form.endDate &&
    (form.type !== 'NEGOTIATED' || form.condThreshold > 0);
  const canProceed2 = matchedProductCount > 0 &&
    (!showSessionCheckboxes || form.sessionsSel.length > 0) &&
    (!showExchangeCheckboxes || form.exchangesSel.length > 0);
  const canProceed3 = form.components.length > 0 && form.components.every((c) => c.name.trim() !== '');
  const canProceed4 = showTrigger || form.targetMode === 'all' || accountsParsed.accepted.length > 0;
  const canProceed5 = sim.dominanceOk;
  const canProceedMap: Record<number, boolean> = { 1: canProceed1, 2: canProceed2, 3: canProceed3, 4: canProceed4, 5: canProceed5, 6: true };

  function goNext() { setStep((s) => Math.min(6, s + 1)); }
  function goPrev() { setStep((s) => Math.max(1, s - 1)); }

  function handleSubmit() {
    const now = Date.now();
    const scheduleId = `S-${now}`;
    const ruleId = `R-${now}`;
    const schedule: FeeSchedule = { id: scheduleId, name: `${form.name} 요율표`, components: form.components };
    const condition: NegotiatedCondition | undefined = form.type === 'NEGOTIATED'
      ? { metric: form.condMetric, threshold: form.condThreshold, action: form.condAction }
      : undefined;
    const targetAccountIds = !showTrigger && form.targetMode === 'accounts' ? accountsParsed.accepted : undefined;
    const rule: FeeRule = {
      id: ruleId, name: form.name, type: form.type, status: '기안', applyMode: form.applyMode,
      startDate: form.startDate, endDate: form.endDate, benefit: buildBenefit(),
      scope: buildScope(), scheduleId,
      condition, targetAccountIds,
      warnings: { dominance: true, reverseMargin: false },
      createdBy: '현업담당자', log: [],
    };
    submitRule(rule, schedule);
    setWizardDraft(null);
    setDone(true);
  }

  function handleReset() {
    skipNextSync.current = true;
    setForm(makeInitialForm(products));
    setStep(1);
    setDone(false);
    setWizardDraft(null);
  }

  // -------------------------------------------------------------------------
  // 단계별 렌더
  // -------------------------------------------------------------------------

  function renderStep1() {
    return (
      <div className="stack">
        <div className="form-grid">
          <div className="field">
            <label>이름</label>
            <input value={form.name} onChange={(e) => update({ name: e.target.value })}
              placeholder="예: 2026 가을 해외파생 수수료 인하 이벤트" />
          </div>
          <div className="field">
            <label>유형</label>
            <select value={form.type} onChange={(e) => update({ type: e.target.value as WizardForm['type'] })}>
              <option value="EVENT">{ruleTypeLabel('EVENT')}</option>
              <option value="NEGOTIATED">{ruleTypeLabel('NEGOTIATED')}</option>
            </select>
          </div>
          <div className="field">
            <label>적용형태</label>
            <select value={form.applyMode} onChange={(e) => update({ applyMode: e.target.value as ApplyMode })}>
              {APPLY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label>상품군</label>
            <select value={form.assetClass} onChange={(e) => handleAssetClassChange(e.target.value as AssetClass)}>
              {ASSET_CLASSES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{form.applyMode === '타겟추출형' ? '시작일' : '신청 가능 시작'}</label>
            <input type="date" value={form.startDate} onChange={(e) => update({ startDate: e.target.value })} />
          </div>
          <div className="field">
            <label>{form.applyMode === '타겟추출형' ? '종료일' : '신청 가능 종료'}</label>
            <input type="date" value={form.endDate} onChange={(e) => update({ endDate: e.target.value })} />
          </div>
        </div>
        {form.applyMode !== '타겟추출형' && (
          <div className="form-grid">
            <div className="field">
              <label>적용기간 유형</label>
              <select value={form.benefitKind} onChange={(e) => update({ benefitKind: e.target.value as '캘린더' | '상대' })}>
                <option value="캘린더">캘린더 고정(신청 가능기간 종료까지)</option>
                <option value="상대">유입시점 상대(가입일 +N개월)</option>
              </select>
            </div>
            {form.benefitKind === '상대' && (
              <div className="field">
                <label>혜택 개월(가입일 기준)</label>
                <input type="number" min={1} value={form.benefitMonths}
                  onChange={(e) => update({ benefitMonths: Math.max(1, Number(e.target.value)) })} />
              </div>
            )}
          </div>
        )}
        {form.type === 'NEGOTIATED' && (
          <div className="form-grid">
            <div className="field">
              <label>지표</label>
              <select value={form.condMetric} onChange={(e) => update({ condMetric: e.target.value as NegotiatedCondition['metric'] })}>
                {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="field">
              <label>임계값</label>
              <input type="number" value={form.condThreshold} onChange={(e) => update({ condThreshold: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>액션</label>
              <select value={form.condAction} onChange={(e) => update({ condAction: e.target.value as NegotiatedCondition['action'] })}>
                {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
        )}
        {!canProceed1 && (
          <p className="warn">
            이름을 입력하고, 종료일이 시작일 이후인지 확인하세요.
            {form.type === 'NEGOTIATED' ? ' (협의 임계값은 0보다 커야 합니다)' : ''}
          </p>
        )}
      </div>
    );
  }

  function renderStep2() {
    // 차원 관련성 매트릭스(스펙 §1.1): 상품군에 따라 거래소/세션 체크박스 노출 여부가 다르다.
    // 국내주식=거래소(KRX/NXT)+세션 / 해외주식·해외파생=세션만(거래소는 픽커 내부) /
    // 국내파생=세션만(거래소 숨김, KRX 고정) / 금현물=둘 다 숨김(픽커만).
    return (
      <div className="stack">
        {showExchangeCheckboxes && (
          <div className="field">
            <label>거래소</label>
            <div className="check-grid">
              {exchanges.map((ex) => (
                <label key={ex} className="check-item">
                  <input type="checkbox" checked={form.exchangesSel.includes(ex)}
                    onChange={() => update({ exchangesSel: toggle(form.exchangesSel, ex) })} />
                  {ex}
                </label>
              ))}
            </div>
          </div>
        )}

        {showSessionCheckboxes && (
          <div className="field">
            <label>세션</label>
            <div className="check-grid">
              {sessions.map((s) => (
                <label key={s} className="check-item">
                  <input type="checkbox" checked={form.sessionsSel.includes(s)}
                    onChange={() => update({ sessionsSel: toggle(form.sessionsSel, s) })} />
                  {s}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label>채널</label>
          <div className="check-grid">
            {CHANNELS.map((ch) => (
              <label key={ch} className="check-item">
                <input type="checkbox" checked={form.channelsSel.includes(ch)}
                  onChange={() => update({ channelsSel: toggleChannel(form.channelsSel, ch) })} />
                {ch}
              </label>
            ))}
          </div>
        </div>

        {showProductPicker ? (
          <div className="field">
            <label>품목 선택</label>
            <InstrumentPicker
              assetClass={form.assetClass}
              value={form.selection}
              onChange={(selection) => update({ selection })}
            />
          </div>
        ) : (
          <p className="trace-narration">주식은 종목 차원이 없다 — 이 룰은 거래소·세션·채널로만 해석되어 해당 조건의 전 종목에 적용된다.</p>
        )}

        <p className={matchedProductCount === 0 ? 'warn' : undefined}>
          {showProductPicker ? `적용 종목 ${matchedProductCount}개` : `적용 대상 ${matchedProductCount}개 구간(거래소×세션×채널)`}
        </p>
        {showProductPicker && matchedProductCount === 0 && (
          <p className="warn">선택/제외 조건으로 매칭되는 품목이 없습니다.</p>
        )}
        {showExchangeCheckboxes && form.exchangesSel.length === 0 && (
          <p className="warn">거래소를 최소 1개 이상 선택해야 합니다.</p>
        )}
        {showSessionCheckboxes && form.sessionsSel.length === 0 && (
          <p className="warn">세션을 최소 1개 이상 선택해야 합니다.</p>
        )}
      </div>
    );
  }

  function renderStep3() {
    return (
      <div className="stack">
        <div className="field">
          <label>기존 요율표 복사</label>
          <select value={form.copyScheduleId} onChange={(e) => handleCopySchedule(e.target.value)}>
            <option value="">(선택 안 함)</option>
            {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <table>
          <thead>
            <tr><th>이름</th><th>종류</th><th>부담주체</th><th>방식</th><th>값</th><th>최소수수료</th><th></th></tr>
          </thead>
          <tbody>
            {form.components.map((c, idx) => (
              <Fragment key={idx}>
                <tr>
                  <td><input value={c.name} onChange={(e) => updateComponent(idx, { name: e.target.value })} /></td>
                  <td>
                    <select value={c.kind} onChange={(e) => updateComponent(idx, { kind: e.target.value as FeeComponent['kind'] })}>
                      {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={c.payer} onChange={(e) => updateComponent(idx, { payer: e.target.value as Payer })}>
                      {PAYERS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={c.rateType} onChange={(e) => updateComponent(idx, { rateType: e.target.value as FeeComponent['rateType'] })}>
                      {RATE_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>
                    {c.rateType === '정률' && (
                      <>
                        <input type="number" value={c.rateBp ?? 0}
                          onChange={(e) => updateComponent(idx, { rateBp: Number(e.target.value) })} placeholder="bp" />
                        <span className="unit-suffix">bp</span>
                      </>
                    )}
                    {c.rateType === '정액' && (
                      <>
                        <input type="number" value={c.flatAmount ?? 0}
                          onChange={(e) => updateComponent(idx, { flatAmount: Number(e.target.value) })} placeholder="원" />
                        <span className="unit-suffix">원/계약</span>
                      </>
                    )}
                    {c.rateType === '구간표' && <span className="pill">아래 구간표 참조</span>}
                  </td>
                  <td>
                    <input type="number" value={c.minFee ?? ''}
                      onChange={(e) => updateComponent(idx, { minFee: e.target.value === '' ? undefined : Number(e.target.value) })}
                      placeholder="선택" />
                    <span className="unit-suffix">원</span>
                  </td>
                  <td><button className="btn danger" type="button" onClick={() => removeComponent(idx)}>삭제</button></td>
                </tr>
                {c.rateType === '구간표' && (
                  <tr>
                    <td colSpan={7}>
                      <table>
                        <thead><tr><th>from</th><th>to (빈칸=무한대)</th><th>rateBp</th><th>flat</th><th></th></tr></thead>
                        <tbody>
                          {(c.bands ?? []).map((b, bi) => (
                            <tr key={bi}>
                              <td><input type="number" value={b.from} onChange={(e) => updateBand(idx, bi, { from: Number(e.target.value) })} /></td>
                              <td><input type="number" value={b.to ?? ''} onChange={(e) => updateBand(idx, bi, { to: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                              <td><input type="number" value={b.rateBp ?? ''} onChange={(e) => updateBand(idx, bi, { rateBp: e.target.value === '' ? undefined : Number(e.target.value) })} /></td>
                              <td><input type="number" value={b.flat ?? ''} onChange={(e) => updateBand(idx, bi, { flat: e.target.value === '' ? undefined : Number(e.target.value) })} /></td>
                              <td><button className="btn danger" type="button" onClick={() => removeBand(idx, bi)}>삭제</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button className="btn" type="button" onClick={() => addBand(idx)}>+ 구간 추가</button>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        <button className="btn" type="button" onClick={addComponent}>+ 구성요소 추가</button>
        {!canProceed3 && <p className="warn">구성요소를 최소 1개 이상 입력하고, 이름을 채워주세요.</p>}
      </div>
    );
  }

  function renderStep4() {
    return (
      <div className="stack">
        {showTrigger ? (
          <div className="card">
            <p>이 적용형태({form.applyMode})는 트리거 기반으로 자동 대상이 결정됩니다. 신청/가입/휴면복귀 이벤트 발생 시 개별 계좌가 자동으로 편입됩니다.</p>
          </div>
        ) : (
          <div className="stack">
            <div className="radio-row">
              <label><input type="radio" checked={form.targetMode === 'all'} onChange={() => update({ targetMode: 'all' })} /> 전체 계좌</label>
              <label><input type="radio" checked={form.targetMode === 'accounts'} onChange={() => update({ targetMode: 'accounts' })} /> 계좌 리스트 지정</label>
            </div>
            {form.targetMode === 'accounts' && (
              <div className="field">
                <label>계좌번호 붙여넣기 (프로토타입: CSV)</label>
                <textarea rows={4} value={form.accountsCsvText} onChange={(e) => update({ accountsCsvText: e.target.value })}
                  placeholder="예: 110000001001, 110000001002" />
                <p>인식된 계좌 {accountsParsed.accepted.length}건</p>
                {accountsParsed.rejected.length > 0 && <p className="warn">무시된 계좌번호: {accountsParsed.rejected.join(', ')}</p>}
              </div>
            )}
          </div>
        )}
        {!canProceed4 && <p className="warn">계좌 리스트를 선택했다면 최소 1개 이상의 유효한 계좌번호가 필요합니다.</p>}
      </div>
    );
  }

  function renderStep5() {
    return (
      <div className="stack">
        <div className="cards">
          <div className="card"><h3>{sim.targets.length}</h3><p>대상 계좌 수</p></div>
          <div className="card"><h3>{sim.matchedCount}</h3><p>{sim.unitNoun === '품목' ? '매칭 품목 수' : '적용 feeKey 구간 수'}</p></div>
          <div className={sim.reverseMargin ? 'card warn' : 'card'}><h3>{sim.reverseMargin ? '예' : '아니오'}</h3><p>역마진 여부</p></div>
        </div>

        <h2>{sim.unitNoun === '품목' ? '매칭 품목' : '적용 구간 (거래소·세션·채널)'}</h2>
        {sim.unitSamples.length === 0
          ? <p className="empty">적용 대상이 없습니다. 적용범위를 다시 확인하세요.</p>
          : (
            <p>
              {sim.unitSamples.slice(0, STEP5_DISPLAY_CAP).join(', ')}
              {sim.unitSamples.length > STEP5_DISPLAY_CAP && ` 외 ${sim.unitSamples.length - STEP5_DISPLAY_CAP}건`}
            </p>
          )}

        <h2>표본 체결 기준 수수료 비교 (가격 100, 수량 10)</h2>
        {sim.rows.length === 0 ? <p className="empty">비교할 대상이 없습니다.</p> : (
          <>
            <table>
              <thead><tr><th>{sim.unitNoun === '품목' ? '품목' : '구간(거래소·세션·채널)'}</th><th>현행 고객부담</th><th>신규 고객부담</th><th>차이</th></tr></thead>
              <tbody>
                {sim.rows.slice(0, STEP5_DISPLAY_CAP).map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td>{r.current === null ? '해당없음' : r.current.toLocaleString()}</td>
                    <td>{r.next.toLocaleString()}</td>
                    <td>{r.current === null ? '-' : (r.current - r.next).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sim.rows.length > STEP5_DISPLAY_CAP && (
              <p className="empty">그 외 {sim.rows.length - STEP5_DISPLAY_CAP}건 — 표는 상위 {STEP5_DISPLAY_CAP}건만 표시합니다.</p>
            )}
          </>
        )}

        <h2>지배관계 검증</h2>
        {sim.dominanceOk
          ? <p>통과 — 기존 활성 요율(BASE 포함) 대비 모든 검사 구간에서 동일하거나 저렴합니다.</p>
          : (
            <div className="card warn">
              <p>불통과 — 다음 사유로 다음 단계로 진행할 수 없습니다.</p>
              <ul>{sim.dominanceFailures.map((f, i) => <li key={i} className="warn">{f}</li>)}</ul>
            </div>
          )}
        {sim.reverseMargin && <p className="warn">⚠ 역마진 경고: 표본 체결 기준 회사부담액이 자사 고객부과분보다 큽니다.</p>}
      </div>
    );
  }

  function renderStep6() {
    return (
      <div className="stack">
        <div className="card">
          <h3>{form.name || '(이름 없음)'}</h3>
          <p>{form.type} · {form.applyMode} · {form.startDate} ~ {form.endDate}</p>
        </div>
        <table>
          <tbody>
            <tr><td>상품군</td><td>{form.assetClass}</td></tr>
            <tr><td>적용기간</td><td>{form.applyMode === '타겟추출형' || form.benefitKind === '캘린더' ? '캘린더(신청/룰 기간)' : `가입일 +${form.benefitMonths}개월`}</td></tr>
            <tr>
              <td>거래소</td>
              <td>
                {showExchangeCheckboxes
                  ? (form.exchangesSel.length === exchanges.length ? '전체' : form.exchangesSel.join(', '))
                  : (form.selection.exchanges === '*' ? '전체' : form.selection.exchanges.join(', '))}
              </td>
            </tr>
            <tr><td>세션</td><td>{form.sessionsSel.length === sessions.length ? '전체' : form.sessionsSel.join(', ')}</td></tr>
            <tr><td>채널</td><td>{(form.channelsSel.length === 0 || form.channelsSel.length === CHANNELS.length) ? '전체' : form.channelsSel.join(', ')}</td></tr>
            <tr><td>품목</td><td>{summarize(form.selection)}</td></tr>
            <tr><td>제외 품목</td><td>{form.selection.excludeProducts.length > 0 ? form.selection.excludeProducts.join(', ') : '없음'}</td></tr>
            <tr><td>구성요소</td><td>{form.components.map((c) => c.name).join(', ')}</td></tr>
            <tr><td>대상</td><td>{showTrigger ? '트리거 기반 자동 대상' : (form.targetMode === 'all' ? '전체 계좌' : `지정 계좌 ${accountsParsed.accepted.length}건`)}</td></tr>
            <tr><td>시뮬레이션</td><td>대상 {sim.targets.length}건, 지배관계 {sim.dominanceOk ? '통과' : '불통과'}, 역마진 {sim.reverseMargin ? '있음' : '없음'}</td></tr>
          </tbody>
        </table>
        <div className="actions">
          <button className="btn" type="button" onClick={goPrev}>이전</button>
          <button className="btn primary" type="button" onClick={handleSubmit} disabled={!sim.dominanceOk}>상신</button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <section className="wizard">
        <div className="card">
          <h3>상신 완료</h3>
          <p>'{form.name}' 이벤트가 상신되었습니다. 승인함에서 결재 대기 중입니다.</p>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" onClick={handleReset}>새 이벤트 등록</button>
        </div>
      </section>
    );
  }

  return (
    <section className="wizard">
      <div className="wizard-steps">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const cls = n === step ? 'wizard-step active' : n < step ? 'wizard-step done' : 'wizard-step';
          return (<div key={label} className={cls}><span className="num">{n}</span>{label}</div>);
        })}
      </div>

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
      {step === 5 && renderStep5()}
      {step === 6 && renderStep6()}

      {step < 6 && (
        <div className="actions">
          {step > 1 && <button className="btn" type="button" onClick={goPrev}>이전</button>}
          <button className="btn primary" type="button" disabled={!canProceedMap[step]} onClick={goNext}>다음</button>
        </div>
      )}
    </section>
  );
}
