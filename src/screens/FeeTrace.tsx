import { useState } from 'react';
import { useStore } from '../store/useStore';
import { buildFeeKey, deriveFeeKey, isDerivative } from '../domain/feeKey';
import { calcFee } from '../domain/calc';
import type { AssetClass, Execution, FeeComponent, Product, Session, Channel } from '../domain/types';
import type { ResolveResult } from '../domain/resolve';

// AccountView.tsx의 bandLabel (로컬 복사)
function bandLabel(c: FeeComponent, price: number): string | null {
  if (c.rateType !== '구간표') return null;
  const bands = c.bands ?? [];
  const idx = bands.findIndex((b) => price >= b.from && (b.to === null || price < b.to));
  if (idx === -1) return null;
  const b = bands[idx];
  return `구간 ${idx + 1} (${b.from}~${b.to ?? '∞'}) 적용`;
}

const SESSIONS: Session[] = ['프리', '정규', '애프터'];
const CHANNELS: Channel[] = ['HTS', 'MTS', 'API', 'ARS', '센터', '반대매매'];
const ASSET_CLASSES: AssetClass[] = ['국내주식', '해외주식', '국내파생', '해외파생', '금현물'];
const SOURCE_LABEL: Record<'nego' | 'event' | 'base', string> = { nego: '협의', event: '이벤트', base: '기본' };

type Resolved = ResolveResult & { cacheHit: boolean };

// 주식형은 종목이 아니라 (거래소·세션·채널)만으로 해석되므로, ⑤ 체결 금액 계산에 쓸
// 대표 execution을 종목 없이 합성한다. calcFee는 notional/qty/price만 참조한다.
function repProductFor(assetClass: AssetClass, exchange: string, session: Session): Product {
  return {
    assetClass, exchange, code: '(전체)', name: `${assetClass} · ${exchange}`,
    currency: assetClass.startsWith('해외') ? 'USD' : 'KRW', sessions: [session],
  };
}

export default function FeeTrace() {
  const { accounts, products, schedules, resolveFee, cacheStat } = useStore();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [assetClass, setAssetClass] = useState<AssetClass>('국내주식');
  const [exchange, setExchange] = useState<string>('KRX');
  const [productKey, setProductKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [session, setSession] = useState<Session>('정규');
  const [channel, setChannel] = useState<Channel>('MTS');
  const [price, setPrice] = useState(100);
  const [qty, setQty] = useState(10);
  const [result, setResult] = useState<Resolved | null>(null);
  const [hasRun, setHasRun] = useState(false);

  const isDeriv = isDerivative(assetClass);
  const account = accounts.find((a) => a.id === accountId);

  // 상품군별 거래소 목록(주식형 거래소 셀렉트용)
  const exchangeOptions = [...new Set(products.filter((p) => p.assetClass === assetClass).map((p) => p.exchange))];

  // 파생만 종목을 고른다. 주식형은 productKey를 쓰지 않는다(품목 붕괴).
  const product = isDeriv && productKey
    ? products.find((p) => `${p.exchange}:${p.code}` === productKey)
    : undefined;

  const query = search.trim().toLowerCase();
  const searchResults = (isDeriv && query)
    ? products.filter((p) => p.assetClass === assetClass
        && (p.code.toLowerCase().includes(query) || p.name.toLowerCase().includes(query))).slice(0, 20)
    : [];

  // feeKey: 주식형 = 거래소·세션·채널(품목 null), 파생 = 종목 기반.
  const feeKey = isDeriv
    ? (product ? deriveFeeKey(product, session, channel) : null)
    : (exchange ? buildFeeKey(assetClass, exchange, session, channel) : null);
  const ready = !!account && !!feeKey;

  const repProduct = isDeriv ? product : (exchange ? repProductFor(assetClass, exchange, session) : undefined);

  const winnerSchedule = result
    ? (result.candidates.find((c) => c.isWinner)?.schedule ?? schedules.find((s) => s.id === result.scheduleId))
    : undefined;

  const exec: Execution | null = (winnerSchedule && account && repProduct)
    ? { accountId, product: repProduct, session, channel, price, qty, notional: price * qty }
    : null;
  const calc = (winnerSchedule && exec) ? calcFee(winnerSchedule, exec) : null;
  const stat = cacheStat();

  function resetResult() {
    setResult(null);
    setHasRun(false);
  }

  function handleAccountChange(id: string) {
    setAccountId(id);
    resetResult();
  }

  function handleAssetClassChange(ac: AssetClass) {
    setAssetClass(ac);
    const opts = [...new Set(products.filter((p) => p.assetClass === ac).map((p) => p.exchange))];
    setExchange(opts[0] ?? '');
    setProductKey(null);
    setSearch('');
    resetResult();
  }

  function handleExchangeChange(v: string) {
    setExchange(v);
    resetResult();
  }

  function handleSelectProduct(key: string) {
    setProductKey(key);
    resetResult();
  }

  function handleClearProduct() {
    setProductKey(null);
    resetResult();
  }

  function handleSessionChange(v: Session) {
    setSession(v);
    resetResult();
  }

  function handleChannelChange(v: Channel) {
    setChannel(v);
    resetResult();
  }

  function handleResolve() {
    if (!feeKey) return;
    setResult(resolveFee(accountId, feeKey));
    setHasRun(true);
  }

  return (
    <section className="stack">
      <div className="form-grid">
        <div className="field">
          <label>계좌</label>
          <select value={accountId} onChange={(e) => handleAccountChange(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.id} {a.name}</option>
            ))}
          </select>
        </div>

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
            <select value={exchange} onChange={(e) => handleExchangeChange(e.target.value)}>
              {exchangeOptions.map((ex) => <option key={ex} value={ex}>{ex}</option>)}
            </select>
          </div>
        )}

        <div className="field">
          <label>세션</label>
          <select value={session} onChange={(e) => handleSessionChange(e.target.value as Session)}>
            {SESSIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="field">
          <label>채널</label>
          <select value={channel} onChange={(e) => handleChannelChange(e.target.value as Channel)}>
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
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
                  onClick={() => handleSelectProduct(`${p.exchange}:${p.code}`)}
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

      {!ready ? (
        <p className="empty">계좌와 {isDeriv ? '품목' : '거래소'}를 선택하면 결정 흐름이 단계별로 표시됩니다.</p>
      ) : (
        <>
          <div className="actions">
            <button className="btn" type="button" onClick={resetResult}>처음부터</button>
            <button className="btn primary" type="button" onClick={handleResolve}>해석</button>
            <button className="btn" type="button" disabled={!hasRun} onClick={handleResolve}>다시 해석</button>
          </div>

          <div className="stack">
            <div className="card trace-step active">
              <h2>① 컨텍스트</h2>
              <table>
                <thead>
                  <tr><th>계좌</th><th>assetClass</th><th>거래소</th><th>세션</th><th>채널</th><th>품목</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{account.id} {account.name}</td>
                    <td>{feeKey!.assetClass}</td>
                    <td>{feeKey!.exchange}</td>
                    <td>{feeKey!.session}</td>
                    <td>{feeKey!.channel}</td>
                    <td>{feeKey!.product ?? '(null)'}</td>
                  </tr>
                </tbody>
              </table>
              <p className="trace-narration">주식은 품목이 붕괴(null)돼 거래소·세션·채널로만, 파생은 품목까지가 키다.</p>
            </div>

            {hasRun && result === null && (
              <p className="empty">해석 결과 없음 — 이 feeKey에 적용 가능한 요율표 후보가 없습니다.</p>
            )}

            {result && (
              <div className="card trace-step active">
                <h2>② 후보 수집</h2>
                {result.cacheHit ? (
                  <p className="check-grid">
                    <span className="pill pill-active">캐시 적중 — 후보 재계산 생략, 저장된 답 사용</span>
                  </p>
                ) : (
                  <table>
                    <thead>
                      <tr><th>요율표</th><th>출처</th><th>평균 고객부과액</th></tr>
                    </thead>
                    <tbody>
                      {result.candidates.map((c, i) => (
                        <tr key={i}>
                          <td>{c.schedule.name}</td>
                          <td>{SOURCE_LABEL[c.source]}</td>
                          <td>{c.avgCustomerFee.toLocaleString()}원</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="trace-narration">이 계좌·feeKey에 걸리는 nego/event/base 후보를 모은다(전량 저장 아님).</p>
              </div>
            )}

            {result && !result.cacheHit && (
              <div className="card trace-step active">
                <h2>③ 최저가 경쟁</h2>
                <table>
                  <thead>
                    <tr><th>요율표</th><th>평균 고객부과액</th></tr>
                  </thead>
                  <tbody>
                    {result.candidates.map((c, i) => (
                      <tr key={i} className={c.isWinner ? 'trace-winner' : undefined}>
                        <td>
                          {c.schedule.name}
                          <span className="badge" style={{ marginLeft: 8 }}>{SOURCE_LABEL[c.source]}</span>
                          {c.isWinner && <span className="pill pill-active" style={{ marginLeft: 8 }}>최저가</span>}
                        </td>
                        <td>{c.avgCustomerFee.toLocaleString()}원</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="trace-narration">후보들의 표본 체결 평균 고객부과액을 비교해 최저가를 고른다.</p>
              </div>
            )}

            {result && (
              <div className="card trace-step active">
                <h2>④ 해석 결과</h2>
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
                <p className="trace-narration">원장은 이 해석 결과(또는 캐시된 한 행)만 쓴다. 전량 바인딩 테이블 없음.</p>
              </div>
            )}

            {result && winnerSchedule && (
              <div className={`card trace-step active`}>
                <h2>⑤ 체결 → 금액 계산</h2>
                <div className="form-grid">
                  <div className="field">
                    <label>체결가</label>
                    <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
                  </div>
                  <div className="field">
                    <label>수량</label>
                    <input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                  </div>
                </div>
                {calc && (
                  <>
                    <table>
                      <thead>
                        <tr><th>구성요소</th><th>종류</th><th>부담주체</th><th>구간</th><th>금액</th></tr>
                      </thead>
                      <tbody>
                        {calc.lines.map((l, i) => (
                          <tr key={i} className={l.payer === '회사부담' ? 'warn' : undefined}>
                            <td>{l.name}</td>
                            <td>{l.kind}</td>
                            <td>{l.payer}</td>
                            <td>{bandLabel(winnerSchedule.components[i], price) ?? '-'}</td>
                            <td>{l.amount.toLocaleString()}원</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="check-grid">
                      <span className="pill pill-active">고객부과 합계 {calc.customerTotal.toLocaleString()}원</span>
                      <span className="pill warn">회사부담 합계 {calc.companyBorne.toLocaleString()}원</span>
                    </div>
                  </>
                )}
                <p className="trace-narration">금액은 미리 저장하지 않고 요율표 × 체결로 즉석 계산해 잔고에 내린다.</p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
