-- V5: 순위 사전 산정 물리화 (기술설계서 §10.4 1단계).
-- 순위값은 승인 시점에 확정되어 fee_rule 컬럼으로 상주하고,
-- 조합(자산군·조회구분·거래소·품목)별 후보 순위는 소형 색인 테이블로 상주한다.
-- 판정 로직은 불변 — 배치·증분·화면은 저장 순위를 읽기만 한다.
-- 주의: 요율표(fee_component)는 승인 후 불변이 전제. 수정 기능 도입 시 색인 재적재 강제 필요.

ALTER TABLE fee_rule ADD COLUMN rank_value numeric(18,4);

CREATE TABLE fee_rule_candidate_index (
    asset_class   text NOT NULL,
    lookup_key    text NOT NULL,
    exchange_code text NOT NULL DEFAULT '*',
    product_code  text NOT NULL DEFAULT '*',   -- 주식형은 '*'
    rank_position int  NOT NULL,               -- 조합 내 순위(1..n), 재생성 시 부여
    rule_id       text NOT NULL REFERENCES fee_rule(rule_id),
    rank_value    numeric(18,4) NOT NULL,
    rule_type     text NOT NULL,
    start_date    date NOT NULL,               -- 읽기 시점 기간 필터용 비정규화
    end_date      date NOT NULL,
    benefit_kind  text NOT NULL,               -- RELATIVE 이벤트 멤버십 예외 필터용
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_class, lookup_key, exchange_code, product_code, rank_position)
);

CREATE INDEX ix_candidate_rule ON fee_rule_candidate_index(rule_id);
