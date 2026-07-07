import { useEffect, useState } from 'react';
import { api, ApiError, type RequestGroup, type BatchResult } from '../api/client';
import { qualifyLabel } from '../api/labels';

const TODAY = '2026-07-07';

export default function NegoApproval() {
  const [groups, setGroups] = useState<RequestGroup[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => api.get<RequestGroup[]>('/api/nego/requests?status=REQUESTED')
    .then(g => { setGroups(g); setErr(''); })
    .catch(e => setErr(e instanceof ApiError ? e.message : '백엔드 연결 실패'));

  useEffect(() => { load(); }, []);

  const approve = async (requestId: string) => {
    setErr(''); setMsg('');
    try {
      const r = await api.post<BatchResult>(`/api/nego/requests/${encodeURIComponent(requestId)}/approve?baseDate=${TODAY}&approvedBy=PB팀장`);
      setMsg(`${requestId} 승인 — 배정판 증분: 신규 ${r.inserted} · 변경 ${r.updated}`);
      await load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
  };
  const reject = async (requestId: string) => {
    try { await api.post(`/api/nego/requests/${encodeURIComponent(requestId)}/reject`); await load(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
  };

  return (
    <div>
      <h2>협의 승인 <small>(대기 {groups.length}건)</small></h2>
      {err && <p style={{ color: 'crimson' }}>⚠ {err}</p>}
      {msg && <p style={{ color: 'green' }}>✓ {msg}</p>}

      {groups.length === 0 ? <p className="hint">승인 대기 협의 요청이 없습니다.</p> :
        groups.map(g => (
          <div key={g.requestId} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <b>{g.ruleName}</b> <span className="hint">· {g.requestId} · 신청자 {g.requestedBy}</span>
            <table>
              <thead><tr><th>계좌</th><th>이름</th><th>구분</th><th>사유</th></tr></thead>
              <tbody>{g.items.map(it => (
                <tr key={it.enrollmentId}><td>{it.accountId}</td><td>{it.accountName}</td>
                  <td>{qualifyLabel(it.qualifyType)}</td><td>{it.reason ?? '—'}</td></tr>
              ))}</tbody>
            </table>
            <button onClick={() => approve(g.requestId)}>일괄 승인</button>{' '}
            <button onClick={() => reject(g.requestId)}>반려</button>
          </div>
        ))}
    </div>
  );
}
