-- 키움증권 실제 매매수수료 체계 재시드 (dev DB 전용)
-- 실행: psql -h localhost -p 5433 -U fees -d fees -f docs/scripts/키움수수료_실데이터_reseed.sql
-- 주의: Flyway 시드(V2·V3)는 테스트 91건의 픽스처라 그대로 두고, 이 스크립트는 dev DB만 갈아끼운다.
--       계좌·개설 상품군·계좌 지표는 유지하고 정책(요율표·규칙·편입내역·배정판·이력)만 전량 교체.
--
-- 매핑 원칙
--   매체 열(영웅문4/S#/웹·오픈API/ARS/금융센터/반대매매) → 채널 축 {HTS, MTS, API, ARS, 센터, 반대매매}
--     * 증권통(0.05%)·트레이딩뷰는 매체 축에 없어 제외
--   KRX/NXT, 미국/홍콩/일본 → 거래소 축 (KRX, NXT, NASDAQ, NYSE, HKEX, TSE)
--   야간 상품 → 세션 축 NIGHT (자사율 동일, 유관기관·옵션 구간이 다름)
--   옵션 가격 구간별 수수료 → 구간표(BANDS), 유관기관도 구간표
--   협의 등급표("N억원 이상 → x% 이상") → 협의 표준 등급 룰(값은 등급 하한)
--   신규 1개월 할인 → 상대형(+1개월) 이벤트, 자사분 면제(0%)로 해석
--   세율: 코스피(거래세0.05%+농특세0.15%)·코스닥(0.20%) 모두 매도분 0.20% → 20bp 단일 성분으로 근사
--   유관기관 소수점 5자리 이하는 rate_bp numeric(10,4)에 맞춰 반올림 (예: 0.0036396% → 0.3640bp)

BEGIN;

-- ===== 정책 전량 삭제 =====
DELETE FROM fee_binding;
DELETE FROM fee_binding_history;
DELETE FROM fee_enrollment;
DELETE FROM fee_rule;
DELETE FROM fee_component;
DELETE FROM fee_schedule;

-- ===== 상품 마스터 보강 (국내파생) =====
INSERT INTO product(asset_class, exchange_code, product_code, product_name, currency, sessions) VALUES
  ('DOMESTIC_DERIV','KRX','MK200','미니 KOSPI200',   'KRW', ARRAY['REGULAR','NIGHT']),
  ('DOMESTIC_DERIV','KRX','KQ150','코스닥150',       'KRW', ARRAY['REGULAR','NIGHT']),
  ('DOMESTIC_DERIV','KRX','KTB3', '3년 국채',        'KRW', ARRAY['REGULAR','NIGHT']),
  ('DOMESTIC_DERIV','KRX','KTB10','10년 국채',       'KRW', ARRAY['REGULAR','NIGHT']),
  ('DOMESTIC_DERIV','KRX','USDF', '미국달러선물',    'KRW', ARRAY['REGULAR','NIGHT']),
  ('DOMESTIC_DERIV','KRX','GOLDF','금선물',          'KRW', ARRAY['REGULAR'])
ON CONFLICT (asset_class, exchange_code, product_code) DO NOTHING;
UPDATE product SET sessions = ARRAY['REGULAR','NIGHT']
 WHERE asset_class = 'DOMESTIC_DERIV' AND product_code = 'K200';

-- ===== 자격 기준 (자산군 단위 근사: 해당 자산군 최저 등급 문턱) =====
INSERT INTO qualify_policy(asset_class, metric, threshold) VALUES
  ('DOMESTIC_STOCK', 'VOLUME_6M',    15000000000),   -- 월 약정 150억
  ('DOMESTIC_DERIV', 'VOLUME_6M',     2000000000),   -- 옵션 최저 등급 20억
  ('OVERSEAS_STOCK', 'AVG_ASSET_6M',   100000000),   -- 미국ETF 최저 등급 예탁 1억
  ('OVERSEAS_DERIV', 'VOLUME_6M',      100000000)
ON CONFLICT (asset_class) DO UPDATE SET metric = EXCLUDED.metric, threshold = EXCLUDED.threshold;

-- ============================================================
-- 국내주식 (DOMESTIC_STOCK)
-- ============================================================
INSERT INTO fee_schedule(schedule_id, schedule_name) VALUES
  ('SCH-DS-ON-KRX',  '국내주식 온라인(KRX) 0.015%'),
  ('SCH-DS-ON-NXT',  '국내주식 온라인(NXT) 0.0145%'),
  ('SCH-DS-ARS',     '국내주식 ARS 0.15%'),
  ('SCH-DS-CT',      '국내주식 금융센터·반대매매 0.3%'),
  ('SCH-DS-NEGO-T1', '국내주식 협의 1등급 0.011%'),
  ('SCH-DS-NEGO-T2', '국내주식 협의 2등급 0.012%'),
  ('SCH-DS-NEGO-T3', '국내주식 협의 3등급 0.013%'),
  ('SCH-DS-NEGO-T4', '국내주식 협의 4등급 0.014%'),
  ('SCH-DS-EVT-NEW', '국내주식 신규 1개월 자사분 면제');

INSERT INTO fee_component(schedule_id, seq, name, kind, payer, rate_type, rate_bp, flat_amount) VALUES
  ('SCH-DS-ON-KRX', 0, '자사 수수료',              'OWN',    'CUSTOMER', 'RATE', 1.5,    NULL),
  ('SCH-DS-ON-KRX', 1, '유관기관 수수료·제비용',    'AGENCY', 'CUSTOMER', 'RATE', 0.3640, NULL),
  ('SCH-DS-ON-KRX', 2, '증권거래세·농특세(매도분)', 'TAX',    'CUSTOMER', 'RATE', 20,     NULL),
  ('SCH-DS-ON-NXT', 0, '자사 수수료',              'OWN',    'CUSTOMER', 'RATE', 1.45,   NULL),
  ('SCH-DS-ON-NXT', 1, '유관기관 수수료·제비용',    'AGENCY', 'CUSTOMER', 'RATE', 0.3183, NULL),
  ('SCH-DS-ON-NXT', 2, '증권거래세·농특세(매도분)', 'TAX',    'CUSTOMER', 'RATE', 20,     NULL),
  ('SCH-DS-ARS',    0, '자사 수수료',              'OWN',    'CUSTOMER', 'RATE', 15,     NULL),
  ('SCH-DS-ARS',    1, '유관기관 수수료·제비용',    'AGENCY', 'CUSTOMER', 'RATE', 0.3640, NULL),
  ('SCH-DS-ARS',    2, '증권거래세·농특세(매도분)', 'TAX',    'CUSTOMER', 'RATE', 20,     NULL),
  ('SCH-DS-CT',     0, '자사 수수료',              'OWN',    'CUSTOMER', 'RATE', 30,     NULL),
  ('SCH-DS-CT',     1, '유관기관 수수료·제비용',    'AGENCY', 'CUSTOMER', 'RATE', 0.3640, NULL),
  ('SCH-DS-CT',     2, '증권거래세·농특세(매도분)', 'TAX',    'CUSTOMER', 'RATE', 20,     NULL),
  ('SCH-DS-NEGO-T1',0, '자사 수수료',              'OWN',    'CUSTOMER', 'RATE', 1.1,    NULL),
  ('SCH-DS-NEGO-T1',1, '유관기관 수수료·제비용',    'AGENCY', 'CUSTOMER', 'RATE', 0.3640, NULL),
  ('SCH-DS-NEGO-T1',2, '증권거래세·농특세(매도분)', 'TAX',    'CUSTOMER', 'RATE', 20,     NULL),
  ('SCH-DS-NEGO-T2',0, '자사 수수료',              'OWN',    'CUSTOMER', 'RATE', 1.2,    NULL),
  ('SCH-DS-NEGO-T2',1, '유관기관 수수료·제비용',    'AGENCY', 'CUSTOMER', 'RATE', 0.3640, NULL),
  ('SCH-DS-NEGO-T2',2, '증권거래세·농특세(매도분)', 'TAX',    'CUSTOMER', 'RATE', 20,     NULL),
  ('SCH-DS-NEGO-T3',0, '자사 수수료',              'OWN',    'CUSTOMER', 'RATE', 1.3,    NULL),
  ('SCH-DS-NEGO-T3',1, '유관기관 수수료·제비용',    'AGENCY', 'CUSTOMER', 'RATE', 0.3640, NULL),
  ('SCH-DS-NEGO-T3',2, '증권거래세·농특세(매도분)', 'TAX',    'CUSTOMER', 'RATE', 20,     NULL),
  ('SCH-DS-NEGO-T4',0, '자사 수수료',              'OWN',    'CUSTOMER', 'RATE', 1.4,    NULL),
  ('SCH-DS-NEGO-T4',1, '유관기관 수수료·제비용',    'AGENCY', 'CUSTOMER', 'RATE', 0.3640, NULL),
  ('SCH-DS-NEGO-T4',2, '증권거래세·농특세(매도분)', 'TAX',    'CUSTOMER', 'RATE', 20,     NULL),
  ('SCH-DS-EVT-NEW',0, '자사 수수료(면제)',         'OWN',    'CUSTOMER', 'RATE', 0,      NULL),
  ('SCH-DS-EVT-NEW',1, '유관기관 수수료·제비용',    'AGENCY', 'CUSTOMER', 'RATE', 0.3640, NULL),
  ('SCH-DS-EVT-NEW',2, '증권거래세·농특세(매도분)', 'TAX',    'CUSTOMER', 'RATE', 20,     NULL);

INSERT INTO fee_rule(rule_id, rule_name, rule_type, rule_status, apply_mode, start_date, end_date,
    benefit_kind, benefit_months, schedule_id, scope_asset_class, scope_exchanges, scope_sessions,
    scope_lookup_keys, scope_products, scope_channels) VALUES
  ('R-DS-BASE-ON',  '국내주식 온라인 기본(KRX)', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DS-ON-KRX', 'DOMESTIC_STOCK', ARRAY['KRX'], NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-DS-BASE-NXT', '국내주식 온라인 기본(NXT)', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DS-ON-NXT', 'DOMESTIC_STOCK', ARRAY['NXT'], NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-DS-BASE-ARS', '국내주식 ARS 기본',         'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DS-ARS', 'DOMESTIC_STOCK', ARRAY['KRX'], NULL, NULL, NULL, ARRAY['ARS']),
  ('R-DS-BASE-CT',  '국내주식 금융센터·반대매매 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DS-CT', 'DOMESTIC_STOCK', ARRAY['KRX'], NULL, NULL, NULL, ARRAY['센터','반대매매']),
  ('R-DS-NEGO-T1', '국내주식 협의 1등급(월 약정 1,000억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DS-NEGO-T1', 'DOMESTIC_STOCK', ARRAY['KRX'], NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-DS-NEGO-T2', '국내주식 협의 2등급(월 약정 500억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DS-NEGO-T2', 'DOMESTIC_STOCK', ARRAY['KRX'], NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-DS-NEGO-T3', '국내주식 협의 3등급(월 약정 300억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DS-NEGO-T3', 'DOMESTIC_STOCK', ARRAY['KRX'], NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-DS-NEGO-T4', '국내주식 협의 4등급(월 약정 150억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DS-NEGO-T4', 'DOMESTIC_STOCK', ARRAY['KRX'], NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-DS-EVT-NEW', '국내주식 신규고객 1개월 수수료 할인', 'EVENT', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '2026-12-31',
   'RELATIVE', 1, 'SCH-DS-EVT-NEW', 'DOMESTIC_STOCK', NULL, NULL, NULL, NULL, ARRAY['HTS','MTS','API']);

-- ============================================================
-- 국내파생 (DOMESTIC_DERIV)
-- ============================================================
INSERT INTO fee_schedule(schedule_id, schedule_name) VALUES
  ('SCH-DD-IDXF',        '지수선물(K200·미니) 0.003%'),
  ('SCH-DD-KQF',         '코스닥150선물 0.003%'),
  ('SCH-DD-K200O',       'K200옵션 구간표 0.14~0.15%'),
  ('SCH-DD-IDXF-N',      '야간 지수선물 0.003%'),
  ('SCH-DD-K200O-N',     '야간 K200옵션 구간표'),
  ('SCH-DD-KTB',         '국채선물 0.0025%'),
  ('SCH-DD-USD',         '미국달러선물 550원/계약'),
  ('SCH-DD-GOLD',        '금선물 0.007%'),
  ('SCH-DD-CT-F',        '선물 금융센터·반대매매 0.03%'),
  ('SCH-DD-CT-O',        '옵션 금융센터·반대매매 1.0%'),
  ('SCH-DD-NEGO-K2F-T1', 'K200선물 협의 1등급 0.001%'),
  ('SCH-DD-NEGO-K2F-T2', 'K200선물 협의 2등급 0.0018%'),
  ('SCH-DD-NEGO-K2F-T3', 'K200선물 협의 3등급 0.0021%'),
  ('SCH-DD-NEGO-K2F-T4', 'K200선물 협의 4등급 0.0024%'),
  ('SCH-DD-NEGO-USD-T1', '달러선물 협의 1등급 150원'),
  ('SCH-DD-NEGO-USD-T2', '달러선물 협의 2등급 200원'),
  ('SCH-DD-NEGO-USD-T3', '달러선물 협의 3등급 400원'),
  ('SCH-DD-NEGO-K2O-T1', 'K200옵션 협의 1등급 0.05%'),
  ('SCH-DD-NEGO-K2O-T2', 'K200옵션 협의 2등급 0.08%'),
  ('SCH-DD-NEGO-K2O-T3', 'K200옵션 협의 3등급 0.10%'),
  ('SCH-DD-NEGO-K2O-T4', 'K200옵션 협의 4등급 0.12%'),
  ('SCH-DD-EVT-NEW',     '선물옵션 신규 1개월 자사분 면제(지수선물)');

INSERT INTO fee_component(schedule_id, seq, name, kind, payer, rate_type, rate_bp, flat_amount, bands) VALUES
  ('SCH-DD-IDXF',   0, '자사 수수료',   'OWN',    'CUSTOMER', 'RATE', 0.3,    NULL, NULL),
  ('SCH-DD-IDXF',   1, '유관기관 수수료','AGENCY', 'CUSTOMER', 'RATE', 0.0251, NULL, NULL),
  ('SCH-DD-KQF',    0, '자사 수수료',   'OWN',    'CUSTOMER', 'RATE', 0.3,    NULL, NULL),
  ('SCH-DD-KQF',    1, '유관기관 수수료','AGENCY', 'CUSTOMER', 'RATE', 0.1405, NULL, NULL),
  ('SCH-DD-K200O',  0, '자사 수수료',   'OWN',    'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.42,"rateBp":14,"flat":13},{"from":0.42,"to":2.47,"rateBp":15,"flat":null},{"from":2.47,"to":null,"rateBp":14.7,"flat":78}]'::jsonb),
  ('SCH-DD-K200O',  1, '유관기관 수수료','AGENCY', 'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.42,"rateBp":null,"flat":13},{"from":0.42,"to":2.47,"rateBp":1.2654,"flat":null},{"from":2.47,"to":null,"rateBp":null,"flat":78}]'::jsonb),
  ('SCH-DD-IDXF-N', 0, '자사 수수료',   'OWN',    'CUSTOMER', 'RATE', 0.3,    NULL, NULL),
  ('SCH-DD-IDXF-N', 1, '유관기관 수수료','AGENCY', 'CUSTOMER', 'RATE', 0.0439, NULL, NULL),
  ('SCH-DD-K200O-N',0, '자사 수수료',   'OWN',    'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.41,"rateBp":14,"flat":24},{"from":0.41,"to":2.47,"rateBp":15,"flat":null},{"from":2.47,"to":null,"rateBp":14.7,"flat":145}]'::jsonb),
  ('SCH-DD-K200O-N',1, '유관기관 수수료','AGENCY', 'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.41,"rateBp":null,"flat":24},{"from":0.41,"to":2.47,"rateBp":2.3549,"flat":null},{"from":2.47,"to":null,"rateBp":null,"flat":145}]'::jsonb),
  ('SCH-DD-KTB',    0, '자사 수수료',   'OWN',    'CUSTOMER', 'RATE', 0.25,   NULL, NULL),
  ('SCH-DD-KTB',    1, '유관기관 수수료','AGENCY', 'CUSTOMER', 'RATE', 0.0167, NULL, NULL),
  ('SCH-DD-USD',    0, '자사 수수료',   'OWN',    'CUSTOMER', 'FLAT', NULL,   550,  NULL),
  ('SCH-DD-USD',    1, '유관기관 수수료','AGENCY', 'CUSTOMER', 'RATE', 0.0316, NULL, NULL),
  ('SCH-DD-GOLD',   0, '자사 수수료',   'OWN',    'CUSTOMER', 'RATE', 0.7,    NULL, NULL),
  ('SCH-DD-GOLD',   1, '유관기관 수수료','AGENCY', 'CUSTOMER', 'RATE', 0.1853, NULL, NULL),
  ('SCH-DD-CT-F',   0, '자사 수수료',   'OWN',    'CUSTOMER', 'RATE', 3,      NULL, NULL),
  ('SCH-DD-CT-F',   1, '유관기관 수수료','AGENCY', 'CUSTOMER', 'RATE', 0.0251, NULL, NULL),
  ('SCH-DD-CT-O',   0, '자사 수수료',   'OWN',    'CUSTOMER', 'RATE', 100,    NULL, NULL),
  ('SCH-DD-CT-O',   1, '유관기관 수수료','AGENCY', 'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.42,"rateBp":null,"flat":13},{"from":0.42,"to":2.47,"rateBp":1.2654,"flat":null},{"from":2.47,"to":null,"rateBp":null,"flat":78}]'::jsonb),
  ('SCH-DD-NEGO-K2F-T1', 0, '자사 수수료', 'OWN', 'CUSTOMER', 'RATE', 0.10, NULL, NULL),
  ('SCH-DD-NEGO-K2F-T1', 1, '유관기관 수수료', 'AGENCY', 'CUSTOMER', 'RATE', 0.0251, NULL, NULL),
  ('SCH-DD-NEGO-K2F-T2', 0, '자사 수수료', 'OWN', 'CUSTOMER', 'RATE', 0.18, NULL, NULL),
  ('SCH-DD-NEGO-K2F-T2', 1, '유관기관 수수료', 'AGENCY', 'CUSTOMER', 'RATE', 0.0251, NULL, NULL),
  ('SCH-DD-NEGO-K2F-T3', 0, '자사 수수료', 'OWN', 'CUSTOMER', 'RATE', 0.21, NULL, NULL),
  ('SCH-DD-NEGO-K2F-T3', 1, '유관기관 수수료', 'AGENCY', 'CUSTOMER', 'RATE', 0.0251, NULL, NULL),
  ('SCH-DD-NEGO-K2F-T4', 0, '자사 수수료', 'OWN', 'CUSTOMER', 'RATE', 0.24, NULL, NULL),
  ('SCH-DD-NEGO-K2F-T4', 1, '유관기관 수수료', 'AGENCY', 'CUSTOMER', 'RATE', 0.0251, NULL, NULL),
  ('SCH-DD-NEGO-USD-T1', 0, '자사 수수료', 'OWN', 'CUSTOMER', 'FLAT', NULL, 150, NULL),
  ('SCH-DD-NEGO-USD-T1', 1, '유관기관 수수료', 'AGENCY', 'CUSTOMER', 'RATE', 0.0316, NULL, NULL),
  ('SCH-DD-NEGO-USD-T2', 0, '자사 수수료', 'OWN', 'CUSTOMER', 'FLAT', NULL, 200, NULL),
  ('SCH-DD-NEGO-USD-T2', 1, '유관기관 수수료', 'AGENCY', 'CUSTOMER', 'RATE', 0.0316, NULL, NULL),
  ('SCH-DD-NEGO-USD-T3', 0, '자사 수수료', 'OWN', 'CUSTOMER', 'FLAT', NULL, 400, NULL),
  ('SCH-DD-NEGO-USD-T3', 1, '유관기관 수수료', 'AGENCY', 'CUSTOMER', 'RATE', 0.0316, NULL, NULL),
  ('SCH-DD-NEGO-K2O-T1', 0, '자사 수수료', 'OWN', 'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.42,"rateBp":5,"flat":13},{"from":0.42,"to":2.47,"rateBp":5,"flat":null},{"from":2.47,"to":null,"rateBp":5,"flat":null}]'::jsonb),
  ('SCH-DD-NEGO-K2O-T1', 1, '유관기관 수수료', 'AGENCY', 'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.42,"rateBp":null,"flat":13},{"from":0.42,"to":2.47,"rateBp":1.2654,"flat":null},{"from":2.47,"to":null,"rateBp":null,"flat":78}]'::jsonb),
  ('SCH-DD-NEGO-K2O-T2', 0, '자사 수수료', 'OWN', 'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.42,"rateBp":8,"flat":13},{"from":0.42,"to":2.47,"rateBp":8,"flat":null},{"from":2.47,"to":null,"rateBp":8,"flat":null}]'::jsonb),
  ('SCH-DD-NEGO-K2O-T2', 1, '유관기관 수수료', 'AGENCY', 'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.42,"rateBp":null,"flat":13},{"from":0.42,"to":2.47,"rateBp":1.2654,"flat":null},{"from":2.47,"to":null,"rateBp":null,"flat":78}]'::jsonb),
  ('SCH-DD-NEGO-K2O-T3', 0, '자사 수수료', 'OWN', 'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.42,"rateBp":10,"flat":13},{"from":0.42,"to":2.47,"rateBp":10,"flat":null},{"from":2.47,"to":null,"rateBp":10,"flat":null}]'::jsonb),
  ('SCH-DD-NEGO-K2O-T3', 1, '유관기관 수수료', 'AGENCY', 'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.42,"rateBp":null,"flat":13},{"from":0.42,"to":2.47,"rateBp":1.2654,"flat":null},{"from":2.47,"to":null,"rateBp":null,"flat":78}]'::jsonb),
  ('SCH-DD-NEGO-K2O-T4', 0, '자사 수수료', 'OWN', 'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.42,"rateBp":12,"flat":13},{"from":0.42,"to":2.47,"rateBp":12,"flat":null},{"from":2.47,"to":null,"rateBp":12,"flat":null}]'::jsonb),
  ('SCH-DD-NEGO-K2O-T4', 1, '유관기관 수수료', 'AGENCY', 'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.42,"rateBp":null,"flat":13},{"from":0.42,"to":2.47,"rateBp":1.2654,"flat":null},{"from":2.47,"to":null,"rateBp":null,"flat":78}]'::jsonb),
  ('SCH-DD-EVT-NEW', 0, '자사 수수료(면제)', 'OWN', 'CUSTOMER', 'RATE', 0, NULL, NULL),
  ('SCH-DD-EVT-NEW', 1, '유관기관 수수료', 'AGENCY', 'CUSTOMER', 'RATE', 0.0251, NULL, NULL);

INSERT INTO fee_rule(rule_id, rule_name, rule_type, rule_status, apply_mode, start_date, end_date,
    benefit_kind, benefit_months, schedule_id, scope_asset_class, scope_exchanges, scope_sessions,
    scope_lookup_keys, scope_products, scope_channels) VALUES
  -- 주간 기본은 REGULAR 한정: 세션 무제한이면 야간 셀에서 더 싼 주간 요율이 이겨버림(야간 전용 룰이 있는 상품만)
  ('R-DD-BASE-IDXF', '지수선물 온라인 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-IDXF', 'DOMESTIC_DERIV', NULL, ARRAY['REGULAR'], ARRAY['FUTURES'], ARRAY['K200','MK200'], ARRAY['HTS','MTS','API']),
  ('R-DD-BASE-KQF', '코스닥150선물 온라인 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-KQF', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['FUTURES'], ARRAY['KQ150'], ARRAY['HTS','MTS','API']),
  ('R-DD-BASE-K200O', 'K200옵션 온라인 기본(구간표)', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-K200O', 'DOMESTIC_DERIV', NULL, ARRAY['REGULAR'], ARRAY['OPTIONS'], ARRAY['K200'], ARRAY['HTS','MTS','API']),
  ('R-DD-BASE-IDXF-N', '야간 지수선물 온라인 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-IDXF-N', 'DOMESTIC_DERIV', NULL, ARRAY['NIGHT'], ARRAY['FUTURES'], ARRAY['K200','MK200'], ARRAY['HTS','MTS','API']),
  ('R-DD-BASE-K200O-N', '야간 K200옵션 온라인 기본(구간표)', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-K200O-N', 'DOMESTIC_DERIV', NULL, ARRAY['NIGHT'], ARRAY['OPTIONS'], ARRAY['K200'], ARRAY['HTS','MTS','API']),
  ('R-DD-BASE-KTB', '국채선물 온라인 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-KTB', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['FUTURES'], ARRAY['KTB3','KTB10'], ARRAY['HTS','MTS','API']),
  ('R-DD-BASE-USD', '미국달러선물 온라인 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-USD', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['FUTURES'], ARRAY['USDF'], ARRAY['HTS','MTS','API']),
  ('R-DD-BASE-GOLD', '금선물 온라인 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-GOLD', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['FUTURES'], ARRAY['GOLDF'], ARRAY['HTS','MTS','API']),
  ('R-DD-BASE-CT-F', '선물 금융센터·반대매매 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-CT-F', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['FUTURES'], NULL, ARRAY['센터','반대매매']),
  ('R-DD-BASE-CT-O', '옵션 금융센터·반대매매 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-CT-O', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['OPTIONS'], NULL, ARRAY['센터','반대매매']),
  ('R-DD-NEGO-K2F-T1', 'K200선물 협의 1등급(월 약정 3,000억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-NEGO-K2F-T1', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['FUTURES'], ARRAY['K200','MK200'], ARRAY['HTS','MTS','API']),
  ('R-DD-NEGO-K2F-T2', 'K200선물 협의 2등급(월 약정 1,000억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-NEGO-K2F-T2', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['FUTURES'], ARRAY['K200','MK200'], ARRAY['HTS','MTS','API']),
  ('R-DD-NEGO-K2F-T3', 'K200선물 협의 3등급(월 약정 600억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-NEGO-K2F-T3', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['FUTURES'], ARRAY['K200','MK200'], ARRAY['HTS','MTS','API']),
  ('R-DD-NEGO-K2F-T4', 'K200선물 협의 4등급(월 약정 400억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-NEGO-K2F-T4', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['FUTURES'], ARRAY['K200','MK200'], ARRAY['HTS','MTS','API']),
  ('R-DD-NEGO-USD-T1', '달러선물 협의 1등급(월 약정 100억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-NEGO-USD-T1', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['FUTURES'], ARRAY['USDF'], ARRAY['HTS','MTS','API']),
  ('R-DD-NEGO-USD-T2', '달러선물 협의 2등급(월 약정 75억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-NEGO-USD-T2', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['FUTURES'], ARRAY['USDF'], ARRAY['HTS','MTS','API']),
  ('R-DD-NEGO-USD-T3', '달러선물 협의 3등급(월 약정 50억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-NEGO-USD-T3', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['FUTURES'], ARRAY['USDF'], ARRAY['HTS','MTS','API']),
  ('R-DD-NEGO-K2O-T1', 'K200옵션 협의 1등급(월 약정 150억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-NEGO-K2O-T1', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['OPTIONS'], ARRAY['K200'], ARRAY['HTS','MTS','API']),
  ('R-DD-NEGO-K2O-T2', 'K200옵션 협의 2등급(월 약정 50억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-NEGO-K2O-T2', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['OPTIONS'], ARRAY['K200'], ARRAY['HTS','MTS','API']),
  ('R-DD-NEGO-K2O-T3', 'K200옵션 협의 3등급(월 약정 30억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-NEGO-K2O-T3', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['OPTIONS'], ARRAY['K200'], ARRAY['HTS','MTS','API']),
  ('R-DD-NEGO-K2O-T4', 'K200옵션 협의 4등급(월 약정 20억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-DD-NEGO-K2O-T4', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['OPTIONS'], ARRAY['K200'], ARRAY['HTS','MTS','API']),
  ('R-DD-EVT-NEW', '선물옵션 신규고객 1개월 수수료 할인', 'EVENT', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '2026-12-31',
   'RELATIVE', 1, 'SCH-DD-EVT-NEW', 'DOMESTIC_DERIV', NULL, NULL, ARRAY['FUTURES'], ARRAY['K200','MK200'], ARRAY['HTS','MTS']);

-- ============================================================
-- 해외주식 (OVERSEAS_STOCK)
-- ============================================================
INSERT INTO fee_schedule(schedule_id, schedule_name) VALUES
  ('SCH-OS-US',         '미국주식 온라인 0.25%'),
  ('SCH-OS-CT',         '해외주식 오프라인 0.5%'),
  ('SCH-OS-HK',         '홍콩주식 온라인 0.30%'),
  ('SCH-OS-JP',         '일본주식 온라인 0.23%'),
  ('SCH-OS-NEGO-US-T1', '미국주식 협의 1등급 0.030%'),
  ('SCH-OS-NEGO-US-T2', '미국주식 협의 2등급 0.050%'),
  ('SCH-OS-NEGO-US-T3', '미국주식 협의 3등급 0.060%'),
  ('SCH-OS-NEGO-ETF-T1','미국ETF 협의 1등급 0.030%'),
  ('SCH-OS-NEGO-ETF-T2','미국ETF 협의 2등급 0.040%'),
  ('SCH-OS-NEGO-ETF-T3','미국ETF 협의 3등급 0.042%'),
  ('SCH-OS-NEGO-ETF-T4','미국ETF 협의 4등급 0.044%'),
  ('SCH-OS-NEGO-AS-T1', '아시아주식 협의 1등급 0.050%'),
  ('SCH-OS-NEGO-AS-T2', '아시아주식 협의 2등급 0.060%');

INSERT INTO fee_component(schedule_id, seq, name, kind, payer, rate_type, rate_bp, flat_amount) VALUES
  ('SCH-OS-US',          0, '자사 수수료',        'OWN', 'CUSTOMER', 'RATE', 25,    NULL),
  ('SCH-OS-US',          1, 'SEC Fee(매도분)',    'TAX', 'CUSTOMER', 'RATE', 0.206, NULL),
  ('SCH-OS-CT',          0, '자사 수수료',        'OWN', 'CUSTOMER', 'RATE', 50,    NULL),
  ('SCH-OS-HK',          0, '자사 수수료',        'OWN', 'CUSTOMER', 'RATE', 30,    NULL),
  ('SCH-OS-HK',          1, '인지세',             'TAX', 'CUSTOMER', 'RATE', 10,    NULL),
  ('SCH-OS-JP',          0, '자사 수수료',        'OWN', 'CUSTOMER', 'RATE', 23,    NULL),
  ('SCH-OS-NEGO-US-T1',  0, '자사 수수료',        'OWN', 'CUSTOMER', 'RATE', 3,     NULL),
  ('SCH-OS-NEGO-US-T1',  1, 'SEC Fee(매도분)',    'TAX', 'CUSTOMER', 'RATE', 0.206, NULL),
  ('SCH-OS-NEGO-US-T2',  0, '자사 수수료',        'OWN', 'CUSTOMER', 'RATE', 5,     NULL),
  ('SCH-OS-NEGO-US-T2',  1, 'SEC Fee(매도분)',    'TAX', 'CUSTOMER', 'RATE', 0.206, NULL),
  ('SCH-OS-NEGO-US-T3',  0, '자사 수수료',        'OWN', 'CUSTOMER', 'RATE', 6,     NULL),
  ('SCH-OS-NEGO-US-T3',  1, 'SEC Fee(매도분)',    'TAX', 'CUSTOMER', 'RATE', 0.206, NULL),
  ('SCH-OS-NEGO-ETF-T1', 0, '자사 수수료',        'OWN', 'CUSTOMER', 'RATE', 3,     NULL),
  ('SCH-OS-NEGO-ETF-T1', 1, 'SEC Fee(매도분)',    'TAX', 'CUSTOMER', 'RATE', 0.206, NULL),
  ('SCH-OS-NEGO-ETF-T2', 0, '자사 수수료',        'OWN', 'CUSTOMER', 'RATE', 4,     NULL),
  ('SCH-OS-NEGO-ETF-T2', 1, 'SEC Fee(매도분)',    'TAX', 'CUSTOMER', 'RATE', 0.206, NULL),
  ('SCH-OS-NEGO-ETF-T3', 0, '자사 수수료',        'OWN', 'CUSTOMER', 'RATE', 4.2,   NULL),
  ('SCH-OS-NEGO-ETF-T3', 1, 'SEC Fee(매도분)',    'TAX', 'CUSTOMER', 'RATE', 0.206, NULL),
  ('SCH-OS-NEGO-ETF-T4', 0, '자사 수수료',        'OWN', 'CUSTOMER', 'RATE', 4.4,   NULL),
  ('SCH-OS-NEGO-ETF-T4', 1, 'SEC Fee(매도분)',    'TAX', 'CUSTOMER', 'RATE', 0.206, NULL),
  ('SCH-OS-NEGO-AS-T1',  0, '자사 수수료',        'OWN', 'CUSTOMER', 'RATE', 5,     NULL),
  ('SCH-OS-NEGO-AS-T2',  0, '자사 수수료',        'OWN', 'CUSTOMER', 'RATE', 6,     NULL);

INSERT INTO fee_rule(rule_id, rule_name, rule_type, rule_status, apply_mode, start_date, end_date,
    benefit_kind, benefit_months, schedule_id, scope_asset_class, scope_exchanges, scope_sessions,
    scope_lookup_keys, scope_products, scope_channels) VALUES
  ('R-OS-BASE-US', '미국주식 온라인 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OS-US', 'OVERSEAS_STOCK', ARRAY['NASDAQ','NYSE'], NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-OS-BASE-HK', '홍콩주식 온라인 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OS-HK', 'OVERSEAS_STOCK', ARRAY['HKEX'], NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-OS-BASE-JP', '일본주식 온라인 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OS-JP', 'OVERSEAS_STOCK', ARRAY['TSE'], NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-OS-BASE-CT', '해외주식 오프라인 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OS-CT', 'OVERSEAS_STOCK', NULL, NULL, NULL, NULL, ARRAY['센터','반대매매']),
  ('R-OS-NEGO-US-T1', '미국주식 협의 1등급(예탁·약정 30억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OS-NEGO-US-T1', 'OVERSEAS_STOCK', ARRAY['NASDAQ','NYSE'], NULL, ARRAY['STOCK'], NULL, ARRAY['HTS','MTS']),
  ('R-OS-NEGO-US-T2', '미국주식 협의 2등급(예탁·약정 20억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OS-NEGO-US-T2', 'OVERSEAS_STOCK', ARRAY['NASDAQ','NYSE'], NULL, ARRAY['STOCK'], NULL, ARRAY['HTS','MTS']),
  ('R-OS-NEGO-US-T3', '미국주식 협의 3등급(예탁·약정 10억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OS-NEGO-US-T3', 'OVERSEAS_STOCK', ARRAY['NASDAQ','NYSE'], NULL, ARRAY['STOCK'], NULL, ARRAY['HTS','MTS']),
  ('R-OS-NEGO-ETF-T1', '미국ETF 협의 1등급(예탁·약정 30억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OS-NEGO-ETF-T1', 'OVERSEAS_STOCK', ARRAY['NASDAQ','NYSE'], NULL, ARRAY['ETF'], NULL, ARRAY['HTS','MTS']),
  ('R-OS-NEGO-ETF-T2', '미국ETF 협의 2등급(예탁·약정 10억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OS-NEGO-ETF-T2', 'OVERSEAS_STOCK', ARRAY['NASDAQ','NYSE'], NULL, ARRAY['ETF'], NULL, ARRAY['HTS','MTS']),
  ('R-OS-NEGO-ETF-T3', '미국ETF 협의 3등급(예탁·약정 5억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OS-NEGO-ETF-T3', 'OVERSEAS_STOCK', ARRAY['NASDAQ','NYSE'], NULL, ARRAY['ETF'], NULL, ARRAY['HTS','MTS']),
  ('R-OS-NEGO-ETF-T4', '미국ETF 협의 4등급(예탁·약정 1억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OS-NEGO-ETF-T4', 'OVERSEAS_STOCK', ARRAY['NASDAQ','NYSE'], NULL, ARRAY['ETF'], NULL, ARRAY['HTS','MTS']),
  ('R-OS-NEGO-AS-T1', '아시아주식 협의 1등급(예탁·약정 20억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OS-NEGO-AS-T1', 'OVERSEAS_STOCK', ARRAY['HKEX','TSE'], NULL, NULL, NULL, ARRAY['HTS','MTS']),
  ('R-OS-NEGO-AS-T2', '아시아주식 협의 2등급(예탁·약정 10억)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OS-NEGO-AS-T2', 'OVERSEAS_STOCK', ARRAY['HKEX','TSE'], NULL, NULL, NULL, ARRAY['HTS','MTS']);

-- ============================================================
-- 해외파생 (OVERSEAS_DERIV, CME USD 결제 기준)
-- ============================================================
INSERT INTO fee_schedule(schedule_id, schedule_name) VALUES
  ('SCH-OD-ON',      '해외선물 온라인 $7.5/계약'),
  ('SCH-OD-CT',      '해외선물 오프라인 $10/계약'),
  ('SCH-OD-NEGO-T1', '해외선물 협의 1등급 $3.0/계약'),
  ('SCH-OD-NEGO-T2', '해외선물 협의 2등급 $3.5/계약'),
  ('SCH-OD-NEGO-T3', '해외선물 협의 3등급 $4.0/계약'),
  ('SCH-OD-NEGO-T4', '해외선물 협의 4등급 $4.5/계약'),
  ('SCH-OD-NEGO-T5', '해외선물 협의 5등급 $5.0/계약'),
  ('SCH-OD-NEGO-T6', '해외선물 협의 6등급 $5.5/계약'),
  ('SCH-OD-NEGO-T7', '해외선물 협의 7등급 $6.0/계약');

INSERT INTO fee_component(schedule_id, seq, name, kind, payer, rate_type, rate_bp, flat_amount) VALUES
  ('SCH-OD-ON',      0, '위탁 수수료', 'OWN', 'CUSTOMER', 'FLAT', NULL, 7.5),
  ('SCH-OD-CT',      0, '위탁 수수료', 'OWN', 'CUSTOMER', 'FLAT', NULL, 10),
  ('SCH-OD-NEGO-T1', 0, '위탁 수수료', 'OWN', 'CUSTOMER', 'FLAT', NULL, 3.0),
  ('SCH-OD-NEGO-T2', 0, '위탁 수수료', 'OWN', 'CUSTOMER', 'FLAT', NULL, 3.5),
  ('SCH-OD-NEGO-T3', 0, '위탁 수수료', 'OWN', 'CUSTOMER', 'FLAT', NULL, 4.0),
  ('SCH-OD-NEGO-T4', 0, '위탁 수수료', 'OWN', 'CUSTOMER', 'FLAT', NULL, 4.5),
  ('SCH-OD-NEGO-T5', 0, '위탁 수수료', 'OWN', 'CUSTOMER', 'FLAT', NULL, 5.0),
  ('SCH-OD-NEGO-T6', 0, '위탁 수수료', 'OWN', 'CUSTOMER', 'FLAT', NULL, 5.5),
  ('SCH-OD-NEGO-T7', 0, '위탁 수수료', 'OWN', 'CUSTOMER', 'FLAT', NULL, 6.0);

INSERT INTO fee_rule(rule_id, rule_name, rule_type, rule_status, apply_mode, start_date, end_date,
    benefit_kind, benefit_months, schedule_id, scope_asset_class, scope_exchanges, scope_sessions,
    scope_lookup_keys, scope_products, scope_channels) VALUES
  ('R-OD-BASE-ON', '해외선물 온라인 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OD-ON', 'OVERSEAS_DERIV', NULL, NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-OD-BASE-CT', '해외선물 오프라인 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OD-CT', 'OVERSEAS_DERIV', NULL, NULL, NULL, NULL, ARRAY['센터','반대매매']),
  ('R-OD-NEGO-T1', '해외선물 협의 1등급(3개월 3,000계약)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OD-NEGO-T1', 'OVERSEAS_DERIV', NULL, NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-OD-NEGO-T2', '해외선물 협의 2등급(3개월 2,500계약)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OD-NEGO-T2', 'OVERSEAS_DERIV', NULL, NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-OD-NEGO-T3', '해외선물 협의 3등급(3개월 2,000계약)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OD-NEGO-T3', 'OVERSEAS_DERIV', NULL, NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-OD-NEGO-T4', '해외선물 협의 4등급(3개월 1,500계약)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OD-NEGO-T4', 'OVERSEAS_DERIV', NULL, NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-OD-NEGO-T5', '해외선물 협의 5등급(3개월 1,000계약)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OD-NEGO-T5', 'OVERSEAS_DERIV', NULL, NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-OD-NEGO-T6', '해외선물 협의 6등급(3개월 500계약)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OD-NEGO-T6', 'OVERSEAS_DERIV', NULL, NULL, NULL, NULL, ARRAY['HTS','MTS','API']),
  ('R-OD-NEGO-T7', '해외선물 협의 7등급(3개월 100계약)', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', NULL, 'SCH-OD-NEGO-T7', 'OVERSEAS_DERIV', NULL, NULL, NULL, NULL, ARRAY['HTS','MTS','API']);

COMMIT;

-- 적용 후: POST /api/batch/rebuild 로 배정판 전체 재산출 (편입이 없으니 초기 판은 비어 있는 게 정상)
