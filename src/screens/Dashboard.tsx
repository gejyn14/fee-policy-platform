import { useStore } from '../store/useStore';
import { TODAY } from '../domain/types';

export default function Dashboard() {
  const { rules, bindings, accounts, enrollments } = useStore();
  const active = rules.filter(r => r.status === '활성');
  const pct = (r: typeof rules[0]) => {
    const [s, e, t] = [Date.parse(r.startDate), Date.parse(r.endDate), Date.parse(TODAY)];
    return Math.min(100, Math.max(0, Math.round(((t - s) / (e - s)) * 100)));
  };
  return (
    <section>
      <div className="cards">
        <div className="card"><h3>{active.filter(r => r.type === 'EVENT').length}</h3><p>활성 이벤트</p></div>
        <div className="card"><h3>{bindings.length}</h3><p>바인딩 (계좌×품목)</p></div>
        <div className="card warn"><h3>{active.filter(r => r.warnings.reverseMargin).length}</h3><p>역마진 경고 룰</p></div>
      </div>
      <h2>활성 수수료 룰</h2>
      <table>
        <thead><tr><th>이름</th><th>유형</th><th>적용형태</th><th>기간</th><th>진행률</th><th>대상</th><th>경고</th></tr></thead>
        <tbody>{active.map(r => (
          <tr key={r.id}>
            <td>{r.name}</td><td>{r.type}</td><td>{r.applyMode}</td>
            <td>{r.startDate} ~ {r.endDate}</td>
            <td><div className="bar"><div style={{ width: `${pct(r)}%` }} /></div></td>
            <td>{r.type === 'BASE' ? '전체' :
              r.applyMode === '신청형' ? `신청 ${enrollments.filter(e => e.ruleId === r.id).length}건` :
              r.applyMode === '휴면복귀형' ? `휴면복귀 ${accounts.filter(a => a.dormantReturned).length}명` :
              (r.targetAccountIds ? `지정 ${r.targetAccountIds.length}명` : '전체')}</td>
            <td>{r.warnings.reverseMargin ? '⚠ 역마진' : ''}</td>
          </tr>))}
        </tbody>
      </table>
    </section>
  );
}
