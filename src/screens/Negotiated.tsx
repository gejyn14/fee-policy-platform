import { useEffect, useState } from 'react';
import { api, ApiError, type NegoEnrollment, type ExtGroup, type BatchResult } from '../api/client';
import { qualifyLabel } from '../api/labels';

const TODAY = '2026-07-07';

export default function Negotiated() {
  const [active, setActive] = useState<NegoEnrollment[]>([]);
  const [groups, setGroups] = useState<ExtGroup[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => Promise.all([
    api.get<NegoEnrollment[]>('/api/nego/enrollments'),
    api.get<ExtGroup[]>('/api/nego/extension-candidates'),
  ]).then(([e, g]) => { setActive(e); setGroups(g); setErr(''); })
    .catch(e => setErr(e instanceof ApiError ? e.message : '백엔드 연결 실패'));

  useEffect(() => { load(); }, []);

  const toggle = (id: number) => setPicked(p => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const extend = async () => {
    setErr(''); setMsg('');
    try {
      const r = await api.post<BatchResult>(`/api/nego/extend?baseDate=${TODAY}`,
        { enrollmentIds: [...picked], months: 12 });
      setMsg(`${picked.size}건 연장 — 배정판 증분: 변경 ${r.updated}`);
      setPicked(new Set()); await load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
  };

  return (
    <div>
      <h2>협수 관리</h2>
      {err && <p style={{ color: 'crimson' }}>⚠ {err}</p>}
      {msg && <p style={{ color: 'green' }}>✓ {msg}</p>}

      <h3>활성 협의 부여 ({active.length})</h3>
      <table>
        <thead><tr><th>계좌</th><th>이름</th><th>협의룰</th><th>요율표</th><th>구분</th><th>유효기간</th></tr></thead>
        <tbody>{active.map(e => (
          <tr key={e.enrollmentId}><td>{e.accountId}</td><td>{e.accountName}</td><td>{e.ruleName}</td>
            <td>{e.scheduleId}</td><td>{qualifyLabel(e.qualifyType)}</td><td>{e.validFrom} ~ {e.validTo}</td></tr>
        ))}</tbody>
      </table>

      <h3>연장 대상 산출 <small>(그룹: 주식형=상품군 / 파생=품목)</small></h3>
      {groups.map(g => (
        <div key={g.axis + g.groupKey} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <b>{g.axis} · {g.groupKey}</b> <span className="hint">만료 {g.validTo}</span>
          <table>
            <thead><tr><th>연장</th><th>계좌</th><th>이름</th><th>판정</th><th>사유</th></tr></thead>
            <tbody>{g.candidates.map(c => (
              <tr key={c.enrollmentId} style={{ background: c.status === 'DROP' ? '#fff4f4' : undefined }}>
                <td>{c.status === 'KEEP' &&
                  <input type="checkbox" checked={picked.has(c.enrollmentId)} onChange={() => toggle(c.enrollmentId)} />}</td>
                <td>{c.accountId}</td><td>{c.accountName}</td>
                <td>{c.status === 'KEEP' ? '유지' : '탈락'}</td><td>{c.detail}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      <button onClick={extend} disabled={!picked.size}>선택 {picked.size}건 12개월 연장</button>
    </div>
  );
}
