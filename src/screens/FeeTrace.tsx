import { useState } from 'react';
import { useStore } from '../store/useStore';
import { buildFeeKey, deriveFeeKey, isDerivative } from '../domain/feeKey';
import { addMonths } from '../domain/dateutil';
import { calcFee } from '../domain/calc';
import { TODAY } from '../domain/types';
import type { AssetClass, Execution, FeeComponent, Product, Session, Channel } from '../domain/types';
import { scopeMatchesKey, type ResolveResult } from '../domain/resolve';

function compText(c: FeeComponent, sym: string): string {
  if (c.rateType === '정률') return `${c.rateBp ?? 0}bp`;
  if (c.rateType === '정액') return sym === '$' ? `$${(c.flatAmount ?? 0).toLocaleString()}` : `${(c.flatAmount ?? 0).toLocaleString()}원`;
  return `구간표(${(c.bands ?? []).length}구간)`;
}

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
  const { accounts, products, schedules, resolveFee, cacheStat, enrollments, nego, policyPriority } = useStore();
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

  // 체결 시 시스템이 조회하는 테이블들(계좌 무관 정책 우선순위 · 협의 예외 · 가입/신청 이력)
  const curSym = assetClass.startsWith('해외') ? '$' : '원';
  const indieWinner = feeKey ? policyPriority().winnerFor(feeKey) : null;
  const acctGrants = feeKey
    ? nego.filter((n) => n.accountId === accountId && n.status === '활성' && n.validFrom <= TODAY && TODAY <= n.validTo && scopeMatchesKey(n.scope, feeKey))
    : [];
  const acctEnrolls = enrollments.filter((e) => e.accountId === accountId);

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
              <h2>① 체결 → 조회키 구성 <span className="badge">조회 테이블 없음</span></h2>
              <p className="trace-narration">현행(등급 방식): 계좌 → 계좌등급 → (등급·상품) 요율 조회. 정책형: 체결 값으로 조회키를 만들어 아래 테이블들을 본다.</p>
              <table>
                <thead><tr><th>계좌</th><th>상품군</th><th>거래소</th><th>세션</th><th>채널</th><th>품목</th></tr></thead>
                <tbody>
                  <tr>
                    <td>{account.id} {account.name}</td>
                    <td>{feeKey!.assetClass}</td><td>{feeKey!.exchange}</td><td>{feeKey!.session}</td><td>{feeKey!.channel}</td><td>{feeKey!.product ?? '(주식=없음)'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {hasRun && result === null && (
              <p className="empty">해석 결과 없음 — 이 조회키에 적용 가능한 정책이 없습니다.</p>
            )}

            {result && (
              <div className="card trace-step active">
                <h2>② 계좌 무관 정책 최저가 <span className="badge">[정책 우선순위 인덱스 · 사전 산정]</span></h2>
                <p className="trace-narration">조회키(feeKey)로 미리 산정된 순위에서 계좌 무관 최저가 정책을 룩업한다(재계산 없음).</p>
                {indieWinner ? (
                  <table>
                    <thead><tr><th>구분</th><th>정책</th><th>요율표(SCHEDULE_ID)</th><th>rank(기준체결)</th></tr></thead>
                    <tbody><tr>
                      <td>{indieWinner.source === 'base' ? '기본' : '이벤트'}</td>
                      <td>{indieWinner.name}</td><td>{indieWinner.scheduleId}</td>
                      <td>{curSym === '$' ? `$${indieWinner.rank.toLocaleString()}` : `${indieWinner.rank.toLocaleString()}원`}</td>
                    </tr></tbody>
                  </table>
                ) : <p className="empty">이 조회키에 해당하는 계좌 무관 정책 없음</p>}
              </div>
            )}

            {result && (
              <div className="card trace-step active">
                <h2>③ 협의 예외 조회 <span className="badge">[NEGO_GRANT · key: account_id]</span></h2>
                <p className="trace-narration">이 계좌의 활성 협의(status=활성·기간 내) 중 조회키에 걸리는 것.</p>
                {acctGrants.length > 0 ? (
                  <table>
                    <thead><tr><th>계좌</th><th>적용범위</th><th>요율표</th><th>유효기간</th><th>자격</th></tr></thead>
                    <tbody>{acctGrants.map((n, i) => (
                      <tr key={i}><td>{n.accountId}</td>
                        <td>{n.scope.assetClass}{n.scope.products !== '*' ? ` · ${(n.scope.products as string[]).join(',')}` : ''}</td>
                        <td>{n.scheduleId}</td><td>{n.validFrom} ~ {n.validTo}</td>
                        <td><span className={`pill ${n.qualify === '충족' ? 'pill-active' : 'pill-rejected'}`}>{n.qualify}</span></td>
                      </tr>
                    ))}</tbody>
                  </table>
                ) : <p className="empty">이 계좌·조회키에 활성 협의 없음</p>}
              </div>
            )}

            {result && (
              <div className="card trace-step active">
                <h2>④ 가입/신청 이력 조회 <span className="badge">[ENROLLMENT · key: account_id]</span></h2>
                <p className="trace-narration">신청형·가입형 이벤트 대상 여부와, 상대형 혜택의 가입일 기준.</p>
                {acctEnrolls.length > 0 ? (
                  <table>
                    <thead><tr><th>규칙(rule_id)</th><th>가입일</th><th>채널</th></tr></thead>
                    <tbody>{acctEnrolls.map((e, i) => (
                      <tr key={i}><td>{e.ruleId}</td><td>{e.enrolledAt}</td><td>{e.channel}</td></tr>
                    ))}</tbody>
                  </table>
                ) : <p className="empty">이 계좌의 가입/신청 이력 없음</p>}
              </div>
            )}

            {result && (
              <div className="card trace-step active">
                <h2>⑤ 최저가 확정 <span className="badge">②·③·④ 비교</span></h2>
                <table>
                  <thead><tr><th>최종 출처</th><th>SCHEDULE_ID</th><th>RULE_ID</th></tr></thead>
                  <tbody><tr className="trace-winner">
                    <td>{SOURCE_LABEL[result.source]}</td><td>{result.scheduleId}</td><td>{result.sourceRuleId ?? '-'}</td>
                  </tr></tbody>
                </table>
                <div className="check-grid">
                  {result.cacheHit ? (
                    <span className="pill pill-active">캐시 적중 — ②③④ 건너뛰고 저장된 답 사용</span>
                  ) : (
                    <span className="pill pill-pending">캐시 미스 → 계산 후 저장</span>
                  )}
                  <span className="badge">RESOLVED_CACHE · hits {stat.hits} · misses {stat.misses} · size {stat.size}</span>
                </div>
                {(() => {
                  const win = result.candidates.find((c) => c.isWinner);
                  const b = win?.rule?.benefit;
                  if (!b || b.kind !== '상대') return null;
                  const e = enrollments.find((x) => x.accountId === accountId && x.ruleId === win!.rule!.id);
                  if (!e) return null;
                  return <p className="trace-narration">적용기간: 가입일 {e.enrolledAt} + {b.months}개월 → {addMonths(e.enrolledAt, b.months)}까지(신청 마감과 무관)</p>;
                })()}
              </div>
            )}

            {result && winnerSchedule && (
              <div className="card trace-step active">
                <h2>⑥ 요율표 조회 <span className="badge">[FEE_SCHEDULE · FEE_COMPONENT · FEE_RATE_BAND]</span></h2>
                <table>
                  <thead><tr><th>구성요소</th><th>종류</th><th>부담주체</th><th>요율</th></tr></thead>
                  <tbody>{winnerSchedule.components.map((c, i) => (
                    <tr key={i} className={c.payer === '회사부담' ? 'warn' : undefined}>
                      <td>{c.name}</td><td>{c.kind}</td><td>{c.payer}</td><td>{compText(c, curSym)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <p className="trace-narration">승자 요율표({winnerSchedule.id})의 구성요소·구간을 읽어 금액 계산에 쓴다.</p>
              </div>
            )}

            {result && winnerSchedule && (
              <div className={`card trace-step active`}>
                <h2>⑦ 금액 계산 → 원장 <span className="badge">미저장 · 즉석 계산</span></h2>
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
                            <td>{curSym === '$' ? `$${l.amount.toLocaleString()}` : `${l.amount.toLocaleString()}원`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="check-grid">
                      <span className="pill pill-active">고객부과 합계 {curSym === '$' ? `$${calc.customerTotal.toLocaleString()}` : `${calc.customerTotal.toLocaleString()}원`}</span>
                      <span className="pill warn">회사부담 합계 {curSym === '$' ? `$${calc.companyBorne.toLocaleString()}` : `${calc.companyBorne.toLocaleString()}원`}</span>
                    </div>
                  </>
                )}
                <p className="trace-narration">금액은 미리 저장하지 않고 요율표 × 체결로 즉석 계산해 원장 잔고에 내린다.</p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
