import { Fragment } from 'react';
import { useStore } from '../store/useStore';
import type { FeeComponent, FeeRule } from '../domain/types';
import { ruleTypeLabel } from './labels';

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

function targetSummary(
  rule: FeeRule,
  enrollments: ReturnType<typeof useStore.getState>['enrollments'],
  accounts: ReturnType<typeof useStore.getState>['accounts'],
): string {
  if (rule.type === 'BASE') return '전체';
  if (rule.applyMode === '신청형') return `신청 ${enrollments.filter((e) => e.ruleId === rule.id).length}건`;
  if (rule.applyMode === '휴면복귀형') return `휴면복귀 ${accounts.filter((a) => a.dormantReturned).length}명`;
  return rule.targetAccountIds ? `지정 ${rule.targetAccountIds.length}명` : '전체';
}

export default function RuleDetail({ rule }: { rule: FeeRule }) {
  const { schedules, enrollments, accounts } = useStore();
  const schedule = schedules.find((s) => s.id === rule.scheduleId);
  const dominanceOk = rule.warnings.dominance;
  // BASE 룰은 비교 기준선 자체라 "기존 대비 지배" 개념이 성립하지 않는다 → '해당없음'.
  const dominanceNA = rule.type === 'BASE';
  // 판정불가 통일: matchedProducts === 0(품목 미매칭)일 때만 두 배지 모두 판정불가.
  // matchedProducts가 undefined인 기존 mock 룰은 정상 판정 로직을 그대로 사용한다.
  const undetermined = rule.sim?.matchedProducts === 0;

  return (
    <Fragment>
      <h3>{rule.name}</h3>
      <p>{ruleTypeLabel(rule.type)} · {rule.applyMode} · {rule.startDate} ~ {rule.endDate} · 기안자 {rule.createdBy}</p>

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
        <span className={`pill ${undetermined ? 'pill-pending' : dominanceNA ? 'pill-draft' : dominanceOk ? 'pill-active' : 'pill-rejected'}`}>
          지배관계 {undetermined ? '판정불가' : dominanceNA ? '해당없음' : dominanceOk ? '✓' : '✗'}
        </span>
        <span className={`pill ${undetermined ? 'pill-pending' : rule.warnings.reverseMargin ? 'pill-rejected' : 'pill-draft'}`}>
          역마진 {undetermined ? '판정불가' : rule.warnings.reverseMargin ? '⚠' : '-'}
        </span>
        <span className="pill">
          시뮬레이션: {rule.sim ? `대상 ${rule.sim.targets}명 · 예상 감면 ${rule.sim.saving.toLocaleString()}원` : '-'}
        </span>
      </div>

      <h2>대상</h2>
      <p>{targetSummary(rule, enrollments, accounts)}</p>

      <h2>이력</h2>
      <ul>
        {rule.log.map((entry, i) => <li key={i}>{entry}</li>)}
      </ul>
    </Fragment>
  );
}
