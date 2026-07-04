import { useState } from 'react';
import { useStore } from '../store/useStore';
import type { NegoException } from '../domain/resolve';
import type { ScopeSelector } from '../domain/types';

function scopeText(s: ScopeSelector): string {
  const parts: string[] = [s.assetClass];
  if (s.exchanges !== '*') parts.push(`거래소:${s.exchanges.join(',')}`);
  if (s.products !== '*') parts.push(`품목:${s.products.join(',')}`);
  return parts.join(' · ');
}

export default function NegoApproval() {
  const { nego, schedules, accounts, approveNegoRequest, rejectNegoRequest } = useStore();
  const [reasons, setReasons] = useState<Record<string, string>>({});

  // status '요청' grant를 requestId로 묶는다
  const requests = new Map<string, NegoException[]>();
  for (const n of nego) if (n.status === '요청') {
    const arr = requests.get(n.requestId) ?? [];
    arr.push(n); requests.set(n.requestId, arr);
  }
  const groups = [...requests.entries()];

  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  const schedName = (id: string) => schedules.find((s) => s.id === id)?.name ?? id;

  if (groups.length === 0) {
    return <section><p className="empty">대기 중인 협의 요청이 없습니다.</p></section>;
  }

  return (
    <section className="stack">
      {groups.map(([requestId, rows]) => {
        const head = rows[0];
        const reason = reasons[requestId] ?? '';
        return (
          <div className="card" key={requestId}>
            <h2>협의 요청 · {schedName(head.scheduleId)}</h2>
            <p className="trace-narration">
              적용범위 {scopeText(head.scope)} · 신청자 {head.requestedBy} · 신청일 {head.requestedAt} · 계좌 {rows.length}건
            </p>
            <table>
              <thead><tr><th>계좌</th><th>자격</th><th>사유</th></tr></thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.accountId}>
                    <td>{n.accountId} {nameOf(n.accountId)}</td>
                    <td><span className={`pill ${n.qualify === '충족' ? 'pill-active' : 'pill-rejected'}`}>{n.qualify === '충족' ? '충족' : '영업예외'}</span></td>
                    <td>{n.reason ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>반려 사유</label>
                <input value={reason} onChange={(e) => setReasons((r) => ({ ...r, [requestId]: e.target.value }))} placeholder="반려 시 사유" />
              </div>
            </div>
            <div className="actions">
              <button className="btn danger" type="button" disabled={!reason.trim()} onClick={() => rejectNegoRequest(requestId, reason.trim())}>반려</button>
              <button className="btn primary" type="button" onClick={() => approveNegoRequest(requestId)}>승인</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
