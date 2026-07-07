-- 국내파생(KOSPI200) — 구간표(BANDS) 기준선. 구 mock FS-BASE-DERIV-KR 구조 이관.
-- 국내 옵션은 체결단가 구간별로 정률+정액을 동시에 매기고, 상위 구간 정액 add-on이 단조성을 보정한다.

INSERT INTO product(asset_class, exchange_code, product_code, product_name, currency, sessions) VALUES
  ('DOMESTIC_DERIV', 'KRX', 'K200', 'KOSPI200', 'KRW', ARRAY['REGULAR']);

INSERT INTO fee_schedule(schedule_id, schedule_name) VALUES
  ('SCH-DD-BASE', '국내파생(KOSPI200옵션) 기본 — 구간표');

INSERT INTO fee_component(schedule_id, seq, name, kind, payer, rate_type, rate_bp, flat_amount, bands, min_fee) VALUES
  ('SCH-DD-BASE', 0, '자사 수수료', 'OWN', 'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.42,"rateBp":14,"flat":13},{"from":0.42,"to":2.47,"rateBp":15,"flat":null},{"from":2.47,"to":null,"rateBp":14.7,"flat":78}]'::jsonb,
   NULL),
  ('SCH-DD-BASE', 1, '거래소 수수료', 'AGENCY', 'CUSTOMER', 'FLAT', NULL, 300, NULL, NULL);

INSERT INTO fee_rule(rule_id, rule_name, rule_type, rule_status, apply_mode, start_date, end_date,
    benefit_kind, schedule_id, scope_asset_class) VALUES
  ('R-BASE-DD', '국내파생 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', 'SCH-DD-BASE', 'DOMESTIC_DERIV');

-- 데모계좌에 국내파생 개설 추가 → 셀 유니버스에 K200 선물/옵션 셀 등장
INSERT INTO account_product_group(account_id, asset_class) VALUES
  ('8041-2237-01', 'DOMESTIC_DERIV');
