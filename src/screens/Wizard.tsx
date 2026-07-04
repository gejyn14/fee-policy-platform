import { Fragment, useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { calcFee } from '../domain/calc';
import { dominates } from '../domain/dominance';
import { scopeMatches, isTarget } from '../domain/binding';
import { TODAY } from '../domain/types';
import type {
  ApplyMode, AssetClass, Execution, FeeComponent, FeeRule, FeeSchedule,
  NegotiatedCondition, Payer, Product, RateBand, ScopeSelector,
} from '../domain/types';

// ---------------------------------------------------------------------------
// 순수 헬퍼 (TDD 대상: parseCsvCodes)
// ---------------------------------------------------------------------------

/** 콤마/개행으로 구분된 코드 목록을 파싱해 유효 코드(accepted)와 무시된 코드(rejected)로 분류한다. */
export function parseCsvCodes(text: string, valid: Set<string>): { accepted: string[]; rejected: string[] } {
  const tokens = text.split(/[,\n]/).map((t) => t.trim()).filter((t) => t.length > 0);
  const accepted: string[] = [];
  const rejected: string[] = [];
  const seenAccepted = new Set<string>();
  const seenRejected = new Set<string>();
  for (const t of tokens) {
    if (valid.has(t)) {
      if (!seenAccepted.has(t)) { seenAccepted.add(t); accepted.push(t); }
    } else if (!seenRejected.has(t)) { seenRejected.add(t); rejected.push(t); }
  }
  return { accepted, rejected };
}

function optionsForAssetClass(products: Product[], ac: AssetClass) {
  const inClass = products.filter((p) => p.assetClass === ac);
  const exchanges = [...new Set(inClass.map((p) => p.exchange))];
  const sessions = [...new Set(inClass.flatMap((p) => p.sessions))];
  const currencies = [...new Set(inClass.map((p) => p.currency))];
  return { inClass, exchanges, sessions, currencies };
}

const sampleFor = (p: Product) => (price: number): Execution =>
  ({ accountId: 'SIM', product: p, session: p.sessions[0], price, qty: 10, notional: price * 10 });

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const ASSET_CLASSES: AssetClass[] = ['국내주식', '해외주식', '국내파생', '해외파생', '금현물'];
const APPLY_MODES: ApplyMode[] = ['신청형', '가입형', '휴면복귀형', '일괄적용형'];
const KINDS: FeeComponent['kind'][] = ['자사', '유관기관', '세금'];
const PAYERS: Payer[] = ['고객부과', '회사부담', '면제'];
const RATE_TYPES: FeeComponent['rateType'][] = ['정률', '정액', '구간표'];
const METRICS: NegotiatedCondition['metric'][] = ['6개월평균자산', '6개월약정액'];
const ACTIONS: NegotiatedCondition['action'][] = ['자동연장', '승인후연장'];
const STEP_LABELS = ['기본정보', '적용범위', '요율표', '대상', '시뮬레이션', '상신'];

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

  assetClass: AssetClass;
  exchangesSel: string[];
  sessionsSel: string[];
  currenciesSel: string[];
  itemsSel: string[];
  itemSearch: string;
  itemsCsvText: string;
  itemsCsvWarning: string;
  excludeText: string;

  copyScheduleId: string;
  components: FeeComponent[];

  targetMode: 'all' | 'accounts';
  accountsCsvText: string;
}

function makeInitialForm(products: Product[]): WizardForm {
  const assetClass: AssetClass = ASSET_CLASSES[0];
  const { inClass, exchanges, sessions, currencies } = optionsForAssetClass(products, assetClass);
  return {
    name: '', type: 'EVENT', applyMode: '일괄적용형',
    startDate: TODAY, endDate: '2026-12-31',
    condMetric: '6개월평균자산', condThreshold: 500_000_000, condAction: '승인후연장',
    assetClass,
    exchangesSel: exchanges, sessionsSel: sessions, currenciesSel: currencies,
    itemsSel: inClass.map((p) => p.code),
    itemSearch: '', itemsCsvText: '', itemsCsvWarning: '', excludeText: '',
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

  // 로컬 상태 → draft 단방향 동기화. wizardDraft는 의존성에 넣지 않는다(넣으면
  // draft 변경이 이 effect를 재실행시켜 다시 draft를 쓰는 무한 루프가 될 수 있음).
  useEffect(() => {
    setWizardDraft({ form, step });
  }, [form, step]);

  const update = (patch: Partial<WizardForm>) => setForm((f) => ({ ...f, ...patch }));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const { inClass, exchanges, sessions, currencies } = optionsForAssetClass(products, form.assetClass);
  const filteredItems = inClass.filter((p) => {
    const q = form.itemSearch.trim().toLowerCase();
    return !q || p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
  });
  const excludeParsed = parseCsvCodes(form.excludeText, new Set(inClass.map((p) => p.code)));
  const showTrigger = form.applyMode !== '일괄적용형';
  const accountsParsed = !showTrigger && form.targetMode === 'accounts'
    ? parseCsvCodes(form.accountsCsvText, new Set(accounts.map((a) => a.id)))
    : { accepted: [] as string[], rejected: [] as string[] };

  function handleAssetClassChange(ac: AssetClass) {
    const opt = optionsForAssetClass(products, ac);
    update({
      assetClass: ac, exchangesSel: opt.exchanges, sessionsSel: opt.sessions, currenciesSel: opt.currencies,
      itemsSel: opt.inClass.map((p) => p.code), itemSearch: '', itemsCsvText: '', itemsCsvWarning: '', excludeText: '',
    });
  }

  function applyItemsCsv() {
    const valid = new Set(inClass.map((p) => p.code));
    const { accepted, rejected } = parseCsvCodes(form.itemsCsvText, valid);
    update({
      itemsSel: [...new Set([...form.itemsSel, ...accepted])],
      itemsCsvWarning: rejected.length > 0
        ? `무시된 코드 (해당 상품군에 없음): ${rejected.join(', ')}`
        : (accepted.length > 0 ? `${accepted.length}건 체크 반영됨` : '반영할 코드가 없습니다.'),
    });
  }

  function buildScope(): ScopeSelector {
    return {
      assetClass: form.assetClass,
      exchanges: form.exchangesSel.length === exchanges.length ? '*' : form.exchangesSel,
      sessions: form.sessionsSel.length === sessions.length ? '*' : form.sessionsSel,
      currencies: form.currenciesSel.length === currencies.length ? '*' : form.currenciesSel,
      products: form.itemsSel.length === inClass.length ? '*' : form.itemsSel,
      excludeProducts: excludeParsed.accepted,
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

  function computeSimulation() {
    const scope = buildScope();
    const schedule: FeeSchedule = { id: 'PREVIEW', name: form.name || '(임시)', components: form.components };
    const targetProducts = products.filter((p) => scopeMatches(scope, p));
    if (targetProducts.length === 0) {
      return { targetProducts, targets: [], dominanceFailures: [] as string[], dominanceOk: true, reverseMargin: false, rows: [] as { code: string; name: string; current: number | null; next: number }[] };
    }
    const incumbents = rules.filter((r) => r.status === '활성' && targetProducts.some((p) => scopeMatches(r.scope, p)));
    const dominanceFailures: string[] = [];
    for (const inc of incumbents) {
      const incSched = schedules.find((x) => x.id === inc.scheduleId);
      if (!incSched) continue;
      for (const p of targetProducts) {
        if (!dominates(schedule, incSched, sampleFor(p))) {
          dominanceFailures.push(`${p.name}(${p.code}): 기존 '${inc.name}' 대비 일부 구간에서 더 비쌈`);
        }
      }
    }
    const probe = calcFee(schedule, sampleFor(targetProducts[0])(100));
    const ownReceived = probe.lines.filter((l) => l.kind === '자사' && l.payer === '고객부과').reduce((a, l) => a + l.amount, 0);
    const reverseMargin = probe.companyBorne > ownReceived;
    const previewRule: FeeRule = {
      id: 'PREVIEW', name: form.name, type: form.type, status: '활성', applyMode: form.applyMode,
      startDate: form.startDate, endDate: form.endDate, scope, scheduleId: 'PREVIEW',
      targetAccountIds: !showTrigger && form.targetMode === 'accounts' ? accountsParsed.accepted : undefined,
      warnings: { dominance: true, reverseMargin: false }, createdBy: '', log: [],
    };
    const targets = accounts.filter((a) => isTarget(previewRule, a, enrollments));
    // 현행 비교는 해당 품목에 스코프가 일치하는 모든 활성 룰 중 최저 수수료 기준
    // (지배관계 검증은 위에서 전 활성 룰 대상으로 이미 수행)
    const rows = targetProducts.map((p) => {
      const matchingIncumbents = incumbents.filter((r) => scopeMatches(r.scope, p));
      let current: number | null = null;
      for (const inc of matchingIncumbents) {
        const incSched = schedules.find((x) => x.id === inc.scheduleId);
        if (incSched) {
          const fee = calcFee(incSched, sampleFor(p)(100)).customerTotal;
          if (current === null || fee < current) {
            current = fee;
          }
        }
      }
      const next = calcFee(schedule, sampleFor(p)(100)).customerTotal;
      return { code: p.code, name: p.name, current, next };
    });
    return { targetProducts, targets, dominanceFailures, dominanceOk: dominanceFailures.length === 0, reverseMargin, rows };
  }

  const sim = computeSimulation();

  const canProceed1 = form.name.trim() !== '' && form.startDate <= form.endDate &&
    (form.type !== 'NEGOTIATED' || form.condThreshold > 0);
  const canProceed2 = form.exchangesSel.length > 0 && form.sessionsSel.length > 0 && form.currenciesSel.length > 0;
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
      startDate: form.startDate, endDate: form.endDate,
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
              <option value="EVENT">EVENT</option>
              <option value="NEGOTIATED">NEGOTIATED</option>
            </select>
          </div>
          <div className="field">
            <label>적용형태</label>
            <select value={form.applyMode} onChange={(e) => update({ applyMode: e.target.value as ApplyMode })}>
              {APPLY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label>시작일</label>
            <input type="date" value={form.startDate} onChange={(e) => update({ startDate: e.target.value })} />
          </div>
          <div className="field">
            <label>종료일</label>
            <input type="date" value={form.endDate} onChange={(e) => update({ endDate: e.target.value })} />
          </div>
        </div>
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
    return (
      <div className="stack">
        <div className="field">
          <label>상품군</label>
          <select value={form.assetClass} onChange={(e) => handleAssetClassChange(e.target.value as AssetClass)}>
            {ASSET_CLASSES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

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

        <div className="field">
          <label>통화</label>
          <div className="check-grid">
            {currencies.map((c) => (
              <label key={c} className="check-item">
                <input type="checkbox" checked={form.currenciesSel.includes(c)}
                  onChange={() => update({ currenciesSel: toggle(form.currenciesSel, c) })} />
                {c}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label>품목 검색</label>
          <input value={form.itemSearch} onChange={(e) => update({ itemSearch: e.target.value })} placeholder="코드 또는 이름" />
        </div>
        <div className="check-grid">
          {filteredItems.map((p) => (
            <label key={p.code} className="check-item">
              <input type="checkbox" checked={form.itemsSel.includes(p.code)}
                onChange={() => update({ itemsSel: toggle(form.itemsSel, p.code) })} />
              {p.code} ({p.name})
            </label>
          ))}
          {filteredItems.length === 0 && <span className="empty">검색 결과 없음</span>}
        </div>

        <div className="field">
          <label>품목 코드 붙여넣기 (프로토타입: CSV)</label>
          <textarea rows={3} value={form.itemsCsvText} onChange={(e) => update({ itemsCsvText: e.target.value })}
            placeholder="예: 6A, 6B" />
        </div>
        <button className="btn" type="button" onClick={applyItemsCsv}>체크 반영</button>
        {form.itemsCsvWarning && <p className="warn">{form.itemsCsvWarning}</p>}

        <div className="field">
          <label>제외 품목</label>
          <textarea rows={2} value={form.excludeText} onChange={(e) => update({ excludeText: e.target.value })}
            placeholder="예: 005930" />
        </div>
        {excludeParsed.rejected.length > 0 && (
          <p className="warn">무시된 코드 (해당 상품군에 없음): {excludeParsed.rejected.join(', ')}</p>
        )}

        {!canProceed2 && <p className="warn">거래소/세션/통화 중 최소 1개씩은 선택해야 합니다.</p>}
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
                      <input type="number" value={c.rateBp ?? 0}
                        onChange={(e) => updateComponent(idx, { rateBp: Number(e.target.value) })} placeholder="bp" />
                    )}
                    {c.rateType === '정액' && (
                      <input type="number" value={c.flatAmount ?? 0}
                        onChange={(e) => updateComponent(idx, { flatAmount: Number(e.target.value) })} placeholder="원" />
                    )}
                    {c.rateType === '구간표' && <span className="pill">아래 구간표 참조</span>}
                  </td>
                  <td>
                    <input type="number" value={c.minFee ?? ''}
                      onChange={(e) => updateComponent(idx, { minFee: e.target.value === '' ? undefined : Number(e.target.value) })}
                      placeholder="선택" />
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
                  placeholder="예: A-1001, A-1002" />
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
          <div className="card"><h3>{sim.targetProducts.length}</h3><p>매칭 품목 수</p></div>
          <div className={sim.reverseMargin ? 'card warn' : 'card'}><h3>{sim.reverseMargin ? '예' : '아니오'}</h3><p>역마진 여부</p></div>
        </div>

        <h2>매칭 품목</h2>
        {sim.targetProducts.length === 0
          ? <p className="empty">매칭되는 품목이 없습니다. 적용범위를 다시 확인하세요.</p>
          : <p>{sim.targetProducts.map((p) => `${p.code}(${p.name})`).join(', ')}</p>}

        <h2>표본 체결 기준 수수료 비교 (가격 100, 수량 10)</h2>
        {sim.rows.length === 0 ? <p className="empty">비교할 품목이 없습니다.</p> : (
          <table>
            <thead><tr><th>품목</th><th>현행 고객부담</th><th>신규 고객부담</th><th>차이</th></tr></thead>
            <tbody>
              {sim.rows.map((r) => (
                <tr key={r.code}>
                  <td>{r.code} ({r.name})</td>
                  <td>{r.current === null ? '해당없음' : r.current.toLocaleString()}</td>
                  <td>{r.next.toLocaleString()}</td>
                  <td>{r.current === null ? '-' : (r.current - r.next).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
            <tr><td>거래소</td><td>{form.exchangesSel.length === exchanges.length ? '전체' : form.exchangesSel.join(', ')}</td></tr>
            <tr><td>세션</td><td>{form.sessionsSel.length === sessions.length ? '전체' : form.sessionsSel.join(', ')}</td></tr>
            <tr><td>통화</td><td>{form.currenciesSel.length === currencies.length ? '전체' : form.currenciesSel.join(', ')}</td></tr>
            <tr><td>품목</td><td>{form.itemsSel.length === inClass.length ? '전체' : form.itemsSel.join(', ')}</td></tr>
            <tr><td>제외 품목</td><td>{excludeParsed.accepted.length > 0 ? excludeParsed.accepted.join(', ') : '없음'}</td></tr>
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
