-- 수수료 정책 플랫폼 v1 스키마 (기술설계서 v1.5)
-- 코드값은 전부 영문(스펙 §3). 배정판(fee_binding)은 v1.2 §5.1 + 세션 축(v1.3 승격).

CREATE TABLE account (
    account_id       text PRIMARY KEY,
    account_name     text NOT NULL,
    grade            text NOT NULL,
    dormant_returned boolean NOT NULL DEFAULT false,
    metric_6m_asset  numeric(18) NOT NULL DEFAULT 0,
    metric_6m_volume numeric(18) NOT NULL DEFAULT 0
);

-- 셀 유니버스 pruning 기준: 계좌가 개설한 상품군
CREATE TABLE account_product_group (
    account_id  text NOT NULL REFERENCES account(account_id),
    asset_class text NOT NULL,
    PRIMARY KEY (account_id, asset_class)
);

CREATE TABLE product (
    asset_class   text NOT NULL,
    exchange_code text NOT NULL,
    product_code  text NOT NULL,
    product_name  text NOT NULL,
    currency      text NOT NULL,
    sessions      text[] NOT NULL,
    PRIMARY KEY (asset_class, exchange_code, product_code)
);

CREATE TABLE qualify_policy (
    asset_class text PRIMARY KEY,
    metric      text NOT NULL CHECK (metric IN ('AVG_ASSET_6M','VOLUME_6M')),
    threshold   numeric(18) NOT NULL
);

CREATE TABLE fee_schedule (
    schedule_id   text PRIMARY KEY,
    schedule_name text NOT NULL
);

CREATE TABLE fee_component (
    schedule_id text NOT NULL REFERENCES fee_schedule(schedule_id),
    seq         int  NOT NULL,
    name        text NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('OWN','AGENCY','TAX')),
    payer       text NOT NULL CHECK (payer IN ('CUSTOMER','COMPANY','EXEMPT')),
    rate_type   text NOT NULL CHECK (rate_type IN ('RATE','FLAT','BANDS')),
    rate_bp     numeric(10,4),
    flat_amount numeric(18,4),
    bands       jsonb,          -- [{"from":0,"to":1000,"rateBp":14,"flat":13}, ...] to=null 허용
    min_fee     numeric(18,4),
    PRIMARY KEY (schedule_id, seq)
);

CREATE TABLE fee_rule (
    rule_id            text PRIMARY KEY,
    rule_name          text NOT NULL,
    rule_type          text NOT NULL CHECK (rule_type IN ('BASE','EVENT','NEGOTIATED')),
    rule_status        text NOT NULL CHECK (rule_status IN ('DRAFT','PENDING','ACTIVE','REJECTED','EXPIRED')),
    apply_mode         text NOT NULL CHECK (apply_mode IN ('APPLICATION','AUTO_ENROLL','DORMANT_RETURN','TARGETED')),
    start_date         date NOT NULL,
    end_date           date NOT NULL,
    benefit_kind       text NOT NULL DEFAULT 'CALENDAR' CHECK (benefit_kind IN ('CALENDAR','RELATIVE')),
    benefit_months     int,
    schedule_id        text NOT NULL REFERENCES fee_schedule(schedule_id),
    scope_asset_class  text NOT NULL,
    scope_exchanges    text[],            -- NULL = 전체
    scope_sessions     text[],
    scope_lookup_keys  text[],
    scope_products     text[],
    scope_exclude_products text[] NOT NULL DEFAULT '{}',
    scope_channels     text[],
    condition_metric   text CHECK (condition_metric IN ('AVG_ASSET_6M','VOLUME_6M')),
    condition_threshold numeric(18),
    condition_action   text CHECK (condition_action IN ('AUTO_EXTEND','APPROVE_EXTEND')),
    target_account_ids text[],
    created_by         text NOT NULL DEFAULT 'system',
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fee_enrollment (
    enrollment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id    text NOT NULL REFERENCES account(account_id),
    rule_id       text NOT NULL REFERENCES fee_rule(rule_id),
    status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('REQUESTED','ACTIVE','REJECTED','EXPIRED')),
    valid_from    date,
    valid_to      date,
    qualify_type  text CHECK (qualify_type IN ('MET','EXCEPTION')),
    reason        text,
    channel       text,
    request_id    text,
    enrolled_at   date,
    requested_by  text, requested_at timestamptz,
    approved_by   text, approved_at  timestamptz
);
CREATE INDEX ix_enrollment_account ON fee_enrollment (account_id, rule_id, status);
CREATE INDEX ix_enrollment_request ON fee_enrollment (request_id);

CREATE TABLE fee_binding (
    account_id     text NOT NULL,
    asset_class    text NOT NULL,
    exchange_code  text NOT NULL DEFAULT '*',
    lookup_key     text NOT NULL,
    session_code   text NOT NULL DEFAULT '*',
    product_code   text NOT NULL DEFAULT '*',
    channel_code   text NOT NULL DEFAULT '*',
    valid_from     date NOT NULL,
    valid_to       date NOT NULL,
    schedule_id    text NOT NULL REFERENCES fee_schedule(schedule_id),
    source_rule_id text NOT NULL REFERENCES fee_rule(rule_id),
    source_type    text NOT NULL CHECK (source_type IN ('BASE','EVENT','NEGOTIATED')),
    reason         text,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, asset_class, exchange_code, lookup_key,
                 session_code, product_code, channel_code, valid_from)
);
-- 원장 체결 조회용 커버링 인덱스 (index-only access)
CREATE UNIQUE INDEX ix_fee_binding_lookup ON fee_binding
    (account_id, asset_class, lookup_key, exchange_code, session_code,
     product_code, channel_code, valid_from)
    INCLUDE (valid_to, schedule_id, source_rule_id, source_type);

CREATE TABLE fee_binding_history (
    history_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id      text NOT NULL,
    asset_class     text NOT NULL,
    exchange_code   text NOT NULL,
    lookup_key      text NOT NULL,
    session_code    text NOT NULL,
    product_code    text NOT NULL,
    channel_code    text NOT NULL,
    old_schedule_id text, old_source_rule_id text, old_source_type text,
    new_schedule_id text, new_source_rule_id text, new_source_type text,
    trigger_source  text NOT NULL CHECK (trigger_source IN
        ('DAILY_REBUILD','DELTA','RULE_APPROVED','RULE_EXPIRED','NEGO_APPROVED',
         'NEGO_EXTENDED','ENROLLMENT','DORMANT_RETURN')),
    change_reason   text,
    changed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_binding_hist ON fee_binding_history (account_id, asset_class, lookup_key, changed_at);

CREATE TABLE condition_eval_log (
    eval_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id bigint NOT NULL REFERENCES fee_enrollment(enrollment_id),
    metric        text NOT NULL,
    metric_value  numeric(18) NOT NULL,
    threshold     numeric(18) NOT NULL,
    met           boolean NOT NULL,
    evaluated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE batch_run (
    run_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_type    text NOT NULL CHECK (run_type IN ('FULL_REBUILD','DELTA')),
    base_date   date NOT NULL,
    inserted    int NOT NULL,
    updated     int NOT NULL,
    deleted     int NOT NULL,
    unchanged   int NOT NULL,
    started_at  timestamptz NOT NULL,
    finished_at timestamptz NOT NULL
);
