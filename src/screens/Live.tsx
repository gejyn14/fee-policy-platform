import { useEffect, useState } from 'react';
import { api, ApiError, type Account, type BindingRow, type HistoryRow, type Dashboard, type BatchResult, type LookupResponse } from '../api/client';
import { assetLabel, lookupLabel, sourceLabel, triggerLabel } from '../api/labels';

const TRADE_DATE = '2026-07-07';

export default function Live() {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sel, setSel] = useState<string>('');
  const [bindings, setBindings] = useState<BindingRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [msg, setMsg] = useState<string>('');
  const [err, setErr] = useState<string>('');

  const loadTop = async () => {
    try {
      const [d, a] = await Promise.all([api.get<Dashboard>('/api/dashboard'), api.get<Account[]>('/api/accounts')]);
      setDash(d); setAccounts(a);
      if (!sel && a.length) setSel(a[0].id);
      setErr('');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '백엔드 연결 실패 — 서버(:8080)가 떠 있는지 확인하세요.');
    }
  };

  const loadAccount = async (id: string) => {
    if (!id) return;
    try {
      const [b, h] = await Promise.all([
        api.get<BindingRow[]>(`/api/accounts/${id}/bindings`),
        api.get<HistoryRow[]>(`/api/accounts/${id}/bindings/history`),
      ]);
      setBindings(b); setHistory(h);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  useEffect(() => { loadTop(); }, []);
  useEffect(() => { loadAccount(sel); }, [sel]);

  const rebuild = async () => {
    setMsg('전체 재산출 중…');
    try {
      const r = await api.post<BatchResult>(`/api/batch/rebuild?baseDate=${TRADE_DATE}`);
      setMsg(`전체 재산출 완료 — 신규 ${r.inserted} · 변경 ${r.updated} · 삭제 ${r.deleted} · 유지 ${r.unchanged}`);
      await loadTop(); await loadAccount(sel);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e)); setMsg('');
    }
  };

  return (
    <div>
      <h2>백엔드 연동 (라이브)</h2>
      <p className="hint">Spring Boot + PostgreSQL 실 백엔드에 직접 연결됩니다. 기준일 {TRADE_DATE}.</p>
      {err && <p style={{ color: 'crimson' }}>⚠ {err}</p>}

      {dash && (
        <div className="cards">
          <div className="card"><b>{dash.activeRules}</b><span>활성 룰</span></div>
          <div className="card"><b>{dash.pendingRules}</b><span>승인 대기 룰</span></div>
          <div className="card"><b>{dash.activeNego}</b><span>활성 협의 부여</span></div>
          <div className="card"><b>{dash.bindingRows}</b><span>배정판 행(우대분)</span></div>
        </div>
      )}

      <div style={{ margin: '12px 0' }}>
        <button onClick={rebuild}>전체 재산출 실행</button>
        {msg && <span style={{ marginLeft: 12 }}>{msg}</span>}
      </div>

      <label>계좌: <select value={sel} onChange={e => setSel(e.target.value)}>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.id} · {a.name} ({a.grade})</option>)}
      </select></label>

      <h3>수수료 배정판 <small>(우대분만 저장 · 없으면 기본수수료 적용)</small></h3>
      {bindings.length === 0
        ? <p className="hint">우대 배정 없음 — 이 계좌는 전 셀 기본수수료가 적용됩니다.</p>
        : (
          <table>
            <thead><tr><th>자산군</th><th>조회구분</th><th>거래소</th><th>품목</th><th>채널</th><th>정책</th><th>요율표</th><th>적용기간</th></tr></thead>
            <tbody>
              {bindings.map((b, i) => (
                <tr key={i}>
                  <td>{assetLabel(b.assetClass)}</td><td>{lookupLabel(b.lookupKey)}</td>
                  <td>{b.exchangeCode}</td><td>{b.productCode}</td><td>{b.channelCode}</td>
                  <td><span className={`tag ${b.sourceType}`}>{sourceLabel(b.sourceType)}</span></td>
                  <td>{b.scheduleId}</td><td>{b.validFrom} ~ {b.validTo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <h3>배정 이력</h3>
      {history.length === 0 ? <p className="hint">이력 없음</p> : (
        <table>
          <thead><tr><th>시각</th><th>조회구분</th><th>변경</th><th>트리거</th><th>사유</th></tr></thead>
          <tbody>
            {history.map(h => (
              <tr key={h.historyId}>
                <td>{h.changedAt?.slice(0, 19).replace('T', ' ')}</td>
                <td>{lookupLabel(h.lookupKey)}</td>
                <td>{sourceLabel(h.oldType)} → {sourceLabel(h.newType)}</td>
                <td>{triggerLabel(h.triggerSource)}</td>
                <td>{h.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <LookupPanel accounts={accounts} sel={sel} />
    </div>
  );
}

function LookupPanel({ accounts, sel }: { accounts: Account[]; sel: string }) {
  const [account, setAccount] = useState(sel);
  const [assetClass, setAssetClass] = useState('OVERSEAS_DERIV');
  const [lookupKey, setLookupKey] = useState('FUTURES');
  const [product, setProduct] = useState('ES');
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => { setAccount(sel); }, [sel]);

  const run = async () => {
    setErr(''); setResult(null);
    const qs = new URLSearchParams({ accountId: account, assetClass, lookupKey,
      exchange: 'CME', product, channel: 'MTS', tradeDate: TRADE_DATE });
    try {
      setResult(await api.get<LookupResponse>(`/api/lookup?${qs}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div style={{ marginTop: 24, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
      <h3>원장 체결 조회 시뮬 <small>(배정판 → 없으면 기본 fallback)</small></h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={account} onChange={e => setAccount(e.target.value)}>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
        </select>
        <select value={assetClass} onChange={e => setAssetClass(e.target.value)}>
          <option value="OVERSEAS_DERIV">해외파생</option>
          <option value="OVERSEAS_STOCK">해외주식</option>
        </select>
        <select value={lookupKey} onChange={e => setLookupKey(e.target.value)}>
          <option value="FUTURES">선물</option><option value="OPTIONS">옵션</option>
          <option value="STOCK">주식</option><option value="ETF">ETF</option>
        </select>
        <input value={product} onChange={e => setProduct(e.target.value)} placeholder="품목(ES)" style={{ width: 80 }} />
        <button onClick={run}>조회</button>
      </div>
      {err && <p style={{ color: 'crimson' }}>⚠ {err}</p>}
      {result && (
        <p style={{ marginTop: 8 }}>
          <span className={`tag ${result.sourceType}`}>{sourceLabel(result.sourceType)}</span>{' '}
          요율표 <b>{result.scheduleId}</b> · 정책 {result.sourceRuleId}
          {result.fallbackToBase && <em> (배정판 미스 → 기본수수료 적용)</em>}
        </p>
      )}
    </div>
  );
}
