import { useState } from 'react';
import { useStore } from '../store/useStore';
import { calcFee } from '../domain/calc';
import type { FeeComponent, Execution, Session, Channel, ScopeSelector } from '../domain/types';
import type { ResolveResult } from '../domain/resolve';

function valueText(c: FeeComponent): string {
  if (c.rateType === '정률') return `${c.rateBp ?? 0}bp`;
  if (c.rateType === '정액') return `${(c.flatAmount ?? 0).toLocaleString()}원`;
  return `${(c.bands ?? []).length}구간`;
}

function bandLabel(c: FeeComponent, price: number): string | null {
  if (c.rateType !== '구간표') return null;
  const bands = c.bands ?? [];
  const idx = bands.findIndex((b) => price >= b.from && (b.to === null || price < b.to));
  if (idx === -1) return null;
  const b = bands[idx];
  return `구간 ${idx + 1} (${b.from}~${b.to ?? '∞'}) 적용`;
}

function scopeSummary(s: ScopeSelector): string {
  const parts: string[] = [s.assetClass];
  if (s.exchanges !== '*') parts.push(`거래소:${s.exchanges.join(',')}`);
  if (s.sessions !== '*') parts.push(`세션:${s.sessions.join(',')}`);
  const channels = s.channels ?? '*';
  if (channels !== '*') parts.push(`채널:${channels.join(',')}`);
  if (s.products !== '*') parts.push(`품목:${s.products.join(',')}`);
  return parts.join(' · ');
}

const SESSIONS: Session[] = ['프리', '정규', '애프터'];
const CHANNELS: Channel[] = ['HTS', 'MTS', 'API', 'ARS', '센터', '반대매매'];
const SOURCE_LABEL: Record<'nego' | 'event' | 'base', string> = { nego: '협의', event: '이벤트', base: '기본' };

type Resolved = ResolveResult & { cacheHit: boolean };

export default function AccountView() {
  const { accounts, products, schedules, nego, resolveFee, cacheStat } = useStore();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [productKey, setProductKey] = useState<string | null>(null);
  const [session, setSession] = useState<Session>('정규');
  const [channel, setChannel] = useState<Channel>('MTS');
  const [price, setPrice] = useState(100);
  const [qty, setQty] = useState(10);
  const [result, setResult] = useState<Resolved | null>(null);

  const account = accounts.find((a) => a.id === accountId);
  const accountNego = nego.filter((n) => n.accountId === accountId);

  const product = productKey ? products.find((p) => `${p.exchange}:${p.code}` === productKey) : undefined;
  const query = search.trim().toLowerCase();
  const searchResults = query
    ? products.filter((p) => p.code.toLowerCase().includes(query) || p.name.toLowerCase().includes(query)).slice(0, 20)
    : [];

  function handleAccountChange(id: string) {
    setAccountId(id);
    setResult(null);
  }

  function handleClearProduct() {
    setProductKey(null);
    setResult(null);
  }

  function handleResolve() {
    if (!account || !product) return;
    setResult(resolveFee(accountId, product, session, channel));
  }

  const winnerSchedule = result
    ? (result.candidates.find((c) => c.isWinner)?.schedule ?? schedules.find((s) => s.id === result.scheduleId))
    : undefined;

  const exec: Execution | null = (winnerSchedule && account && product)
    ? { accountId, product, session, channel, price, qty, notional: price * qty }
    : null;
  const calc = (winnerSchedule && exec) ? calcFee(winnerSchedule, exec) : null;
  const stat = cacheStat();

  return (
    <section className="stack">
      <div className="field" style={{ maxWidth: 280 }}>
        <label>계좌</label>
        <select value={accountId} onChange={(e) => handleAccountChange(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.id} {a.name}</option>)}
        </select>
      </div>

      <div className="card">
        <h2>협의 예외</h2>
        {accountNego.length === 0 ? (
          <p className="empty">이 계좌는 협의수수료 예외가 없습니다(기본/이벤트로 해석).</p>
        ) : (
          <table>
            <thead>
              <tr><th>범위(scope)</th><th>요율표</th><th>유효기간</th></tr>
            </thead>
            <tbody>
              {accountNego.map((n, i) => {
                const sched = schedules.find((s) => s.id === n.scheduleId);
                return (
                  <tr key={i}>
                    <td>{scopeSummary(n.scope)}</td>
                    <td>{sched?.name ?? n.scheduleId}</td>
                    <td>{n.validFrom} ~ {n.validTo}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="trace-narration">계좌 단위로 저장되는 건 이 예외뿐. 나머지는 체결 시 해석.</p>
      </div>

      <div className="card">
        <h2>feeKey 해석기</h2>
        <div className="form-grid">
          <div className="field">
            <label>품목</label>
            {product ? (
              <div className="check-grid">
                <span className="check-item">{product.exchange}:{product.code} {product.name}</span>
                <button className="btn" type="button" onClick={handleClearProduct}>변경</button>
              </div>
            ) : (
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="6A, 삼성전자, 005930"
              />
            )}
          </div>

          <div className="field">
            <label>세션</label>
            <select value={session} onChange={(e) => { setSession(e.target.value as Session); setResult(null); }}>
              {SESSIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="field">
            <label>채널</label>
            <select value={channel} onChange={(e) => { setChannel(e.target.value as Channel); setResult(null); }}>
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="field">
            <label>체결가</label>
            <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
          </div>
          <div className="field">
            <label>수량</label>
            <input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          </div>
        </div>

        {!product && query && (
          searchResults.length > 0 ? (
            <table>
              <thead>
                <tr><th>거래소:코드</th><th>이름</th></tr>
              </thead>
              <tbody>
                {searchResults.map((p) => (
                  <tr
                    key={`${p.exchange}:${p.code}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => { setProductKey(`${p.exchange}:${p.code}`); setResult(null); }}
                  >
                    <td>{p.exchange}:{p.code}</td>
                    <td>{p.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty">검색 결과가 없습니다.</p>
          )
        )}

        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn primary" type="button" disabled={!account || !product} onClick={handleResolve}>해석</button>
        </div>

        {result && (
          <div style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr><th>SOURCE</th><th>SCHEDULE_ID</th><th>SOURCE_RULE_ID</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>{SOURCE_LABEL[result.source]}</td>
                  <td>{result.scheduleId}</td>
                  <td>{result.sourceRuleId ?? '-'}</td>
                </tr>
              </tbody>
            </table>
            <div className="check-grid">
              {result.cacheHit ? (
                <span className="pill pill-active">캐시 적중 ✓(재계산 없음)</span>
              ) : (
                <span className="pill pill-pending">캐시 미스 → 계산 후 저장</span>
              )}
              <span className="badge">hits {stat.hits} · misses {stat.misses} · size {stat.size}</span>
            </div>

            {winnerSchedule && (
              <>
                <h2 style={{ marginTop: 20 }}>요율표 구성요소 — {winnerSchedule.name}</h2>
                <table>
                  <thead>
                    <tr><th>이름</th><th>종류</th><th>부담주체</th><th>방식</th><th>값</th><th>최소수수료</th></tr>
                  </thead>
                  <tbody>
                    {winnerSchedule.components.map((c, i) => (
                      <tr key={i} className={c.payer === '회사부담' ? 'warn' : undefined}>
                        <td>{c.name}</td>
                        <td>{c.kind}</td>
                        <td>{c.payer}</td>
                        <td>{c.rateType}</td>
                        <td>{valueText(c)}</td>
                        <td>{c.minFee != null ? c.minFee.toLocaleString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {calc && (
                  <div style={{ marginTop: 16 }}>
                    <table>
                      <thead>
                        <tr><th>구성요소</th><th>부담주체</th><th>구간</th><th>금액</th></tr>
                      </thead>
                      <tbody>
                        {calc.lines.map((l, i) => {
                          const comp = winnerSchedule.components[i];
                          const band = bandLabel(comp, price);
                          return (
                            <tr key={i} className={l.payer === '회사부담' ? 'warn' : undefined}>
                              <td>{l.name}</td>
                              <td>{l.payer}</td>
                              <td>{band ?? '-'}</td>
                              <td>{l.amount.toLocaleString()}원</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="check-grid" style={{ marginTop: 10 }}>
                      <span className="pill pill-active">고객부과 합계 {calc.customerTotal.toLocaleString()}원</span>
                      <span className="pill warn">회사부담 합계 {calc.companyBorne.toLocaleString()}원</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
