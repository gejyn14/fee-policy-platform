import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, type Dashboard as DashboardDto, type Rule } from '../api/client';
import { assetLabel, ruleStatusLabel, ruleTypeLabel, applyModeLabel, triggerLabel, sourceLabel } from '../api/labels';

export default function Dashboard() {
  const [dash, setDash] = useState<DashboardDto | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [typeF, setTypeF] = useState('');
  const [sel, setSel] = useState<Rule | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([api.get<DashboardDto>('/api/dashboard'), api.get<Rule[]>('/api/rules')])
      .then(([d, r]) => { setDash(d); setRules(r); setErr(''); })
      .catch(e => setErr(e instanceof ApiError ? e.message : '백엔드 연결 실패 — 서버(:8080)를 확인하세요.'));
  }, []);

  const filtered = useMemo(() => rules.filter(r =>
    (!q || r.name.includes(q) || r.id.includes(q)) &&
    (!statusF || r.status === statusF) && (!typeF || r.type === typeF)), [rules, q, statusF, typeF]);

  return (
    <div>
      <h2>대시보드</h2>
      {err && <p style={{ color: 'crimson' }}>⚠ {err}</p>}

      {dash && (
        <div className="cards">
          <div className="card"><b>{dash.activeRules}</b><span>활성 룰</span></div>
          <div className="card"><b>{dash.pendingRules}</b><span>승인 대기</span></div>
          <div className="card"><b>{dash.activeNego}</b><span>활성 협의 부여</span></div>
          <div className="card"><b>{dash.bindingRows}</b><span>배정판 행(우대분)</span></div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
        <input placeholder="룰 이름·ID 검색" value={q} onChange={e => setQ(e.target.value)} />
        <select value={statusF} onChange={e => setStatusF(e.target.value)}>
          <option value="">상태 전체</option>
          {['DRAFT', 'PENDING', 'ACTIVE', 'REJECTED', 'EXPIRED'].map(s => <option key={s} value={s}>{ruleStatusLabel(s)}</option>)}
        </select>
        <select value={typeF} onChange={e => setTypeF(e.target.value)}>
          <option value="">타입 전체</option>
          {['BASE', 'EVENT', 'NEGOTIATED'].map(t => <option key={t} value={t}>{ruleTypeLabel(t)}</option>)}
        </select>
        <span className="hint">{filtered.length} / {rules.length} 룰</span>
      </div>

      <table>
        <thead><tr><th>ID</th><th>이름</th><th>타입</th><th>상태</th><th>자산군</th><th>편입</th><th>기간</th></tr></thead>
        <tbody>
          {filtered.map(r => (
            <tr key={r.id} onClick={() => setSel(r)} style={{ cursor: 'pointer' }}>
              <td>{r.id}</td><td>{r.name}</td>
              <td><span className={`tag ${r.type}`}>{ruleTypeLabel(r.type)}</span></td>
              <td>{ruleStatusLabel(r.status)}</td>
              <td>{assetLabel(r.scope.assetClass)}</td>
              <td>{applyModeLabel(r.applyMode)}</td>
              <td>{r.startDate} ~ {r.endDate}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {sel && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <h3>{sel.name} <button onClick={() => setSel(null)} style={{ float: 'right' }}>닫기</button></h3>
          <p className="hint">요율표 {sel.scheduleId} · 조회구분 {sel.scope.lookupKeys?.join(',') ?? '전체'} ·
            거래소 {sel.scope.exchanges?.join(',') ?? '전체'} · 채널 {sel.scope.channels?.join(',') ?? '전체'} ·
            품목 {sel.scope.products?.join(',') ?? '전체'}</p>
        </div>
      )}

      <h3>최근 배정 변경</h3>
      {dash && dash.recentChanges.length > 0 ? (
        <table>
          <thead><tr><th>시각</th><th>계좌</th><th>자산군</th><th>조회구분</th><th>정책</th><th>트리거</th></tr></thead>
          <tbody>
            {dash.recentChanges.map((c, i) => (
              <tr key={i}>
                <td>{c.changedAt?.slice(0, 19)}</td><td>{c.accountId}</td>
                <td>{assetLabel(c.assetClass)}</td><td>{c.lookupKey}</td>
                <td>{sourceLabel(c.newSourceType)}</td><td>{triggerLabel(c.triggerSource)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="hint">변경 이력 없음 — 배치를 실행하세요(백엔드 연동 탭).</p>}
    </div>
  );
}
