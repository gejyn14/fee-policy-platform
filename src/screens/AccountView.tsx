import { useState } from 'react';
import { useStore } from '../store/useStore';
import { calcFee } from '../domain/calc';
import type { FeeBinding, FeeComponent, Execution } from '../domain/types';

function productName(scopeKey: string, products: ReturnType<typeof useStore.getState>['products']): string {
  const [exchange, code] = scopeKey.split(':');
  const p = products.find((x) => x.exchange === exchange && x.code === code);
  return p ? `${p.name} (${scopeKey})` : scopeKey;
}

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

export default function AccountView() {
  const { accounts, products, schedules, rules, bindings } = useStore();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [price, setPrice] = useState(100);
  const [qty, setQty] = useState(10);
  const [search, setSearch] = useState('');

  const account = accounts.find((a) => a.id === accountId);
  const accountBindings = bindings.filter((b) => b.accountId === accountId);
  const query = search.trim().toLowerCase();
  const filteredBindings = query
    ? accountBindings.filter((b) => {
        const [, code] = b.scopeKey.split(':');
        const name = productName(b.scopeKey, products);
        return (
          (code ?? '').toLowerCase().includes(query) ||
          name.toLowerCase().includes(query) ||
          b.reason.toLowerCase().includes(query)
        );
      })
    : accountBindings;
  const BINDING_DISPLAY_CAP = 50;
  const displayBindings = filteredBindings.slice(0, BINDING_DISPLAY_CAP);
  const hiddenCount = filteredBindings.length - displayBindings.length;
  const selected: FeeBinding | undefined = accountBindings.find((b) => b.scopeKey === selectedKey);
  const schedule = selected ? schedules.find((s) => s.id === selected.scheduleId) : undefined;
  const sourceRule = selected ? rules.find((r) => r.id === selected.sourceRuleId) : undefined;
  const product = selected
    ? products.find((p) => `${p.exchange}:${p.code}` === selected.scopeKey)
    : undefined;

  let simResult: ReturnType<typeof calcFee> | undefined;
  if (schedule && product) {
    const exec: Execution = {
      accountId, product, session: product.sessions[0],
      price, qty, notional: price * qty,
    };
    simResult = calcFee(schedule, exec);
  }

  return (
    <section className="stack">
      <div className="field" style={{ maxWidth: 280 }}>
        <label>계좌</label>
        <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setSelectedKey(null); }}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.id} {a.name}</option>)}
        </select>
      </div>

      {account && accountBindings.length === 0 && (
        <p className="empty">적용 중인 바인딩이 없습니다.</p>
      )}

      {accountBindings.length > 0 && (
        <div className="field" style={{ maxWidth: 320 }}>
          <label>검색 (품목코드/품목명/근거)</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="예: 6A, 삼성전자, 신규협의"
          />
        </div>
      )}

      {accountBindings.length > 0 && filteredBindings.length === 0 && (
        <p className="empty">검색 결과가 없습니다.</p>
      )}

      {displayBindings.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>품목</th>
              <th>적용 요율표</th>
              <th>근거</th>
              <th>유효기간</th>
              <th>출처 룰</th>
            </tr>
          </thead>
          <tbody>
            {displayBindings.map((b) => {
              const sched = schedules.find((s) => s.id === b.scheduleId);
              const rule = rules.find((r) => r.id === b.sourceRuleId);
              const isSelected = b.scopeKey === selectedKey;
              return (
                <tr
                  key={b.scopeKey}
                  onClick={() => setSelectedKey(b.scopeKey)}
                  className={isSelected ? 'active' : undefined}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{productName(b.scopeKey, products)}</td>
                  <td>{sched?.name ?? b.scheduleId}</td>
                  <td>{b.reason}</td>
                  <td>{b.validFrom} ~ {b.validTo}</td>
                  <td>{rule?.name ?? b.sourceRuleId}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {hiddenCount > 0 && (
        <p className="empty">그 외 {hiddenCount}건 — 검색으로 좁히세요.</p>
      )}

      {selected && schedule && (
        <div className="card">
          <h2>요율표 구성요소 — {schedule.name}</h2>
          <table>
            <thead>
              <tr><th>이름</th><th>종류</th><th>부담주체</th><th>방식</th><th>값</th><th>최소수수료</th></tr>
            </thead>
            <tbody>
              {schedule.components.map((c, i) => (
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
          {sourceRule && (
            <p style={{ marginTop: 8 }}>출처 룰: {sourceRule.name} ({sourceRule.type})</p>
          )}

          <h2 style={{ marginTop: 20 }}>체결 시뮬레이터</h2>
          <div className="form-grid">
            <div className="field">
              <label>가격</label>
              <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
            </div>
            <div className="field">
              <label>수량</label>
              <input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            </div>
          </div>

          {simResult && (
            <div style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr><th>구성요소</th><th>부담주체</th><th>구간</th><th>금액</th></tr>
                </thead>
                <tbody>
                  {simResult.lines.map((l, i) => {
                    const comp = schedule.components[i];
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
                <span className="pill pill-active">고객부과 합계 {simResult.customerTotal.toLocaleString()}원</span>
                <span className="pill warn">회사부담 합계 {simResult.companyBorne.toLocaleString()}원</span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
