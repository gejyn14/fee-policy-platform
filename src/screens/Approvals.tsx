import { useState } from 'react';
import { useStore } from '../store/useStore';
import { scopeMatches } from '../domain/binding';
import type { FeeComponent, FeeRule } from '../domain/types';

function scopeSummary(rule: FeeRule): string {
  const { scope } = rule;
  const exchanges = scope.exchanges === '*' ? '전체' : scope.exchanges.join(', ');
  const products = scope.products === '*' ? '전체' : `${scope.products.length}개`;
  return `${scope.assetClass} · 거래소 ${exchanges} · 품목 ${products} · 제외 ${scope.excludeProducts.length}개`;
}

function valueText(c: FeeComponent): string {
  if (c.rateType === '정률') return `${c.rateBp ?? 0}bp`;
  if (c.rateType === '정액') return `${(c.flatAmount ?? 0).toLocaleString()}원`;
  return `${(c.bands ?? []).length}구간`;
}

export default function Approvals() {
  const { rules, schedules, products, approveRule, rejectRule } = useStore();
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const pending = rules.filter((r) => r.status === '승인대기');

  function setReason(id: string, v: string) {
    setReasons((r) => ({ ...r, [id]: v }));
  }

  function handleReject(id: string) {
    const reason = (reasons[id] ?? '').trim();
    if (!reason) return;
    rejectRule(id, reason);
    setReasons((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
  }

  if (pending.length === 0) {
    return (
      <section>
        <p className="empty">대기 중인 결재가 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="stack">
      {pending.map((rule) => {
        const schedule = schedules.find((s) => s.id === rule.scheduleId);
        const reason = reasons[rule.id] ?? '';
        const dominanceOk = rule.warnings.dominance;
        const zeroScope = !products.some((p) => scopeMatches(rule.scope, p));

        return (
          <div className="card" key={rule.id}>
            <h3>{rule.name}</h3>
            <p>{rule.type} · {rule.applyMode} · {rule.startDate} ~ {rule.endDate} · 기안자 {rule.createdBy}</p>
            <p>{rule.log[rule.log.length - 1]}</p>

            <h2>적용범위</h2>
            <p>{scopeSummary(rule)}</p>

            <h2>요율표 구성요소</h2>
            <table>
              <thead>
                <tr><th>이름</th><th>종류</th><th>부담주체</th><th>방식</th><th>값</th><th>최소수수료</th></tr>
              </thead>
              <tbody>
                {(schedule?.components ?? []).map((c, i) => (
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

            <h2>검증 결과</h2>
            <div className="check-grid">
              <span className={`pill ${dominanceOk ? 'pill-active' : 'pill-rejected'}`}>
                지배관계 {dominanceOk ? '✓' : '✗'}
              </span>
              <span className={`pill ${zeroScope ? 'pill-pending' : rule.warnings.reverseMargin ? 'pill-rejected' : 'pill-draft'}`}>
                역마진 {zeroScope ? '판정불가' : rule.warnings.reverseMargin ? '⚠' : '-'}
              </span>
              <span className="pill">
                시뮬레이션: {rule.sim ? `대상 ${rule.sim.targets}명 · 예상 감면 ${rule.sim.saving.toLocaleString()}원` : '-'}
              </span>
            </div>

            <div className="form-grid" style={{ marginTop: 16 }}>
              <div className="field">
                <label>반려 사유</label>
                <input value={reason} onChange={(e) => setReason(rule.id, e.target.value)}
                  placeholder="반려 시 사유를 입력하세요" />
              </div>
            </div>

            <div className="actions">
              <button className="btn danger" type="button" disabled={!reason.trim()}
                onClick={() => handleReject(rule.id)}>반려</button>
              <button className="btn primary" type="button"
                onClick={() => approveRule(rule.id)}>승인</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
