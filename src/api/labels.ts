// 백엔드 영문 코드값 → 한글 라벨(스펙 §3). 프론트 표시 전용.

const ASSET: Record<string, string> = {
  DOMESTIC_STOCK: '국내주식', OVERSEAS_STOCK: '해외주식',
  DOMESTIC_DERIV: '국내파생', OVERSEAS_DERIV: '해외파생', GOLD_SPOT: '금현물',
};
const LOOKUP: Record<string, string> = {
  FUTURES: '선물', OPTIONS: '옵션', STOCK: '주식', ETF: 'ETF', GOLD: '금',
};
const SOURCE: Record<string, string> = {
  BASE: '기본', EVENT: '이벤트', NEGOTIATED: '협의',
};
const TRIGGER: Record<string, string> = {
  DAILY_REBUILD: '일배치', DELTA: 'delta', RULE_APPROVED: '룰승인', RULE_EXPIRED: '룰종료',
  NEGO_APPROVED: '협의승인', NEGO_EXTENDED: '협의연장', ENROLLMENT: '이벤트가입', DORMANT_RETURN: '휴면복귀',
};

const pick = (m: Record<string, string>, k: string | null) => (k ? m[k] ?? k : '—');

export const assetLabel = (k: string) => pick(ASSET, k);
export const lookupLabel = (k: string) => pick(LOOKUP, k);
export const sourceLabel = (k: string | null) => pick(SOURCE, k);
export const triggerLabel = (k: string) => pick(TRIGGER, k);
