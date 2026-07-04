import { Fragment, useState } from 'react';
import { useStore } from '../store/useStore';
import type { AssetClass, FeeRule, RuleStatus, RuleType } from '../domain/types';
import { TODAY } from '../domain/types';
import { ruleTypeLabel } from './labels';
import RuleDetail from './RuleDetail';

const TYPE_OPTIONS: RuleType[] = ['BASE', 'EVENT', 'NEGOTIATED'];
const STATUS_OPTIONS: RuleStatus[] = ['기안', '승인대기', '활성', '반려', '종료'];
const ASSET_OPTIONS: AssetClass[] = ['국내주식', '해외주식', '국내파생', '해외파생', '금현물'];

function statusPillClass(status: RuleStatus): string {
  if (status === '활성') return 'pill-active';
  if (status === '승인대기') return 'pill-pending';
  if (status === '반려') return 'pill-rejected';
  return 'pill-draft'; // 기안/종료
}

export default function Dashboard() {
  const { rules, bindings, accounts, enrollments } = useStore();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<RuleType | '전체'>('전체');
  const [statusFilter, setStatusFilter] = useState<RuleStatus | '전체'>('활성');
  const [assetFilter, setAssetFilter] = useState<AssetClass | '전체'>('전체');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeAll = rules.filter((r) => r.status === '활성');
  const totalSaving = rules
    .filter((r) => r.status === '활성' && r.type !== 'BASE')
    .reduce((a, r) => a + (r.sim?.saving ?? 0), 0);

  const q = query.trim().toUpperCase();
  const visible = rules.filter((r) =>
    (statusFilter === '전체' || r.status === statusFilter) &&
    (typeFilter === '전체' || r.type === typeFilter) &&
    (assetFilter === '전체' || r.scope.assetClass === assetFilter) &&
    (q === '' || r.name.toUpperCase().includes(q) || r.id.toUpperCase().includes(q) ||
      (r.scope.products !== '*' && r.scope.products.some((c) => c.toUpperCase().includes(q)))));

  const pct = (r: FeeRule) => {
    const [s, e, t] = [Date.parse(r.startDate), Date.parse(r.endDate), Date.parse(TODAY)];
    return Math.min(100, Math.max(0, Math.round(((t - s) / (e - s)) * 100)));
  };

  const COLS = 8;

  return (
    <section>
      <div className="cards">
        <div className="card"><h3>{activeAll.filter((r) => r.type === 'EVENT').length}</h3><p>활성 이벤트</p></div>
        <div className="card"><h3>{bindings.length}</h3><p>바인딩 (계좌×품목)</p></div>
        <div className="card warn"><h3>{activeAll.filter((r) => r.warnings.reverseMargin).length}</h3><p>역마진 경고 룰</p></div>
        <div className="card"><h3>{totalSaving.toLocaleString()}원</h3><p>예상 감면 누계</p></div>
      </div>

      <h2>수수료 룰</h2>
      <div className="form-grid">
        <div className="field">
          <label>검색</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름/ID/품목코드" />
        </div>
        <div className="field">
          <label>유형</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as RuleType | '전체')}>
            <option value="전체">전체</option>
            {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{ruleTypeLabel(t)}</option>)}
          </select>
        </div>
        <div className="field">
          <label>상태</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as RuleStatus | '전체')}>
            <option value="전체">전체</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label>자산군</label>
          <select value={assetFilter} onChange={(e) => setAssetFilter(e.target.value as AssetClass | '전체')}>
            <option value="전체">전체</option>
            {ASSET_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>이름</th><th>유형</th><th>상태</th><th>적용형태</th><th>기간</th><th>진행률</th><th>대상</th><th>경고</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const isOpen = expandedId === r.id;
            return (
              <Fragment key={r.id}>
                <tr onClick={() => setExpandedId(isOpen ? null : r.id)} style={{ cursor: 'pointer' }}>
                  <td>{r.name}</td>
                  <td>{ruleTypeLabel(r.type)}</td>
                  <td><span className={`pill ${statusPillClass(r.status)}`}>{r.status}</span></td>
                  <td>{r.applyMode}</td>
                  <td>{r.startDate} ~ {r.endDate}</td>
                  <td>{r.status === '활성'
                    ? <div className="bar"><div style={{ width: `${pct(r)}%` }} /></div>
                    : '-'}</td>
                  <td>{r.type === 'BASE' ? '전체' :
                    r.applyMode === '신청형' ? `신청 ${enrollments.filter((e) => e.ruleId === r.id).length}건` :
                    r.applyMode === '휴면복귀형' ? `휴면복귀 ${accounts.filter((a) => a.dormantReturned).length}명` :
                    (r.targetAccountIds ? `지정 ${r.targetAccountIds.length}명` : '전체')}</td>
                  <td>{r.warnings.reverseMargin ? '⚠ 역마진' : ''}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={COLS}>
                      <RuleDetail rule={r} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
