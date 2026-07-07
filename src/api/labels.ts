// 백엔드 영문 코드값 ↔ 한글 라벨(스펙 §3). 표시(영문→한글)와 폼 전송(한글→영문) 양방향.

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
const RULE_STATUS: Record<string, string> = {
  DRAFT: '기안', PENDING: '승인대기', ACTIVE: '활성', REJECTED: '반려', EXPIRED: '종료',
};
const RULE_TYPE: Record<string, string> = {
  BASE: '기본', EVENT: '이벤트', NEGOTIATED: '협의',
};
const APPLY_MODE: Record<string, string> = {
  APPLICATION: '신청형', AUTO_ENROLL: '가입형', DORMANT_RETURN: '휴면복귀형', TARGETED: '타겟추출형',
};
const KIND: Record<string, string> = { OWN: '자사', AGENCY: '유관기관', TAX: '세금' };
const PAYER: Record<string, string> = { CUSTOMER: '고객부과', COMPANY: '회사부담', EXEMPT: '면제' };
const RATE_TYPE: Record<string, string> = { RATE: '정률', FLAT: '정액', BANDS: '구간표' };
const QUALIFY: Record<string, string> = { MET: '충족', EXCEPTION: '영업예외' };

const pick = (m: Record<string, string>, k: string | null) => (k ? m[k] ?? k : '—');
const rev = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).map(([en, ko]) => [ko, en]));

export const assetLabel = (k: string) => pick(ASSET, k);
export const lookupLabel = (k: string) => pick(LOOKUP, k);
export const sourceLabel = (k: string | null) => pick(SOURCE, k);
export const triggerLabel = (k: string) => pick(TRIGGER, k);
export const ruleStatusLabel = (k: string) => pick(RULE_STATUS, k);
export const ruleTypeLabel = (k: string) => pick(RULE_TYPE, k);
export const applyModeLabel = (k: string) => pick(APPLY_MODE, k);
export const kindLabel = (k: string) => pick(KIND, k);
export const payerLabel = (k: string) => pick(PAYER, k);
export const rateTypeLabel = (k: string) => pick(RATE_TYPE, k);
export const qualifyLabel = (k: string | null) => pick(QUALIFY, k);

// 폼 옵션(코드값·한글 라벨 쌍)
export const ASSET_OPTIONS = Object.entries(ASSET);
export const LOOKUP_OPTIONS = Object.entries(LOOKUP);
export const APPLY_MODE_OPTIONS = Object.entries(APPLY_MODE);
export const KIND_OPTIONS = Object.entries(KIND);
export const PAYER_OPTIONS = Object.entries(PAYER);
export const RATE_TYPE_OPTIONS = Object.entries(RATE_TYPE);

// 역방향(필요 시)
export const rateTypeCode = rev(RATE_TYPE);
