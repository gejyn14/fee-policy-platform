import type { Account, QualifyPolicy } from './types';
import type { NegoException } from './resolve';
import { isDerivative } from './feeKey';
import { qualifyOf } from './qualify';

// 협의수수료 연장 대상 분류(만료 임박 재평가).
// - 유지: 정책 재충족 또는 영업예외(bypass) 건
// - 탈락: 자격 미충족(예외 아님) → 해지 대상
// 그룹 축: 주식형 협의는 상품군, 파생 협의는 품목.
export type ExtStatus = '유지' | '탈락';

export interface ExtCandidate { accountId: string; accountName: string; status: ExtStatus; detail: string }

export interface ExtGroup {
  axis: '상품군' | '품목'; groupKey: string; endDate: string;
  candidates: ExtCandidate[]; counts: { 유지: number; 탈락: number };
}

export function classifyNegoExtension(nego: NegoException[], accounts: Account[], policies: QualifyPolicy[]): ExtGroup[] {
  const active = nego.filter((n) => n.status === '활성');
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const groups = new Map<string, ExtGroup>();

  for (const g of active) {
    const acct = acctById.get(g.accountId);
    if (!acct) continue;
    const ac = g.scope.assetClass;
    const deriv = isDerivative(ac);
    const axis: '상품군' | '품목' = deriv ? '품목' : '상품군';
    const groupKey = deriv
      ? (g.scope.products === '*' ? `${ac} 전체 품목` : (g.scope.products as string[]).join(','))
      : ac;
    const mapKey = `${axis}:${groupKey}`;

    const met = qualifyOf(policies, ac, acct).met;
    const status: ExtStatus = g.qualify === '예외' ? '유지' : (met ? '유지' : '탈락');
    const detail = g.qualify === '예외' ? '영업예외(수동 검토)' : (met ? '자격 충족' : '자격 미충족 → 해지 대상');

    const grp = groups.get(mapKey) ?? { axis, groupKey, endDate: g.validTo, candidates: [], counts: { 유지: 0, 탈락: 0 } };
    grp.candidates.push({ accountId: g.accountId, accountName: acct.name, status, detail });
    grp.counts[status] += 1;
    groups.set(mapKey, grp);
  }
  return [...groups.values()];
}
