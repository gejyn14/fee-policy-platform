import { useEffect, useState } from 'react';
import { api, ApiError, type Account, type TraceResult, type Schedule, type CalcResponse } from '../api/client';
import { sourceLabel, ruleTypeLabel } from '../api/labels';

const TODAY = '2026-07-07';
const DERIV = new Set(['DOMESTIC_DERIV', 'OVERSEAS_DERIV']);

export default function FeeTrace() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('8041-2237-01');
  const [assetClass, setAssetClass] = useState('OVERSEAS_DERIV');
  const [lookupKey, setLookupKey] = useState('FUTURES');
  const [exchange, setExchange] = useState('CME');
  const [product, setProduct] = useState('ES');
  const [channel, setChannel] = useState('MTS');
  const [price, setPrice] = useState(100);
  const [qty, setQty] = useState(10);

  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [calc, setCalc] = useState<CalcResponse | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => { api.get<Account[]>('/api/accounts').then(setAccounts).catch(() => {}); }, []);

  const isDeriv = DERIV.has(assetClass);

  const run = async () => {
    setErr(''); setTrace(null); setSchedule(null); setCalc(null);
    const qs = new URLSearchParams({ accountId, assetClass, lookupKey, exchange,
      product: isDeriv ? product : '*', channel, session: 'REGULAR', tradeDate: TODAY });
    try {
      const t = await api.get<TraceResult>(`/api/trace?${qs}`);
      setTrace(t);
      if (t.applied) {
        const schedules = await api.get<Schedule[]>('/api/schedules');
        setSchedule(schedules.find(s => s.id === t.applied!.scheduleId) ?? null);
      }
    } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
  };

  const doCalc = async () => {
    if (!trace?.applied) return;
    try {
      setCalc(await api.post<CalcResponse>('/api/calc',
        { scheduleId: trace.applied.scheduleId, price, qty }));
    } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
  };

  return (
    <div>
      <h2>수수료 결정 흐름</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={accountId} onChange={e => setAccountId(e.target.value)}>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.id} · {a.name}</option>)}
        </select>
        <select value={assetClass} onChange={e => setAssetClass(e.target.value)}>
          <option value="OVERSEAS_DERIV">해외파생</option><option value="DOMESTIC_DERIV">국내파생</option>
          <option value="OVERSEAS_STOCK">해외주식</option><option value="DOMESTIC_STOCK">국내주식</option>
        </select>
        <select value={lookupKey} onChange={e => setLookupKey(e.target.value)}>
          <option value="FUTURES">선물</option><option value="OPTIONS">옵션</option>
          <option value="STOCK">주식</option><option value="ETF">ETF</option>
        </select>
        <input value={exchange} onChange={e => setExchange(e.target.value)} style={{ width: 70 }} placeholder="거래소" />
        {isDeriv && <input value={product} onChange={e => setProduct(e.target.value)} style={{ width: 70 }} placeholder="품목" />}
        <input value={channel} onChange={e => setChannel(e.target.value)} style={{ width: 70 }} placeholder="채널" />
        <button onClick={run}>결정 추적</button>
      </div>
      {err && <p style={{ color: 'crimson' }}>⚠ {err}</p>}

      {trace && (
        <div style={{ marginTop: 16 }}>
          <h3>① 조회키</h3>
          <p className="hint">{assetClass} · {lookupKey} · {exchange} · {isDeriv ? product : '(주식 품목없음)'} · {channel}</p>

          <h3>② 후보 · 자격 게이트</h3>
          <table>
            <thead><tr><th>순위</th><th>룰</th><th>타입</th><th>rank</th><th>범위</th><th>게이트</th><th>사유</th></tr></thead>
            <tbody>{trace.candidates.map((c, i) => (
              <tr key={c.ruleId} style={{ background: c.winner ? '#effaf0' : undefined }}>
                <td>{i + 1}</td><td>{c.ruleName} {c.winner && <b>★승자</b>}</td>
                <td>{ruleTypeLabel(c.ruleType)}</td><td>{c.rank}</td>
                <td>{c.scopeMatch ? '✓' : '✗'}</td><td>{c.gatePass ? '✓' : '✗'}</td>
                <td>{c.gateNote ?? '통과'}</td>
              </tr>
            ))}</tbody>
          </table>

          <h3>③ 승자 · ④ 배정판</h3>
          {trace.applied ? (
            <p>
              <span className={`tag ${trace.applied.sourceType}`}>{sourceLabel(trace.applied.sourceType)}</span>{' '}
              요율표 <b>{trace.applied.scheduleId}</b> · 정책 {trace.applied.sourceRuleId}{' '}
              {trace.bindingHit
                ? <em style={{ color: 'green' }}>— 배정판 히트(우대)</em>
                : <em style={{ color: '#c60' }}>— 배정판 미스 → 기본수수료 직접 적용(정상 경로)</em>}
            </p>
          ) : <p className="hint">적용 요율표 없음</p>}

          <h3>⑤ 체결 → 금액</h3>
          <label>체결가 <input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} style={{ width: 90 }} /></label>{' '}
          <label>수량 <input type="number" value={qty} onChange={e => setQty(Number(e.target.value))} style={{ width: 70 }} /></label>{' '}
          <button onClick={doCalc}>계산</button>

          {schedule?.components.some(c => c.rateType === 'BANDS') && (
            <div style={{ marginTop: 8 }}>
              <b>구간표</b> (체결가 {price} 매칭 구간 강조)
              {schedule.components.filter(c => c.rateType === 'BANDS').map((c, ci) => (
                <table key={ci}>
                  <thead><tr><th>{c.name}: from</th><th>to</th><th>rateBp</th><th>flat</th></tr></thead>
                  <tbody>{(c.bands ?? []).map((b, bi) => {
                    const hit = price >= b.from && (b.to == null || price < b.to);
                    return <tr key={bi} style={{ background: hit ? '#fff6d6' : undefined, fontWeight: hit ? 700 : 400 }}>
                      <td>{b.from}</td><td>{b.to ?? '∞'}</td><td>{b.rateBp ?? '—'}</td><td>{b.flat ?? '—'}</td></tr>;
                  })}</tbody>
                </table>
              ))}
            </div>
          )}

          {calc && (
            <table>
              <thead><tr><th>구성요소</th><th>부담</th><th>금액</th></tr></thead>
              <tbody>
                {calc.lines.map((l, i) => <tr key={i}><td>{l.name}</td><td>{l.payer}</td><td>{l.amount}</td></tr>)}
                <tr><td colSpan={2}><b>고객부과 합</b></td><td><b>{calc.customerTotal}</b></td></tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
