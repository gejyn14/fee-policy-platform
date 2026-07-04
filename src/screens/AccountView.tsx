import { useState } from 'react';
import { useStore } from '../store/useStore';
import { calcFee } from '../domain/calc';
import { buildFeeKey, deriveFeeKey, isDerivative } from '../domain/feeKey';
import { addMonths } from '../domain/dateutil';
import type { AssetClass, FeeComponent, Execution, Product, Session, Channel, ScopeSelector } from '../domain/types';
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
const ASSET_CLASSES: AssetClass[] = ['국내주식', '해외주식', '국내파생', '해외파생', '금현물'];
const SOURCE_LABEL: Record<'nego' | 'event' | 'base', string> = { nego: '협의', event: '이벤트', base: '기본' };

type Resolved = ResolveResult & { cacheHit: boolean };

// 주식형은 종목 없이 (거래소·세션·채널)만으로 해석 — ⑤ 체결 계산용 대표 execution을 합성한다.
function repProductFor(assetClass: AssetClass, exchange: string, session: Session): Product {
  return {
    assetClass, exchange, code: '(전체)', name: `${assetClass} · ${exchange}`,
    currency: assetClass.startsWith('해외') ? 'USD' : 'KRW', sessions: [session],
  };
}

export default function AccountView() {
  const { accounts, products, schedules, nego, resolveFee, cacheStat, enrollments } = useStore();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [assetClass, setAssetClass] = useState<AssetClass>('국내주식');
  const [exchange, setExchange] = useState<string>('KRX');
  const [search, setSearch] = useState('');
  const [productKey, setProductKey] = useState<string | null>(null);
  const [session, setSession] = useState<Session>('정규');
  const [channel, setChannel] = useState<Channel>('MTS');
  const [price, setPrice] = useState(100);
  const [qty, setQty] = useState(10);
  const [result, setResult] = useState<Resolved | null>(null);

  const isDeriv = isDerivative(assetClass);
  const account = accounts.find((a) => a.id === accountId);
  const accountNego = nego.filter((n) => n.accountId === accountId);

  const exchangeOptions = [...new Set(products.filter((p) => p.assetClass === assetClass).map((p) => p.exchange))];

  const product = isDeriv && productKey
    ? products.find((p) => `${p.exchange}:${p.code}` === productKey)
    : undefined;
  const query = search.trim().toLowerCase();
  const searchResults = (isDeriv && query)
    ? products.filter((p) => p.assetClass === assetClass
        && (p.code.toLowerCase().includes(query) || p.name.toLowerCase().includes(query))).slice(0, 20)
    : [];

  const feeKey = isDeriv
    ? (product ? deriveFeeKey(product, session, channel) : null)
    : (exchange ? buildFeeKey(assetClass, exchange, session, channel) : null);
  const repProduct = isDeriv ? product : (exchange ? repProductFor(assetClass, exchange, session) : undefined);

  function handleAccountChange(id: string) {
    setAccountId(id);
    setResult(null);
  }

  function handleAssetClassChange(ac: AssetClass) {
    setAssetClass(ac);
    const opts = [...new Set(products.filter((p) => p.assetClass === ac).map((p) => p.exchange))];
    setExchange(opts[0] ?? '');
    setProductKey(null);
    setSearch('');
    setResult(null);
  }

  function handleClearProduct() {
    setProductKey(null);
    setResult(null);
  }

  function handleResolve() {
    if (!feeKey) return;
    setResult(resolveFee(accountId, feeKey));
  }

  const winnerSchedule = result
    ? (result.candidates.find((c) => c.isWinner)?.schedule ?? schedules.find((s) => s.id === result.scheduleId))
    : undefined;

  const exec: Execution | null = (winnerSchedule && account && repProduct)
    ? { accountId, product: repProduct, session, channel, price, qty, notional: price * qty }
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
            <label>자산군</label>
            <select value={assetClass} onChange={(e) => handleAssetClassChange(e.target.value as AssetClass)}>
              {ASSET_CLASSES.map((ac) => <option key={ac} value={ac}>{ac}</option>)}
            </select>
          </div>

          {isDeriv ? (
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
                  placeholder="6A, 6B, K200OPT"
                />
              )}
            </div>
          ) : (
            <div className="field">
              <label>거래소</label>
              <select value={exchange} onChange={(e) => { setExchange(e.target.value); setResult(null); }}>
                {exchangeOptions.map((ex) => <option key={ex} value={ex}>{ex}</option>)}
              </select>
            </div>
          )}

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

        {isDeriv && !product && query && (
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
          <button className="btn primary" type="button" disabled={!account || !feeKey} onClick={handleResolve}>해석</button>
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

            {(() => {
              const win = result.candidates.find((c) => c.isWinner);
              const b = win?.rule?.benefit;
              if (!b || b.kind !== '상대') return null;
              const e = enrollments.find((x) => x.accountId === accountId && x.ruleId === win!.rule!.id);
              if (!e) return null;
              return <p className="trace-narration">적용기간: 가입일 {e.enrolledAt} + {b.months}개월 → {addMonths(e.enrolledAt, b.months)}까지(신청 마감과 무관)</p>;
            })()}

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
