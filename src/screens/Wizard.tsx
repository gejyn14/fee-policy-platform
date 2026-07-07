import { Fragment, useEffect, useState } from 'react';
import { api, ApiError, type Product, type RateBand, type Component, type ValidationReport } from '../api/client';
import { ASSET_OPTIONS, LOOKUP_OPTIONS, APPLY_MODE_OPTIONS, KIND_OPTIONS, PAYER_OPTIONS, RATE_TYPE_OPTIONS } from '../api/labels';

const TODAY = '2026-07-07';
const DERIV = new Set(['DOMESTIC_DERIV', 'OVERSEAS_DERIV']);

type CompForm = Component;

// 클라이언트 표시용 요율 계산(서버 FeeCalculator 동치) — 미리보기 전용.
function componentAmount(c: CompForm, price: number, qty: number): number {
  const notional = price * qty;
  let amt = 0;
  if (c.rateType === 'RATE') amt = (notional * (c.rateBp ?? 0)) / 10000;
  else if (c.rateType === 'FLAT') amt = (c.flatAmount ?? 0) * qty;
  else {
    const b = (c.bands ?? []).find(x => price >= x.from && (x.to == null || price < x.to));
    if (b) amt = (notional * (b.rateBp ?? 0)) / 10000 + (b.flat ?? 0) * qty;
  }
  if (c.minFee != null && amt < c.minFee) amt = c.minFee;
  return Math.round(amt * 100) / 100;
}

export default function Wizard() {
  const [step, setStep] = useState(1);
  const [products, setProducts] = useState<Product[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [report, setReport] = useState<ValidationReport | null>(null);

  // 1단계
  const [ruleId, setRuleId] = useState('R-EVT-NEW');
  const [name, setName] = useState('신규 수수료 이벤트');
  const [type, setType] = useState('EVENT');
  const [applyMode, setApplyMode] = useState('AUTO_ENROLL');
  const [startDate, setStartDate] = useState('2026-07-01');
  const [endDate, setEndDate] = useState('2026-12-31');
  // 2단계
  const [assetClass, setAssetClass] = useState('DOMESTIC_DERIV');
  const [lookupKeys, setLookupKeys] = useState<string[]>(['OPTIONS']);
  const [exchanges, setExchanges] = useState('KRX');
  const [productsSel, setProductsSel] = useState('K200');
  const [channels, setChannels] = useState('');
  // 3단계
  const [scheduleId, setScheduleId] = useState('SCH-EVT-NEW');
  const [components, setComponents] = useState<CompForm[]>([
    { name: '자사 수수료', kind: 'OWN', payer: 'CUSTOMER', rateType: 'BANDS',
      rateBp: null, flatAmount: null, minFee: null,
      bands: [{ from: 0, to: 0.42, rateBp: 12, flat: 10 }, { from: 0.42, to: 2.47, rateBp: 13, flat: null }, { from: 2.47, to: null, rateBp: 13, flat: 60 }] },
  ]);

  useEffect(() => { api.get<Product[]>('/api/products').then(setProducts).catch(() => {}); }, []);

  const isDeriv = DERIV.has(assetClass);
  const toggle = (arr: string[], v: string, set: (x: string[]) => void) =>
    set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const updateComponent = (i: number, patch: Partial<CompForm>) =>
    setComponents(cs => cs.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  const updateBand = (ci: number, bi: number, patch: Partial<RateBand>) =>
    setComponents(cs => cs.map((c, idx) => idx === ci
      ? { ...c, bands: (c.bands ?? []).map((b, j) => j === bi ? { ...b, ...patch } : b) } : c));
  const addBand = (ci: number) =>
    updateComponent(ci, { bands: [...(components[ci].bands ?? []), { from: 0, to: null, rateBp: 0, flat: null }] });
  const removeBand = (ci: number, bi: number) =>
    updateComponent(ci, { bands: (components[ci].bands ?? []).filter((_, j) => j !== bi) });
  const addComponent = () =>
    setComponents(cs => [...cs, { name: '', kind: 'OWN', payer: 'CUSTOMER', rateType: 'RATE', rateBp: 0, flatAmount: null, bands: null, minFee: null }]);
  const removeComponent = (i: number) => setComponents(cs => cs.filter((_, idx) => idx !== i));

  const buildPayload = () => {
    const arr = (s: string) => s.trim() ? s.split(',').map(x => x.trim()) : null;
    const schedule = {
      id: scheduleId, name: `${name} 요율표`,
      components: components.map(c => ({
        ...c,
        bands: c.rateType === 'BANDS' ? c.bands : null,
        rateBp: c.rateType === 'RATE' ? c.rateBp : null,
        flatAmount: c.rateType === 'FLAT' ? c.flatAmount : null,
      })),
    };
    const rule = {
      id: ruleId, name, type, status: 'DRAFT', applyMode, startDate, endDate,
      benefitKind: 'CALENDAR', benefitMonths: null, scheduleId,
      scope: {
        assetClass, exchanges: arr(exchanges), sessions: null,
        lookupKeys: lookupKeys.length ? lookupKeys : null,
        products: isDeriv ? arr(productsSel) : null, excludeProducts: [], channels: arr(channels),
      },
    };
    return { rule, schedule };
  };

  const submit = async () => {
    setErr(''); setMsg(''); setReport(null);
    try {
      await api.post('/api/rules', buildPayload());
      const rep = await api.post<ValidationReport>(`/api/rules/${ruleId}/validate`);
      setReport(rep);
      if (!rep.dominanceOk) { setErr('지배관계 검증 실패 — 아래 리포트 확인. 상신하지 않았습니다.'); return; }
      await api.post(`/api/rules/${ruleId}/submit`);
      setMsg(`상신 완료 — 룰 ${ruleId} 이(가) 승인 대기 상태입니다. 승인함에서 승인하세요.`);
      setStep(5);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div>
      <h2>이벤트 등록 <small>({step > 4 ? '완료' : `${step}/4단계`})</small></h2>
      {err && <p style={{ color: 'crimson' }}>⚠ {err}</p>}
      {msg && <p style={{ color: 'green' }}>✓ {msg}</p>}

      {step === 1 && (
        <div className="form">
          <label>룰 ID <input value={ruleId} onChange={e => setRuleId(e.target.value)} /></label>
          <label>이름 <input value={name} onChange={e => setName(e.target.value)} /></label>
          <label>타입 <select value={type} onChange={e => setType(e.target.value)}>
            <option value="EVENT">이벤트</option><option value="NEGOTIATED">협의</option></select></label>
          <label>대상 편입 <select value={applyMode} onChange={e => setApplyMode(e.target.value)}>
            {APPLY_MODE_OPTIONS.map(([c, k]) => <option key={c} value={c}>{k}</option>)}</select></label>
          <label>시작일 <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
          <label>종료일 <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
        </div>
      )}

      {step === 2 && (
        <div className="form">
          <label>자산군 <select value={assetClass} onChange={e => setAssetClass(e.target.value)}>
            {ASSET_OPTIONS.map(([c, k]) => <option key={c} value={c}>{k}</option>)}</select></label>
          <div>조회구분(멀티): {LOOKUP_OPTIONS.map(([c, k]) => (
            <label key={c} style={{ marginRight: 8 }}>
              <input type="checkbox" checked={lookupKeys.includes(c)} onChange={() => toggle(lookupKeys, c, setLookupKeys)} />{k}</label>
          ))}</div>
          <label>거래소(쉼표, 빈=전체) <input value={exchanges} onChange={e => setExchanges(e.target.value)} /></label>
          <label>채널(쉼표, 빈=전체) <input value={channels} onChange={e => setChannels(e.target.value)} placeholder="MTS,HTS" /></label>
          {isDeriv
            ? <label>품목(쉼표) <input value={productsSel} onChange={e => setProductsSel(e.target.value)} />
                <span className="hint"> · 등록 품목: {products.filter(p => p.assetClass === assetClass).map(p => p.code).join(', ') || '없음'}</span></label>
            : <p className="hint">주식형은 종목 차원이 없습니다(불변식) — 품목 미입력.</p>}
        </div>
      )}

      {step === 3 && (
        <div>
          <label>요율표 ID <input value={scheduleId} onChange={e => setScheduleId(e.target.value)} /></label>
          <table>
            <thead><tr><th>이름</th><th>구분</th><th>부담</th><th>방식</th><th>요율bp</th><th>정액</th><th>최소</th><th></th></tr></thead>
            <tbody>
              {components.map((c, idx) => (
                <Fragment key={idx}>
                  <tr>
                    <td><input value={c.name} onChange={e => updateComponent(idx, { name: e.target.value })} /></td>
                    <td><select value={c.kind} onChange={e => updateComponent(idx, { kind: e.target.value })}>
                      {KIND_OPTIONS.map(([v, k]) => <option key={v} value={v}>{k}</option>)}</select></td>
                    <td><select value={c.payer} onChange={e => updateComponent(idx, { payer: e.target.value })}>
                      {PAYER_OPTIONS.map(([v, k]) => <option key={v} value={v}>{k}</option>)}</select></td>
                    <td><select value={c.rateType} onChange={e => updateComponent(idx, { rateType: e.target.value })}>
                      {RATE_TYPE_OPTIONS.map(([v, k]) => <option key={v} value={v}>{k}</option>)}</select></td>
                    <td>{c.rateType === 'RATE' && <input type="number" value={c.rateBp ?? ''} onChange={e => updateComponent(idx, { rateBp: e.target.value === '' ? null : Number(e.target.value) })} />}</td>
                    <td>{c.rateType === 'FLAT' && <input type="number" value={c.flatAmount ?? ''} onChange={e => updateComponent(idx, { flatAmount: e.target.value === '' ? null : Number(e.target.value) })} />}</td>
                    <td><input type="number" value={c.minFee ?? ''} placeholder="선택"
                      onChange={e => updateComponent(idx, { minFee: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                    <td><button type="button" onClick={() => removeComponent(idx)}>삭제</button></td>
                  </tr>
                  {c.rateType === 'BANDS' && (
                    <tr><td colSpan={8}>
                      <table>
                        <thead><tr><th>from</th><th>to (빈=무한)</th><th>rateBp</th><th>flat</th><th></th></tr></thead>
                        <tbody>
                          {(c.bands ?? []).map((b, bi) => (
                            <tr key={bi}>
                              <td><input type="number" value={b.from} onChange={e => updateBand(idx, bi, { from: Number(e.target.value) })} /></td>
                              <td><input type="number" value={b.to ?? ''} onChange={e => updateBand(idx, bi, { to: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                              <td><input type="number" value={b.rateBp ?? ''} onChange={e => updateBand(idx, bi, { rateBp: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                              <td><input type="number" value={b.flat ?? ''} onChange={e => updateBand(idx, bi, { flat: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                              <td><button type="button" onClick={() => removeBand(idx, bi)}>삭제</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button type="button" onClick={() => addBand(idx)}>+ 구간 추가</button>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={addComponent}>+ 구성요소 추가</button>
          <h4>미리보기 (고객부과 합, 10계약)</h4>
          <table>
            <thead><tr><th>체결가</th><th>고객부과</th></tr></thead>
            <tbody>{[0.3, 1.0, 3.0].map(p => (
              <tr key={p}><td>{p}</td><td>{components.filter(c => c.payer === 'CUSTOMER')
                .reduce((s, c) => s + componentAmount(c, p, 10), 0).toFixed(2)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {step === 4 && (
        <div>
          <p>아래 내용으로 요율표·룰을 생성하고 지배관계를 검증한 뒤 상신합니다.</p>
          <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, overflow: 'auto' }}>
            {JSON.stringify(buildPayload(), null, 2)}
          </pre>
          <button onClick={submit}>검증 + 상신</button>
        </div>
      )}

      {report && (
        <div style={{ marginTop: 12, padding: 12, border: `1px solid ${report.dominanceOk ? '#0a0' : 'crimson'}`, borderRadius: 8 }}>
          <b>검증 리포트</b>
          <p>지배관계: {report.dominanceOk ? '✓ 통과 (전 구간 기준선 이하)' : '✗ 실패'}</p>
          {report.dominanceFailure && (
            <p style={{ color: 'crimson' }}>실패 지점 — 체결가 {report.dominanceFailure.price}에서
              우대 {report.dominanceFailure.candidateFee} &gt; 기준 {report.dominanceFailure.incumbentFee}</p>
          )}
          {report.reverseMarginWarning && <p style={{ color: '#c60' }}>⚠ 역마진 경고: 회사부담이 자사 수취분을 초과</p>}
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        {step > 1 && step <= 4 && <button onClick={() => setStep(step - 1)}>이전</button>}
        {step < 4 && <button onClick={() => setStep(step + 1)}>다음</button>}
        {step === 5 && <button onClick={() => { setStep(1); setReport(null); setMsg(''); }}>새 이벤트</button>}
      </div>
      <p className="hint" style={{ marginTop: 8 }}>기준일 {TODAY} · 지배관계는 같은 자산군 활성 기본요율표와 비교됩니다.</p>
    </div>
  );
}
