import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { explainBinding } from '../domain/binding';
import { calcFee } from '../domain/calc';
import type { Execution, FeeComponent } from '../domain/types';
import { TODAY } from '../domain/types';
import { ruleTypeLabel } from './labels';

// AccountView.tsx의 bandLabel (로컬 복사)
function bandLabel(c: FeeComponent, price: number): string | null {
  if (c.rateType !== '구간표') return null;
  const bands = c.bands ?? [];
  const idx = bands.findIndex((b) => price >= b.from && (b.to === null || price < b.to));
  if (idx === -1) return null;
  const b = bands[idx];
  return `구간 ${idx + 1} (${b.from}~${b.to ?? '∞'}) 적용`;
}

export default function FeeTrace() {
  const { accounts, products, schedules, rules, enrollments, bindings } = useStore();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [productKey, setProductKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [step, setStep] = useState(1);
  const [price, setPrice] = useState(100);
  const [qty, setQty] = useState(10);

  const account = accounts.find((a) => a.id === accountId);
  const product = productKey ? products.find((p) => `${p.exchange}:${p.code}` === productKey) : undefined;
  const myEnrollments = enrollments.filter((e) => e.accountId === accountId);

  const trace = useMemo(
    () => (account && product) ? explainBinding(account, product, rules, schedules, enrollments, TODAY) : null,
    [account, product, rules, schedules, enrollments],
  );

  const winner = trace?.candidates.find((c) => c.isWinner);
  const exec: Execution | null = (winner && product)
    ? { accountId, product, session: product.sessions[0], price, qty, notional: price * qty }
    : null;
  const result = (winner && exec) ? calcFee(winner.schedule, exec) : null;

  const storedBinding = trace?.binding
    ? bindings.find((b) => b.accountId === trace.binding!.accountId && b.scopeKey === trace.binding!.scopeKey)
    : undefined;
  const bindingMatches = !!(trace?.binding && storedBinding && storedBinding.scheduleId === trace.binding.scheduleId);

  const query = search.trim().toLowerCase();
  const searchResults = query
    ? products.filter((p) => p.code.toLowerCase().includes(query) || p.name.toLowerCase().includes(query)).slice(0, 20)
    : [];

  function handleAccountChange(id: string) {
    setAccountId(id);
    setStep(1);
  }

  function handleSelectProduct(key: string) {
    setProductKey(key);
    setStep(1);
  }

  function handleClearProduct() {
    setProductKey(null);
    setStep(1);
  }

  const canAdvance = step < 5 && !!trace;

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

      {(!account || !product) ? (
        <p className="empty">계좌와 품목을 선택하면 결정 흐름이 단계별로 표시됩니다.</p>
      ) : (
        <>
          <div className="actions">
            <button className="btn" type="button" onClick={() => setStep(1)}>처음부터</button>
            <button
              className="btn primary"
              type="button"
              disabled={!canAdvance}
              onClick={() => setStep((s) => Math.min(5, s + 1))}
            >
              다음 단계
            </button>
          </div>

          <div className="stack">
            {step >= 1 && (
              <div className={`card trace-step ${step === 1 ? 'active' : ''}`}>
                <h2>① 대상 판정</h2>
                <table>
                  <thead>
                    <tr><th>계좌번호</th><th>이름</th><th>휴면복귀</th><th>협의수수료 신청</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{account.id}</td>
                      <td>{account.name}</td>
                      <td>{account.dormantReturned ? '예' : '아니오'}</td>
                      <td>{myEnrollments.length > 0 ? myEnrollments.map((e) => e.ruleId).join(', ') : '없음'}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="trace-narration">As-Is처럼 등급으로 요율표를 직접 조회하지 않는다. 각 룰이 스스로 선언한 대상(전체·지정계좌·신청·휴면복귀)에 이 계좌가 걸리는지를 판정해 후보를 모은다.</p>
              </div>
            )}

            {step >= 2 && trace && (
              <div className={`card trace-step ${step === 2 ? 'active' : ''}`}>
                <h2>② 후보 룰 수집</h2>
                <table>
                  <thead>
                    <tr><th>룰ID</th><th>이름</th><th>유형</th><th>적용형태</th><th>기간</th></tr>
                  </thead>
                  <tbody>
                    {trace.candidates.map((c) => (
                      <tr key={c.rule.id}>
                        <td>{c.rule.id}</td>
                        <td>{c.rule.name}</td>
                        <td>{ruleTypeLabel(c.rule.type)}</td>
                        <td>{c.rule.applyMode}</td>
                        <td>{c.rule.startDate} ~ {c.rule.endDate}</td>
                      </tr>
                    ))}
                    {trace.rejected.slice(0, 3).map((r) => (
                      <tr key={r.rule.id} className="trace-rejected">
                        <td>{r.rule.id}</td>
                        <td>{r.rule.name}</td>
                        <td colSpan={3}>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {trace.rejected.length > 3 && (
                  <p className="empty">외 {trace.rejected.length - 3}건</p>
                )}
                <p className="trace-narration">활성 + 적용범위 매칭 + 대상 조건을 통과한 룰만 후보가 된다. 탈락 룰과 그 사유도 함께 본다.</p>
              </div>
            )}

            {step >= 3 && trace && (
              <div className={`card trace-step ${step === 3 ? 'active' : ''}`}>
                <h2>③ 최저가 경쟁</h2>
                <table>
                  <thead>
                    <tr><th>요율표</th><th>평균 고객부과액</th></tr>
                  </thead>
                  <tbody>
                    {trace.candidates.map((c) => (
                      <tr key={c.rule.id} className={c.isWinner ? 'trace-winner' : undefined}>
                        <td>
                          {c.schedule.name}
                          {c.isWinner && <span className="pill pill-active" style={{ marginLeft: 8 }}>최저가</span>}
                        </td>
                        <td>{c.avgCustomerFee.toLocaleString()}원</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {trace.tieBreakApplied && (
                  <p className="trace-narration">동률 → 협수 &gt; 이벤트 &gt; 기본 순으로 tie-break 적용</p>
                )}
                <p className="trace-narration">후보들의 표본 체결 평균 고객부과액을 비교해 최저가를 고른다.</p>
              </div>
            )}

            {step >= 4 && trace && (
              <div className={`card trace-step ${step === 4 ? 'active' : ''}`}>
                <h2>④ 확정 바인딩</h2>
                {trace.binding === null ? (
                  <p className="empty">적용 가능한 룰 없음 (후보 0건)</p>
                ) : (
                  <>
                    <table>
                      <thead>
                        <tr>
                          <th>ACCOUNT_ID</th><th>SCOPE_KEY</th><th>SCHEDULE_ID</th>
                          <th>SOURCE_RULE_ID</th><th>VALID_FROM</th><th>VALID_TO</th><th>REASON</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{trace.binding.accountId}</td>
                          <td>{trace.binding.scopeKey}</td>
                          <td>{trace.binding.scheduleId}</td>
                          <td>{trace.binding.sourceRuleId}</td>
                          <td>{trace.binding.validFrom}</td>
                          <td>{trace.binding.validTo}</td>
                          <td>{trace.binding.reason}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="check-grid">
                      {bindingMatches ? (
                        <span className="pill pill-active">실 바인딩 테이블과 일치 ✓</span>
                      ) : (
                        <span className="pill warn">불일치 ⚠</span>
                      )}
                    </div>
                  </>
                )}
                <p className="trace-narration">원장 체결 경로는 이 한 행 조회로 끝난다 (index-only).</p>
              </div>
            )}

            {step >= 5 && (
              <div className={`card trace-step ${step === 5 ? 'active' : ''}`}>
                <h2>⑤ 체결 → 금액 계산</h2>
                {!winner ? (
                  <p className="empty">확정 요율표 없음</p>
                ) : (
                  <>
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
                    {result && (
                      <>
                        <table>
                          <thead>
                            <tr><th>구성요소</th><th>종류</th><th>부담주체</th><th>구간</th><th>금액</th></tr>
                          </thead>
                          <tbody>
                            {result.lines.map((l, i) => (
                              <tr key={i} className={l.payer === '회사부담' ? 'warn' : undefined}>
                                <td>{l.name}</td>
                                <td>{l.kind}</td>
                                <td>{l.payer}</td>
                                <td>{bandLabel(winner.schedule.components[i], price) ?? '-'}</td>
                                <td>{l.amount.toLocaleString()}원</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="check-grid">
                          <span className="pill pill-active">고객부과 합계 {result.customerTotal.toLocaleString()}원</span>
                          <span className="pill warn">회사부담 합계 {result.companyBorne.toLocaleString()}원</span>
                        </div>
                      </>
                    )}
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
