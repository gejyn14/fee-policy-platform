import { useEffect, useState } from 'react';
import { api, ApiError, type Rule, type BatchResult } from '../api/client';
import { assetLabel, ruleTypeLabel } from '../api/labels';

const TODAY = '2026-07-07';

export default function Approvals() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => api.get<Rule[]>('/api/rules')
    .then(rs => { setRules(rs.filter(r => r.status === 'PENDING')); setErr(''); })
    .catch(e => setErr(e instanceof ApiError ? e.message : '백엔드 연결 실패'));

  useEffect(() => { load(); }, []);

  const approve = async (id: string) => {
    setErr(''); setMsg('');
    try {
      const r = await api.post<BatchResult>(`/api/rules/${id}/approve?baseDate=${TODAY}`);
      setMsg(`${id} 승인 완료 — 배정판 증분: 신규 ${r.inserted} · 변경 ${r.updated} · 삭제 ${r.deleted}`);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.detail) {
        const d = e.detail as { dominanceFailure?: { price: number; candidateFee: number; incumbentFee: number } };
        const f = d.dominanceFailure;
        setErr(`${id} 승인 거부 — ${e.message}` + (f ? ` (체결가 ${f.price}: 우대 ${f.candidateFee} > 기준 ${f.incumbentFee})` : ''));
      } else setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  const reject = async (id: string) => {
    try { await api.post(`/api/rules/${id}/reject`); await load(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
  };

  return (
    <div>
      <h2>승인함 <small>(승인 대기 {rules.length}건)</small></h2>
      {err && <p style={{ color: 'crimson' }}>⚠ {err}</p>}
      {msg && <p style={{ color: 'green' }}>✓ {msg}</p>}

      {rules.length === 0 ? <p className="hint">승인 대기 룰이 없습니다. 이벤트 등록 탭에서 상신하세요.</p> : (
        <table>
          <thead><tr><th>ID</th><th>이름</th><th>타입</th><th>자산군</th><th>기간</th><th>요율표</th><th></th></tr></thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id}>
                <td>{r.id}</td><td>{r.name}</td>
                <td><span className={`tag ${r.type}`}>{ruleTypeLabel(r.type)}</span></td>
                <td>{assetLabel(r.scope.assetClass)}</td>
                <td>{r.startDate} ~ {r.endDate}</td><td>{r.scheduleId}</td>
                <td>
                  <button onClick={() => approve(r.id)}>승인</button>{' '}
                  <button onClick={() => reject(r.id)}>반려</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
