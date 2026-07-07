import { useEffect, useState } from 'react';
import { api, ApiError, type Rule, type Account, type RequestResult } from '../api/client';
import { assetLabel, qualifyLabel } from '../api/labels';

export default function NegoRequest() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ruleId, setRuleId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RequestResult | null>(null);
  const [err, setErr] = useState('');
  const [needReason, setNeedReason] = useState(false);

  useEffect(() => {
    Promise.all([api.get<Rule[]>('/api/rules'), api.get<Account[]>('/api/accounts')])
      .then(([rs, a]) => {
        const nego = rs.filter(r => r.type === 'NEGOTIATED' && r.status === 'ACTIVE');
        setRules(nego); setAccounts(a);
        if (nego.length) setRuleId(nego[0].id);
      }).catch(e => setErr(e instanceof ApiError ? e.message : '백엔드 연결 실패'));
  }, []);

  const toggle = (id: string) => setPicked(p => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const submit = async () => {
    setErr(''); setResult(null); setNeedReason(false);
    const body = {
      accountIds: [...picked], ruleId, requestedBy: 'PB팀',
      exceptionReasons: Object.keys(reasons).length ? reasons : undefined,
    };
    try {
      setResult(await api.post<RequestResult>('/api/nego/requests', body));
    } catch (e) {
      const m = e instanceof ApiError ? e.message : String(e);
      setErr(m);
      if (m.includes('영업예외 사유')) setNeedReason(true);
    }
  };

  return (
    <div>
      <h2>협의 신청</h2>
      <p className="hint">표준 등급 협의룰을 계좌에 신청합니다. 자격은 서버가 자동판정하며, 미충족 계좌는 영업예외 사유가 필요합니다. (요율 개별조정 없음 — 표준등급 모델)</p>
      {err && <p style={{ color: 'crimson' }}>⚠ {err}</p>}

      <label>협의룰 <select value={ruleId} onChange={e => setRuleId(e.target.value)}>
        {rules.map(r => <option key={r.id} value={r.id}>{r.name} ({assetLabel(r.scope.assetClass)})</option>)}
      </select></label>

      <table>
        <thead><tr><th>선택</th><th>계좌</th><th>이름</th><th>6개월 자산</th><th>6개월 약정</th>{needReason && <th>영업예외 사유</th>}</tr></thead>
        <tbody>
          {accounts.map(a => (
            <tr key={a.id}>
              <td><input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} /></td>
              <td>{a.id}</td><td>{a.name}</td>
              <td>{a.metric6mAsset.toLocaleString()}</td><td>{a.metric6mVolume.toLocaleString()}</td>
              {needReason && <td>{picked.has(a.id) &&
                <input value={reasons[a.id] ?? ''} placeholder="미충족 시 사유"
                  onChange={e => setReasons(r => ({ ...r, [a.id]: e.target.value }))} />}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={submit} disabled={!picked.size || !ruleId}>신청 ({picked.size}건)</button>

      {result && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: 'green' }}>✓ 요청 생성: {result.requestId}</p>
          <table>
            <thead><tr><th>계좌</th><th>자격</th><th>구분</th><th>비고</th></tr></thead>
            <tbody>{result.perAccount.map(p => (
              <tr key={p.accountId}><td>{p.accountId}</td><td>{p.met ? '충족' : '미충족'}</td>
                <td>{qualifyLabel(p.qualifyType)}</td><td>{p.note}</td></tr>
            ))}</tbody>
          </table>
          <p className="hint">협의 승인 탭에서 요청번호 단위로 승인하세요.</p>
        </div>
      )}
    </div>
  );
}
