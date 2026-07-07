-- 시드 — mock.ts 를 영문 코드값으로 이관 + 기술설계서 v1.5 §6.2 시나리오 재현.
-- 협의는 NEGOTIATED 룰 + enrollment 로 표현(v0.8 오버레이 폐기). 기준일 2026-07-07.

-- ===== 계좌 =====
INSERT INTO account(account_id, account_name, grade, dormant_returned, metric_6m_asset, metric_6m_volume) VALUES
  ('8041-2237-01', '김철수', 'VIP',     false, 850000000, 3000000000),   -- 협의 T2 보유 + ETF 이벤트
  ('6015-8890-42', '이영희', 'GENERAL', false, 120000000,  200000000),   -- 협의·이벤트 없음(순수 기본)
  ('7022-3345-11', '최수진', 'GOLD',    false, 800000000, 9800000000),   -- 해외주식 협의 자격 충족(신청 데모)
  ('5533-1100-99', '박민준', 'SILVER',  false, 300000000,   50000000);   -- 자격 미충족(영업예외 데모)

INSERT INTO account_product_group(account_id, asset_class) VALUES
  ('8041-2237-01', 'OVERSEAS_DERIV'), ('8041-2237-01', 'OVERSEAS_STOCK'),
  ('6015-8890-42', 'DOMESTIC_STOCK'),
  ('7022-3345-11', 'OVERSEAS_STOCK'),
  ('5533-1100-99', 'OVERSEAS_STOCK');

-- ===== 협의 자격 기준 =====
INSERT INTO qualify_policy(asset_class, metric, threshold) VALUES
  ('OVERSEAS_STOCK', 'AVG_ASSET_6M', 500000000),
  ('OVERSEAS_DERIV', 'VOLUME_6M',    100000000);

-- ===== 품목(파생만 셀 유니버스에 필요) =====
INSERT INTO product(asset_class, exchange_code, product_code, product_name, currency, sessions) VALUES
  ('OVERSEAS_DERIV', 'CME', 'ES', 'E-mini S&P 500 선물', 'USD', ARRAY['REGULAR']),
  ('OVERSEAS_DERIV', 'CME', 'GC', 'Gold 선물',           'USD', ARRAY['REGULAR']);

-- ===== 요율표 =====
INSERT INTO fee_schedule(schedule_id, schedule_name) VALUES
  ('SCH-OS-BASE',    '해외주식 기본 0.25%'),
  ('SCH-OS-EVT-03',  '해외 ETF 이벤트 0.09%'),
  ('SCH-OS-NEGO',    '해외주식 협의 0.15%'),
  ('SCH-OD-BASE',    '해외파생 기본 $2.50/계약'),
  ('SCH-OD-NEGO-T2', '해외파생 협의 TIER2 $0.80/계약'),
  ('SCH-OD-NEGO-T3', '해외파생 협의 TIER3 $0.50/계약'),
  ('SCH-DS-BASE',    '국내주식 기본'),
  ('SCH-DS-EVT',     '국내주식 프로모션 0.03%');

INSERT INTO fee_component(schedule_id, seq, name, kind, payer, rate_type, rate_bp, flat_amount, bands, min_fee) VALUES
  ('SCH-OS-BASE',    0, '자사 수수료', 'OWN',    'CUSTOMER', 'RATE', 25.0, NULL, NULL, NULL),
  ('SCH-OS-EVT-03',  0, '자사 수수료', 'OWN',    'CUSTOMER', 'RATE', 9.0,  NULL, NULL, NULL),
  ('SCH-OS-NEGO',    0, '자사 수수료', 'OWN',    'CUSTOMER', 'RATE', 15.0, NULL, NULL, NULL),
  ('SCH-OD-BASE',    0, '위탁 수수료', 'OWN',    'CUSTOMER', 'FLAT', NULL, 2.50, NULL, NULL),
  ('SCH-OD-NEGO-T2', 0, '위탁 수수료', 'OWN',    'CUSTOMER', 'FLAT', NULL, 0.80, NULL, NULL),
  ('SCH-OD-NEGO-T3', 0, '위탁 수수료', 'OWN',    'CUSTOMER', 'FLAT', NULL, 0.50, NULL, NULL),
  ('SCH-DS-BASE',    0, '자사 수수료', 'OWN',    'CUSTOMER', 'RATE', 10.0, NULL, NULL, NULL),
  ('SCH-DS-BASE',    1, '증권거래세', 'TAX',    'CUSTOMER', 'RATE', 15.0, NULL, NULL, NULL),
  ('SCH-DS-EVT',     0, '자사 수수료', 'OWN',    'CUSTOMER', 'RATE', 3.0,  NULL, NULL, NULL),
  ('SCH-DS-EVT',     1, '증권거래세', 'TAX',    'CUSTOMER', 'RATE', 15.0, NULL, NULL, NULL);

-- ===== 룰 =====
-- 기본(자산군별)
INSERT INTO fee_rule(rule_id, rule_name, rule_type, rule_status, apply_mode, start_date, end_date,
    benefit_kind, schedule_id, scope_asset_class) VALUES
  ('R-BASE-01', '해외주식 기본',   'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31', 'CALENDAR', 'SCH-OS-BASE', 'OVERSEAS_STOCK'),
  ('R-BASE-05', '해외파생 기본',   'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31', 'CALENDAR', 'SCH-OD-BASE', 'OVERSEAS_DERIV'),
  ('R-BASE-DS', '국내주식 기본',   'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31', 'CALENDAR', 'SCH-DS-BASE', 'DOMESTIC_STOCK');

-- 이벤트: 해외 ETF 0.09% (신청형, 조회구분 ETF 한정)
INSERT INTO fee_rule(rule_id, rule_name, rule_type, rule_status, apply_mode, start_date, end_date,
    benefit_kind, schedule_id, scope_asset_class, scope_lookup_keys) VALUES
  ('R-EVT-12', '해외 ETF 수수료 이벤트', 'EVENT', 'ACTIVE', 'APPLICATION', '2026-07-01', '2026-12-31',
   'CALENDAR', 'SCH-OS-EVT-03', 'OVERSEAS_STOCK', ARRAY['ETF']);

-- 협의 표준 등급(해외파생 T2/T3, 해외주식)
INSERT INTO fee_rule(rule_id, rule_name, rule_type, rule_status, apply_mode, start_date, end_date,
    benefit_kind, schedule_id, scope_asset_class, scope_lookup_keys) VALUES
  ('R-NEGO-02', '해외파생 협의 TIER2', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', 'SCH-OD-NEGO-T2', 'OVERSEAS_DERIV', ARRAY['FUTURES']),   -- 선물 한정(§6.2: 옵션은 기본)
  ('R-NEGO-03', '해외파생 협의 TIER3', 'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', 'SCH-OD-NEGO-T3', 'OVERSEAS_DERIV', ARRAY['FUTURES']);
INSERT INTO fee_rule(rule_id, rule_name, rule_type, rule_status, apply_mode, start_date, end_date,
    benefit_kind, schedule_id, scope_asset_class) VALUES
  ('R-NEGO-OS', '해외주식 협의',       'NEGOTIATED', 'ACTIVE', 'APPLICATION', '2026-01-01', '9999-12-31',
   'CALENDAR', 'SCH-OS-NEGO', 'OVERSEAS_STOCK');

-- 승인 대기 이벤트(룰 워크플로우 데모: validate → approve)
INSERT INTO fee_rule(rule_id, rule_name, rule_type, rule_status, apply_mode, start_date, end_date,
    benefit_kind, schedule_id, scope_asset_class) VALUES
  ('R-EVT-DS', '국내주식 여름 프로모션(대기)', 'EVENT', 'PENDING', 'AUTO_ENROLL', '2026-07-01', '2026-09-30',
   'CALENDAR', 'SCH-DS-EVT', 'DOMESTIC_STOCK');

-- ===== 부여관계(협의 T2 승인 + ETF 이벤트 가입) =====
INSERT INTO fee_enrollment(account_id, rule_id, status, valid_from, valid_to, qualify_type, enrolled_at,
    requested_by, requested_at, approved_by, approved_at) VALUES
  ('8041-2237-01', 'R-NEGO-02', 'ACTIVE', '2026-01-02', '2026-12-31', 'MET', NULL,
   'PB팀-오세훈', '2026-01-01 09:00+09', 'PB팀장', '2026-01-02 10:00+09'),
  ('8041-2237-01', 'R-EVT-12',  'ACTIVE', NULL, NULL, 'MET', '2026-07-01', NULL, NULL, NULL, NULL);
