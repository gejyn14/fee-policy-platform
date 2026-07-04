import type { Account, Enrollment, FeeRule } from './types';
import { isDerivative } from './feeKey';
import { evalCondition } from './eligibility';

// 협의수수료 연장 대상 분류.
// - 신규: 신청·조건 충족했으나 아직 협의 미보유(이번에 새로 부여)
// - 유지: 협의 보유 + 여전히 충족(연장)
// - 탈락: 협의 보유했으나 이제 미충족/미신청(이번에 해지)
export type ExtStatus = '신규' | '유지' | '탈락';

export interface ExtCandidate { accountId: string; accountName: string; status: ExtStatus; detail: string }

// 그룹 축: 주식형 협의는 상품군 단위, 파생 협의는 품목별.
export interface ExtGroup {
  ruleId: string; ruleName: string;
  axis: '상품군' | '품목'; groupKey: string;
  endDate: string;
  candidates: ExtCandidate[];
  counts: { 신규: number; 유지: number; 탈락: number };
}

interface Grant { accountId: string; scheduleId: string }

export function classifyNegoExtension(
  rules: FeeRule[], accounts: Account[], enrollments: Enrollment[], nego: Grant[], today: string,
): ExtGroup[] {
  const active = rules.filter((r) => r.type === 'NEGOTIATED' && r.status === '활성' && r.startDate <= today && today <= r.endDate);
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const groups: ExtGroup[] = [];

  for (const rule of active) {
    const enrolled = (id: string) => enrollments.some((e) => e.accountId === id && e.ruleId === rule.id);
    const grant = (id: string) => nego.some((n) => n.accountId === id && n.scheduleId === rule.scheduleId);
    // 후보 = 이 룰 신청 계좌 ∪ 이 요율표 협의 보유 계좌
    const ids = new Set<string>([
      ...enrollments.filter((e) => e.ruleId === rule.id).map((e) => e.accountId),
      ...nego.filter((n) => n.scheduleId === rule.scheduleId).map((n) => n.accountId),
    ]);

    const candidates: ExtCandidate[] = [];
    for (const id of ids) {
      const acct = acctById.get(id);
      if (!acct) continue;
      const eligible = enrolled(id) && evalCondition(rule, acct);
      const has = grant(id);
      let status: ExtStatus | null = null;
      if (eligible && has) status = '유지';
      else if (eligible && !has) status = '신규';
      else if (!eligible && has) status = '탈락';
      if (!status) continue;
      const metricTxt = rule.condition
        ? `${rule.condition.metric} ${status === '탈락' ? (enrolled(id) ? '미충족' : '신청 없음') : '충족'}`
        : '조건 없음';
      candidates.push({ accountId: id, accountName: acct.name, status, detail: metricTxt });
    }
    if (candidates.length === 0) continue;

    const axis: '상품군' | '품목' = isDerivative(rule.scope.assetClass) ? '품목' : '상품군';
    const groupKey = axis === '품목'
      ? (rule.scope.products === '*' ? `${rule.scope.assetClass} 전체 품목` : (rule.scope.products as string[]).join(','))
      : rule.scope.assetClass;
    const counts = { 신규: 0, 유지: 0, 탈락: 0 };
    for (const c of candidates) counts[c.status] += 1;
    groups.push({ ruleId: rule.id, ruleName: rule.name, axis, groupKey, endDate: rule.endDate, candidates, counts });
  }
  return groups;
}
