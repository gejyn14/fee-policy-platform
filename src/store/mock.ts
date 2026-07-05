import type { Account, FeeSchedule, FeeRule, Enrollment, QualifyPolicy } from '../domain/types';
import type { NegoException } from '../domain/resolve';

// 협의수수료 자격 정책 — 상품군별 표준 기준(신청 시 자동 자격판정)
export const mockQualifyPolicies: QualifyPolicy[] = [
  { assetClass: '해외주식', metric: '6개월평균자산', threshold: 500_000_000 },
  { assetClass: '해외파생', metric: '6개월약정액', threshold: 100_000_000 },
];

export const mockAccounts: Account[] = [
  { id: '110000001001', name: '김철수', grade: 'GOLD', dormantReturned: false, metric6mAsset: 850_000_000, metric6mVolume: 2_100_000_000 },
  // 배치 ② 캐스케이드 대상: nudge(+5%)로 5.145억 → 협수 문턱 5억 초과
  { id: '110000001002', name: '이영희', grade: 'SILVER', dormantReturned: false, metric6mAsset: 490_000_000, metric6mVolume: 300_000_000 },
  { id: '110000001003', name: '박민준', grade: 'SILVER', dormantReturned: true, metric6mAsset: 30_000_000, metric6mVolume: 50_000_000 },
  { id: '110000001004', name: '최수진', grade: 'GOLD', dormantReturned: false, metric6mAsset: 2_400_000_000, metric6mVolume: 9_800_000_000 },
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
  // BASE 국내파생 (KOSPI200옵션) — 실제 옵션 구조: 가격 3구간, 구간별 정률 + 정액 add-on.
  // 상위 구간에서 요율이 0.147%로 낮아져도 +78원 add-on이 보정해 단조 증가(교차 없음)를 유지한다.
  {
    id: 'FS-BASE-DERIV-KR',
    name: 'BASE 국내파생(KOSPI200옵션) 표준요율',
    components: [
      {
        name: '자사 수수료',
        kind: '자사',
        payer: '고객부과',
        rateType: '구간표',
        bands: [
          { from: 0, to: 0.42, rateBp: 14, flat: 13 },   // 0.42pt 미만: 0.14% + 13원
          { from: 0.42, to: 2.47, rateBp: 15 },           // 0.42~2.47pt: 0.15%
          { from: 2.47, to: null, rateBp: 14.7, flat: 78 }, // 2.47pt 이상: 0.147% + 78원
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
  {
    id: 'FS-EVT-SIGNUP2M',
    name: '신규 가입 2개월 무료 요율',
    components: [
      { name: '자사 수수료', kind: '자사', payer: '고객부과', rateType: '정률', rateBp: 0 },
      { name: '거래소/예탁원 수수료', kind: '유관기관', payer: '고객부과', rateType: '정률', rateBp: 0.5 },
      { name: '증권거래세', kind: '세금', payer: '고객부과', rateType: '정률', rateBp: 15 },
    ],
  },
  {
    id: 'FS-NEGO-DERIV-CME',
    name: '해외파생 CME 협의 요율',
    components: [
      { name: '위탁수수료', kind: '자사', payer: '고객부과', rateType: '정액', flatAmount: 1 },
    ],
  },
];

// ---------------------------------------------------------------------------
// 룰 (FeeRule) — BASE 5개(상품군별, 활성) + EVENT 1개(활성·타겟추출형) + NEGOTIATED 1개(활성·신청형)
//              + EVENT 발효/만료 대상 2개(배치 ① 검증용, 배치 실행 전까지는 바인딩에 영향 없음)
// ---------------------------------------------------------------------------

export const mockRules: FeeRule[] = [
  {
    id: 'RULE-BASE-STOCK-KR',
    name: 'BASE 국내주식 표준요율',
    type: 'BASE', status: '활성', applyMode: '타겟추출형',
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
    type: 'BASE', status: '활성', applyMode: '타겟추출형',
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
    type: 'BASE', status: '활성', applyMode: '타겟추출형',
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
    type: 'BASE', status: '활성', applyMode: '타겟추출형',
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
    type: 'BASE', status: '활성', applyMode: '타겟추출형',
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
    type: 'EVENT', status: '활성', applyMode: '타겟추출형',
    startDate: '2026-06-01', endDate: '2026-09-30',
    scope: { assetClass: '해외파생', exchanges: ['CME'], sessions: '*', currencies: '*', products: ['6A', '6B'], excludeProducts: [] },
    scheduleId: 'FS-EVENT-DERIV-US-CME',
    warnings: { dominance: true, reverseMargin: true },
    sim: { targets: 2, saving: 3_000_000 },
    createdBy: '마케팅팀-한지민',
    log: ['2026-05-20 마케팅팀 한지민 기안 → 2026-05-25 상품위원회 승인 → 활성'],
  },
  // ① 발효 대상: 오늘(2026-07-04) window 안이지만 아직 승인대기
  {
    id: 'RULE-EVENT-KR-PROMO',
    name: '국내주식 여름 프로모션(발효 대기)',
    type: 'EVENT', status: '승인대기', applyMode: '타겟추출형',
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
    type: 'EVENT', status: '활성', applyMode: '타겟추출형',
    startDate: '2026-03-01', endDate: '2026-06-30',
    scope: { assetClass: '국내주식', exchanges: '*', sessions: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-EVENT-KR-PROMO',
    warnings: { dominance: true, reverseMargin: false },
    createdBy: '마케팅팀',
    log: ['2026-02-25 기안 → 활성'],
  },
  // 적용기간 상대형: 신청 가능기간(2026-04~06)에 가입한 계좌는 가입일+2개월 무료.
  // 신청 마감(06-30)이 지나도 가입일+2개월까지 혜택 유지되는 것이 핵심.
  {
    id: 'RULE-EVENT-STOCK-SIGNUP2M',
    name: '신규 온라인 가입 2개월 무료',
    type: 'EVENT', status: '활성', applyMode: '가입형',
    startDate: '2026-04-01', endDate: '2026-06-30',        // 신청/유입 가능기간
    benefit: { kind: '상대', months: 2 },
    scope: { assetClass: '국내주식', exchanges: '*', sessions: '*', channels: ['HTS', 'MTS'], currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-EVT-SIGNUP2M',
    warnings: { dominance: true, reverseMargin: false },
    createdBy: '마케팅팀',
    log: ['2026-03-25 기안 → 2026-03-30 승인 → 활성'],
  },
];

export const mockEnrollments: Enrollment[] = [
  // 신규 가입 2개월 무료 — 001은 최근 가입(혜택 유효), 004는 이른 가입(혜택 만료)
  { accountId: '110000001001', ruleId: 'RULE-EVENT-STOCK-SIGNUP2M', enrolledAt: '2026-06-20', channel: 'MTS' }, // +2m=2026-08-20 유효
  { accountId: '110000001004', ruleId: 'RULE-EVENT-STOCK-SIGNUP2M', enrolledAt: '2026-04-10', channel: 'HTS' }, // +2m=2026-06-10 만료
];

// v0.5 협의수수료 overlay (계좌 인덱스 예외). A-1001은 8.5억으로 조건 충족·승인된 상태.
// A-1002는 미충족(4.9억)이라 초기 grant 없음 — 배치 ②(지표재산정)+④(조건평가)가 캐스케이드로 grant.
export const mockNego: NegoException[] = [
  { accountId: '110000001001',
    scope: { assetClass: '해외주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-NEGO-STOCK-US', validFrom: '2026-01-10', validTo: '2026-07-31',
    status: '활성', qualify: '충족', requestId: 'REQ-SEED-1', requestedBy: 'PB팀-오세훈', requestedAt: '2026-01-05', approvedAt: '2026-01-10' },
  // 연장 리뷰의 '탈락' 시연: 협의 보유하나 6개월평균자산 3천만(<5억) 미충족
  { accountId: '110000001003',
    scope: { assetClass: '해외주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-NEGO-STOCK-US', validFrom: '2026-01-10', validTo: '2026-07-31',
    status: '활성', qualify: '충족', requestId: 'REQ-SEED-1', requestedBy: 'PB팀-오세훈', requestedAt: '2026-01-05', approvedAt: '2026-01-10' },
  // 파생 품목(6A) 활성 협의 — 연장 리뷰 '품목' 축 시연
  { accountId: '110000001004',
    scope: { assetClass: '해외파생', exchanges: ['CME'], sessions: '*', channels: '*', currencies: '*', products: ['6A'], excludeProducts: [] },
    scheduleId: 'FS-NEGO-DERIV-CME', validFrom: '2026-02-01', validTo: '2026-08-15',
    status: '활성', qualify: '충족', requestId: 'REQ-SEED-2', requestedBy: 'PB팀', requestedAt: '2026-01-30', approvedAt: '2026-02-01' },
  // 승인 대기 요청 — 002 미충족(4.9억)이나 영업 bypass 요청
  { accountId: '110000001002',
    scope: { assetClass: '해외주식', exchanges: '*', sessions: '*', channels: '*', currencies: '*', products: '*', excludeProducts: [] },
    scheduleId: 'FS-NEGO-STOCK-US', validFrom: '', validTo: '',
    status: '요청', qualify: '예외', reason: '영업상 우대 필요(자산 4.9억)', requestId: 'REQ-PENDING-1', requestedBy: 'PB팀-오세훈', requestedAt: '2026-07-03' },
];
