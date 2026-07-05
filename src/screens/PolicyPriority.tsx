import { useState } from 'react';
import { useStore } from '../store/useStore';
import { buildFeeKey, isDerivative } from '../domain/feeKey';
import type { AssetClass, Channel, ScopeSelector, Session } from '../domain/types';

const ASSET_CLASSES: AssetClass[] = ['국내주식', '해외주식', '국내파생', '해외파생', '금현물'];
const SESSIONS: Session[] = ['프리', '정규', '애프터'];
const CHANNELS: Channel[] = ['HTS', 'MTS', 'API', 'ARS', '센터', '반대매매'];

function scopeText(s: ScopeSelector): string {
  const parts: string[] = [];
  if (s.exchanges !== '*') parts.push(`거래소:${s.exchanges.join(',')}`);
  if ((s.channels ?? '*') !== '*') parts.push(`채널:${(s.channels as string[]).join(',')}`);
  if (s.products !== '*') parts.push(`품목:${s.products.join(',')}`);
  return parts.length ? parts.join(' · ') : '전체';
}

export default function PolicyPriority() {
  const { products, policyPriority } = useStore();
  const idx = policyPriority();

  const [assetClass, setAssetClass] = useState<AssetClass>('해외파생');
  const [session, setSession] = useState<Session>('정규');
  const [channel, setChannel] = useState<Channel>('HTS');
  const [prod, setProd] = useState('6A');

  const deriv = isDerivative(assetClass);
  const exchangeOptions = [...new Set(products.filter((p) => p.assetClass === assetClass).map((p) => p.exchange))];
  const [exchange, setExchange] = useState(exchangeOptions[0] ?? 'CME');

  function changeAsset(ac: AssetClass) {
    setAssetClass(ac);
    setExchange([...new Set(products.filter((p) => p.assetClass === ac).map((p) => p.exchange))][0] ?? '');
  }

  const feeKey = exchange ? buildFeeKey(assetClass, exchange, session, channel, deriv ? prod : null) : null;
  const winner = feeKey ? idx.winnerFor(feeKey) : null;

  return (
    <section className="stack">
      <div className="card">
        <h2>정책 우선순위 (사전 산정)</h2>
        <p className="trace-narration">
          같은 조회키(feeKey) 안에서는 승자가 가격에 따라 바뀌지 않으므로, 계좌 무관 정책(기본 + 전체 대상 이벤트)의
          최저가 순위를 <b>룰 변경 때만</b> 미리 계산해 둔다. 체결 때는 이 순위를 <b>즉시 룩업</b>하고(재계산 없음),
          계좌에 협의가 있으면 그것만 얹어 비교한다.
        </p>

        <div className="form-grid">
          <div className="field">
            <label>자산군</label>
            <select value={assetClass} onChange={(e) => changeAsset(e.target.value as AssetClass)}>
              {ASSET_CLASSES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="field">
            <label>거래소</label>
            <select value={exchange} onChange={(e) => setExchange(e.target.value)}>
              {exchangeOptions.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          {deriv && (
            <div className="field">
              <label>품목</label>
              <input value={prod} onChange={(e) => setProd(e.target.value)} placeholder="6A" />
            </div>
          )}
          <div className="field">
            <label>세션</label>
            <select value={session} onChange={(e) => setSession(e.target.value as Session)}>
              {SESSIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label>채널</label>
            <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="check-grid">
          {winner ? (
            <>
              <span className="pill pill-active">즉시 최저가(계좌 무관): {winner.scheduleName}</span>
              <span className="badge">{winner.source === 'base' ? '기본' : '이벤트'} · {winner.name} · rank {winner.rank.toLocaleString()}</span>
            </>
          ) : (
            <span className="pill pill-pending">이 조회키에 해당하는 계좌 무관 정책이 없습니다.</span>
          )}
        </div>
        <p className="trace-narration">rank = 기준 체결(가격 100·수량 10)의 고객부과 총액. 교차가 없어 이 한 점 순위가 전 가격에서 성립.</p>
      </div>

      {ASSET_CLASSES.map((ac) => {
        const group = idx.policies.filter((p) => p.scope.assetClass === ac);
        if (group.length === 0) return null;
        const sym = ac.startsWith('해외') ? '$' : '원';
        const rankText = (n: number) => sym === '$' ? `$${n.toLocaleString()}` : `${n.toLocaleString()}원`;
        return (
          <div className="card" key={ac}>
            <h2>{ac} 정책 순위 (rank 오름차순)</h2>
            <table>
              <thead><tr><th>순위</th><th>구분</th><th>정책</th><th>적용범위</th><th>요율표</th><th>rank(기준 체결)</th></tr></thead>
              <tbody>
                {group.map((p, i) => (
                  <tr key={p.ruleId} className={winner && p.ruleId === winner.ruleId ? 'trace-winner' : undefined}>
                    <td>{i + 1}</td>
                    <td><span className={`pill ${p.source === 'base' ? 'pill-draft' : 'pill-active'}`}>{p.source === 'base' ? '기본' : '이벤트'}</span></td>
                    <td>{p.name}</td>
                    <td>{scopeText(p.scope)}</td>
                    <td>{p.scheduleName}</td>
                    <td>{rankText(p.rank)}</td>
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
