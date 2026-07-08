import { useEffect, useState } from 'react';
import { api, ApiError, type PriorityEntry, type PriorityTop, type Product, type RuleScope } from '../api/client';
import { lookupLabel, ruleTypeLabel, ASSET_OPTIONS, LOOKUP_OPTIONS } from '../api/labels';

const TODAY = '2026-07-07';
const DERIV = new Set(['DOMESTIC_DERIV', 'OVERSEAS_DERIV']);
const SESSION_OPTIONS: [string, string][] = [['PRE', '프리'], ['REGULAR', '정규'], ['AFTER', '애프터']];
const CHANNEL_OPTIONS = ['HTS', 'MTS', 'API', 'ARS', '센터', '반대매매'];

function scopeText(s: RuleScope): string {
  const parts: string[] = [];
  if (s.exchanges) parts.push(`거래소:${s.exchanges.join(',')}`);
  if (s.lookupKeys) parts.push(`조회구분:${s.lookupKeys.map(lookupLabel).join(',')}`);
  if (s.sessions) parts.push(`세션:${s.sessions.join(',')}`);
  if (s.channels) parts.push(`채널:${s.channels.join(',')}`);
  if (s.products) parts.push(`품목:${s.products.join(',')}`);
  if (s.excludeProducts?.length) parts.push(`제외:${s.excludeProducts.join(',')}`);
  return parts.length ? parts.join(' · ') : '전체';
}

export default function PolicyPriority() {
  const [entries, setEntries] = useState<PriorityEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [top, setTop] = useState<PriorityEntry | null>(null);
  const [err, setErr] = useState('');

  const [assetClass, setAssetClass] = useState('OVERSEAS_DERIV');
  const [lookupKey, setLookupKey] = useState('FUTURES');
  const [exchange, setExchange] = useState('CME');
  const [session, setSession] = useState('REGULAR');
  const [channel, setChannel] = useState('HTS');
  const [prod, setProd] = useState('ES');

  const deriv = DERIV.has(assetClass);
  const exchangeOptions = [...new Set(products.filter(p => p.assetClass === assetClass).map(p => p.exchange))];

  useEffect(() => {
    api.get<PriorityEntry[]>(`/api/priority?tradeDate=${TODAY}`).then(setEntries)
      .catch(e => setErr(e instanceof ApiError ? e.message : String(e)));
    api.get<Product[]>('/api/products').then(setProducts).catch(() => {});
  }, []);

  function changeAsset(ac: string) {
    setAssetClass(ac);
    const first = [...new Set(products.filter(p => p.assetClass === ac).map(p => p.exchange))][0];
    if (first) setExchange(first);
  }

  useEffect(() => {
    const qs = new URLSearchParams({ assetClass, lookupKey, exchange, session, channel,
      product: deriv ? prod : '*', tradeDate: TODAY });
    api.get<PriorityTop>(`/api/priority/top?${qs}`).then(r => setTop(r.top))
      .catch(() => setTop(null));
  }, [assetClass, lookupKey, exchange, session, channel, prod, deriv]);

  return (
    <section className="stack">
      <div className="card">
        <h2>정책 우선순위 (사전 산정)</h2>
        <p className="trace-narration">
          기본·이벤트·협의가 <b>하나의 요율 순위</b>에서 경쟁한다(통합 랭킹). 순위는 룰 변경 때만
          재계산해 두고, 체결 때는 배정판을 <b>즉시 룩업</b>한다. 아래 순위는 계좌 무관(자격 게이트 무시)이며,
          계좌별 실제 승자는 수수료 결정 흐름 화면에서 게이트까지 확인한다.
        </p>

        <div className="form-grid">
          <div className="field">
            <label>자산군</label>
            <select value={assetClass} onChange={e => changeAsset(e.target.value)}>
              {ASSET_OPTIONS.map(([code, ko]) => <option key={code} value={code}>{ko}</option>)}
            </select>
          </div>
          <div className="field">
            <label>조회구분</label>
            <select value={lookupKey} onChange={e => setLookupKey(e.target.value)}>
              {LOOKUP_OPTIONS.map(([code, ko]) => <option key={code} value={code}>{ko}</option>)}
            </select>
          </div>
          <div className="field">
            <label>거래소</label>
            <select value={exchange} onChange={e => setExchange(e.target.value)}>
              {(exchangeOptions.length ? exchangeOptions : [exchange]).map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          {deriv && (
            <div className="field">
              <label>품목</label>
              <input value={prod} onChange={e => setProd(e.target.value)} placeholder="ES" />
            </div>
          )}
          <div className="field">
            <label>세션</label>
            <select value={session} onChange={e => setSession(e.target.value)}>
              {SESSION_OPTIONS.map(([code, ko]) => <option key={code} value={code}>{ko}</option>)}
            </select>
          </div>
          <div className="field">
            <label>채널</label>
            <select value={channel} onChange={e => setChannel(e.target.value)}>
              {CHANNEL_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {err && <p style={{ color: 'crimson' }}>⚠ {err}</p>}
        <div className="check-grid">
          {top ? (
            <>
              <span className="pill pill-active">이론상 최저(자격 무시): {top.scheduleName}</span>
              <span className="badge">{ruleTypeLabel(top.ruleType)} · {top.ruleName} · rank {top.rank.toLocaleString()}</span>
            </>
          ) : (
            <span className="pill pill-pending">이 조회키에 해당하는 활성 정책이 없습니다.</span>
          )}
        </div>
        <p className="trace-narration">
          rank = 구조 그룹 순위값(정률=요율bp 합, 정액=정액 합, 구간표=첫 구간 요율+정액). 동률이면
          협의 &gt; 이벤트 &gt; 기본 → 범위 구체성 → 정책ID 순.
        </p>
      </div>

      {ASSET_OPTIONS.map(([ac, ko]) => {
        const group = entries.filter(p => p.scope.assetClass === ac);
        if (group.length === 0) return null;
        return (
          <div className="card" key={ac}>
            <h2>{ko} 정책 순위 (요율 오름차순)</h2>
            <table>
              <thead><tr><th>순위</th><th>구분</th><th>정책</th><th>적용범위</th><th>요율표</th><th>순위값(요율)</th></tr></thead>
              <tbody>
                {group.map((p, i) => (
                  <tr key={p.ruleId} className={top && p.ruleId === top.ruleId ? 'trace-winner' : undefined}>
                    <td>{i + 1}</td>
                    <td><span className={`pill ${p.ruleType === 'BASE' ? 'pill-draft' : 'pill-active'}`}>{ruleTypeLabel(p.ruleType)}</span></td>
                    <td>{p.ruleName}</td>
                    <td>{scopeText(p.scope)}</td>
                    <td>{p.scheduleName}</td>
                    <td>{p.rank.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}
