export type RuleType = 'BASE' | 'EVENT' | 'NEGOTIATED';
export type ApplyMode = '신청형' | '가입형' | '휴면복귀형' | '일괄적용형';
export type RuleStatus = '기안' | '승인대기' | '활성' | '반려' | '종료';
export type AssetClass = '국내주식' | '해외주식' | '국내파생' | '해외파생' | '금현물';
export type Payer = '고객부과' | '회사부담' | '면제';
export type Session = '프리' | '정규' | '애프터';
export type Channel = 'HTS' | 'MTS' | 'API' | 'ARS' | '센터' | '반대매매';

export interface FeeKey {
  assetClass: AssetClass; exchange: string; session: Session; channel: Channel;
  product: string | null;   // 파생만 품목, 주식은 null
}

export interface RateBand { from: number; to: number | null; rateBp?: number; flat?: number }

export interface FeeComponent {
  name: string;                       // 예: 자사 수수료, 거래소, 예탁원, 제세금
  kind: '자사' | '유관기관' | '세금';
  payer: Payer;
  rateType: '정률' | '정액' | '구간표';
  rateBp?: number;                    // 정률: 거래대금 대비 bp
  flatAmount?: number;                // 정액: 계약(주문)당 금액
  bands?: RateBand[];                 // 구간표: 체결단가 구간별 (rateBp 또는 flat)
  minFee?: number;                    // 최소수수료
}

export interface FeeSchedule { id: string; name: string; components: FeeComponent[] }

export interface ScopeSelector {
  assetClass: AssetClass;
  exchanges: string[] | '*';
  sessions: string[] | '*';
  currencies: string[] | '*';
  products: string[] | '*';           // 품목/기초자산 코드 (6A, 6B, KOSPI200옵션 등)
  excludeProducts: string[];
  channels?: Channel[] | '*';
}

export interface NegotiatedCondition {
  metric: '6개월평균자산' | '6개월약정액';
  threshold: number;
  action: '자동연장' | '승인후연장';
}

// 적용기간(혜택 기간) — 신청/유입 가능기간(startDate~endDate)과 별개.
export type BenefitPeriod =
  | { kind: '캘린더' }                    // 룰 캘린더(startDate~endDate)까지
  | { kind: '상대'; months: number };     // 가입일 + months 개월

export interface FeeRule {
  id: string; name: string;
  type: RuleType; status: RuleStatus; applyMode: ApplyMode;
  startDate: string; endDate: string;      // 'YYYY-MM-DD' (신청/유입 가능기간)
  scope: ScopeSelector; scheduleId: string;
  benefit?: BenefitPeriod;                 // 적용기간 유형. 미지정 = 캘린더(하위호환)
  condition?: NegotiatedCondition;         // NEGOTIATED 전용
  targetAccountIds?: string[];             // 일괄적용형 bulk 대상 (없으면 전체)
  warnings: { dominance: boolean; reverseMargin: boolean };
  sim?: { targets: number; saving: number; matchedProducts?: number };
  createdBy: string; log: string[];
}

export interface Enrollment { accountId: string; ruleId: string; enrolledAt: string; channel: string }

export interface Account {
  id: string; name: string; grade: string;
  dormantReturned: boolean;
  metric6mAsset: number;              // 6개월 평균 자산 (원)
  metric6mVolume: number;             // 6개월 약정액 (원)
}

export interface Product {
  assetClass: AssetClass; exchange: string; code: string; name: string;
  currency: string; sessions: string[];
}

export interface Execution {
  accountId: string; product: Product; session: string;
  price: number; qty: number; notional: number;
  channel?: Channel;
}

export interface FeeBinding {
  accountId: string; scopeKey: string;      // `${exchange}:${code}`
  scheduleId: string; sourceRuleId: string;
  validFrom: string; validTo: string; reason: string;
}

export const TODAY = '2026-07-04';

export interface BatchChange { label: string; detail: string }
export interface BatchJobResult { summary: string; changes: BatchChange[] }
