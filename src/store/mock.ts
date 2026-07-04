import type { Account, FeeSchedule, FeeRule, Enrollment } from '../domain/types';

export const mockAccounts: Account[] = [
  { id: 'A-1001', name: '김철수', grade: 'GOLD', dormantReturned: false, metric6mAsset: 850_000_000, metric6mVolume: 2_100_000_000 },
  // 배치 ② 캐스케이드 대상: nudge(+5%)로 5.145억 → 협수 문턱 5억 초과
  { id: 'A-1002', name: '이영희', grade: 'SILVER', dormantReturned: false, metric6mAsset: 490_000_000, metric6mVolume: 300_000_000 },
  { id: 'A-1003', name: '박민준', grade: 'SILVER', dormantReturned: true, metric6mAsset: 30_000_000, metric6mVolume: 50_000_000 },
  { id: 'A-1004', name: '최수진', grade: 'GOLD', dormantReturned: false, metric6mAsset: 2_400_000_000, metric6mVolume: 9_800_000_000 },
];

// ---------------------------------------------------------------------------
// 요율표 (FeeSchedule) — BASE(상품군별 5개) + EVENT(해외파생 한정 1개) + NEGOTIATED(해외주식 한정 1개)
// ---------------------------------------------------------------------------

export const mockSchedules: FeeSchedule[] = [
  // BASE 국내주식 (삼성전자)
  {
    id: 'FS-BASE-STOCK-KR',
    name: 'BASE 국내주식 표준요율',
    components: [
      { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 10 },
      { name: '거래소/예탁원 수수료', kind: '유관기관', payer: '고객부과', rateType: '정률', rateBp: 0.5 },
      { name: '증권거래세', kind: '세금', payer: '고객부과', rateType: '정률', rateBp: 15 },
    ],
  },
  // BASE 해외주식 — 정률+minFee 필수 케이스
  {
    id: 'FS-BASE-STOCK-US',
    name: 'BASE 해외주식 표준요율',
    components: [
      { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 15, minFee: 5 },
      { name: 'SEC/거래소 수수료', kind: '유관기관', payer: '고객부과', rateType: '정률', rateBp: 5 },
    ],
  },
  // BASE 국내파생 (KOSPI200옵션) — 구간표 필수 케이스
  {
    id: 'FS-BASE-DERIV-KR',
    name: 'BASE 국내파생 표준요율',
    components: [
      {
        name: '자사 수수료',
        kind: '자사',
        payer: '고객부과',
        rateType: '구간표',
        bands: [
          { from: 0, to: 3, rateBp: 30 },
          { from: 3, to: 10, rateBp: 20 },
          { from: 10, to: null, rateBp: 15 },
        ],
      },
      { name: '거래소 수수료', kind: '유관기관', payer: '고객부과', rateType: '정액', flatAmount: 300 },
    ],
  },
  // BASE 해외파생 (CME 6A/6B 등) — 계약당 3000원, EVENT보다 비싸게 설계
  {
    id: 'FS-BASE-DERIV-US',
    name: 'BASE 해외파생 표준요율',
    components: [
      { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: 3000 },
      { name: '거래소 수수료', kind: '유관기관', payer: '고객부과', rateType: '정액', flatAmount: 500 },
    ],
  },
  // BASE 금현물
  {
    id: 'FS-BASE-GOLD',
    name: 'BASE 금현물 표준요율',
    components: [
      { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 20 },
      { name: '거래소 수수료', kind: '유관기관', payer: '고객부과', rateType: '정률', rateBp: 3 },
    ],
  },
  // EVENT 해외파생 (CME 6A/6B 한정) — 유관기관분 회사부담(역마진), BASE(3000+500=3500)보다 항상 저렴(1500)
  {
    id: 'FS-EVENT-DERIV-US-CME',
    name: 'EVENT CME 6A/6B 수수료 인하',
    components: [
      { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: 1500 },
      { name: '거래소 수수료', kind: '유관기관', payer: '회사부담', rateType: '정액', flatAmount: 500 },
    ],
  },
  // NEGOTIATED 해외주식 한정 — BASE(rateBp 15+minFee 5)보다 전 구간 저렴(rateBp 8+minFee 3)
  {
    id: 'FS-NEGO-STOCK-US',
    name: '협의수수료 해외주식',
    components: [
      { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 8, minFee: 3 },
      { name: 'SEC/거래소 수수료', kind: '유관기관', payer: '고객부과', rateType: '정률', rateBp: 5 },
    ],
  },
  // EVENT 국내주식 프로모션 — BASE(자사 10bp)보다 싼 3bp (발효/만료 대상 룰 2개가 참조)
  {
    id: 'FS-EVENT-KR-PROMO',
    name: 'EVENT 국내주식 프로모션 요율',
    components: [
      { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 3 },
      { name: '거래소/예탁원 수수료', kind: '유관기관', payer: '고객부과', rateType: '정률', rateBp: 0.5 },
      { name: '증권거래세', kind: '세금', payer: '고객부과', rateType: '정률', rateBp: 15 },
    ],
  },
];

// ---------------------------------------------------------------------------
// 룰 (FeeRule) — BASE 5개(상품군별, 활성) + EVENT 1개(활성·일괄적용형) + NEGOTIATED 1개(활성·신청형)
//              + EVENT 발효/만료 대상 2개(배치 ① 검증용, 배치 실행 전까지는 바인딩에 영향 없음)
// ---------------------------------------------------------------------------

export const mockRules: FeeRule[] = [
  {
    id: 'RULE-BASE-STOCK-KR',
    name: 'BASE 국내주식 표준요율',
    type: 'BASE', status: '활성', applyMode: '일괄적용형',
    startDate: '2020-01-01', endDate: '2099-12-31',
    scope: { assetClass: '국내주식', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-BASE-STOCK-KR',
    warnings: { dominance: true, reverseMargin: false },
    createdBy: '수수료팀-정승우',
    log: ['2020-01-01 수수료팀 정승우 기안 → 상품위원회 승인 → 활성'],
  },
  {
    id: 'RULE-BASE-STOCK-US',
    name: 'BASE 해외주식 표준요율',
    type: 'BASE', status: '활성', applyMode: '일괄적용형',
    startDate: '2020-01-01', endDate: '2099-12-31',
    scope: { assetClass: '해외주식', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-BASE-STOCK-US',
    warnings: { dominance: true, reverseMargin: false },
    createdBy: '수수료팀-정승우',
    log: ['2020-01-01 수수료팀 정승우 기안 → 상품위원회 승인 → 활성'],
  },
  {
    id: 'RULE-BASE-DERIV-KR',
    name: 'BASE 국내파생 표준요율',
    type: 'BASE', status: '활성', applyMode: '일괄적용형',
    startDate: '2020-01-01', endDate: '2099-12-31',
    scope: { assetClass: '국내파생', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-BASE-DERIV-KR',
    warnings: { dominance: true, reverseMargin: false },
    createdBy: '수수료팀-정승우',
    log: ['2020-01-01 수수료팀 정승우 기안 → 상품위원회 승인 → 활성'],
  },
  {
    id: 'RULE-BASE-DERIV-US',
    name: 'BASE 해외파생 표준요율',
    type: 'BASE', status: '활성', applyMode: '일괄적용형',
    startDate: '2020-01-01', endDate: '2099-12-31',
    scope: { assetClass: '해외파생', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-BASE-DERIV-US',
    warnings: { dominance: true, reverseMargin: false },
    createdBy: '수수료팀-정승우',
    log: ['2020-01-01 수수료팀 정승우 기안 → 상품위원회 승인 → 활성'],
  },
  {
    id: 'RULE-BASE-GOLD',
    name: 'BASE 금현물 표준요율',
    type: 'BASE', status: '활성', applyMode: '일괄적용형',
    startDate: '2020-01-01', endDate: '2099-12-31',
    scope: { assetClass: '금현물', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-BASE-GOLD',
    warnings: { dominance: true, reverseMargin: false },
    createdBy: '수수료팀-정승우',
    log: ['2020-01-01 수수료팀 정승우 기안 → 상품위원회 승인 → 활성'],
  },
  {
    id: 'RULE-EVENT-CME-SUMMER',
    name: '2026 여름 CME 6A/6B 수수료 인하 이벤트',
    type: 'EVENT', status: '활성', applyMode: '일괄적용형',
    startDate: '2026-06-01', endDate: '2026-09-30',
    scope: { assetClass: '해외파생', exchanges: ['CME'], sessions: '*', currencies: '*', products: ['6A', '6B'], excludeProducts: [] },
    scheduleId: 'FS-EVENT-DERIV-US-CME',
    warnings: { dominance: true, reverseMargin: true },
    sim: { targets: 2, saving: 3_000_000 },
    createdBy: '마케팅팀-한지민',
    log: ['2026-05-20 마케팅팀 한지민 기안 → 2026-05-25 상품위원회 승인 → 활성'],
  },
  {
    id: 'RULE-NEGO-STOCK-US',
    name: '해외주식 우수고객 협의수수료',
    type: 'NEGOTIATED', status: '활성', applyMode: '신청형',
    startDate: '2026-01-01', endDate: '2026-12-31',
    scope: { assetClass: '해외주식', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-NEGO-STOCK-US',
    condition: { metric: '6개월평균자산', threshold: 500_000_000, action: '승인후연장' },
    warnings: { dominance: true, reverseMargin: false },
    sim: { targets: 1, saving: 450_000 },
    createdBy: 'PB팀-오세훈',
    log: ['2026-01-05 PB팀 오세훈 기안 → 2026-01-10 지점장 승인 → 활성'],
  },
  // ① 발효 대상: 오늘(2026-07-04) window 안이지만 아직 승인대기
  {
    id: 'RULE-EVENT-KR-PROMO',
    name: '국내주식 여름 프로모션(발효 대기)',
    type: 'EVENT', status: '승인대기', applyMode: '일괄적용형',
    startDate: '2026-07-01', endDate: '2026-09-30',
    scope: { assetClass: '국내주식', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-EVENT-KR-PROMO',
    warnings: { dominance: true, reverseMargin: false },
    createdBy: '마케팅팀',
    log: ['2026-06-28 기안 → 승인대기'],
  },
  // ① 만료 대상: 활성이지만 endDate가 오늘 이전
  {
    id: 'RULE-EVENT-KR-SPRING',
    name: '국내주식 봄 이벤트(만료 대상)',
    type: 'EVENT', status: '활성', applyMode: '일괄적용형',
    startDate: '2026-03-01', endDate: '2026-06-30',
    scope: { assetClass: '국내주식', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-EVENT-KR-PROMO',
    warnings: { dominance: true, reverseMargin: false },
    createdBy: '마케팅팀',
    log: ['2026-02-25 기안 → 활성'],
  },
];

export const mockEnrollments: Enrollment[] = [
  { accountId: 'A-1001', ruleId: 'RULE-NEGO-STOCK-US', enrolledAt: '2026-01-15', channel: 'HTS' },
  { accountId: 'A-1002', ruleId: 'RULE-NEGO-STOCK-US', enrolledAt: '2026-03-02', channel: '지점' },
];
