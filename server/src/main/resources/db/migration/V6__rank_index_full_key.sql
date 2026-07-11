-- V6: 후보 색인 완전 키화 — 세션·채널 축 편입 (§10.4 확장).
-- 수수료를 가르는 계좌 무관 스코프 키 6축을 모두 승인 시점에 사전 랭크한다.
-- 계좌 산출(2차전)은 키 조회 + 자격 게이트만 남는다.
-- 파생 테이블이므로 데이터 이관 없이 재생성 — 기동 보정(RankIndexBootstrap)·승인 재적재가 채운다.
-- tie_order/specificity 저장: 조합 횡단 점 조회(top)가 SQL만으로 4키 정렬을 재현하기 위함.

DROP TABLE fee_rule_candidate_index;

CREATE TABLE fee_rule_candidate_index (
    asset_class   text NOT NULL,
    lookup_key    text NOT NULL,
    exchange_code text NOT NULL DEFAULT '*',
    product_code  text NOT NULL DEFAULT '*',
    session_code  text NOT NULL DEFAULT '*',
    channel_code  text NOT NULL DEFAULT '*',
    rank_position int  NOT NULL,
    rule_id       text NOT NULL REFERENCES fee_rule(rule_id),
    rank_value    numeric(18,4) NOT NULL,
    tie_order     int  NOT NULL,
    specificity   int  NOT NULL,
    rule_type     text NOT NULL,
    start_date    date NOT NULL,
    end_date      date NOT NULL,
    benefit_kind  text NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_class, lookup_key, exchange_code, product_code,
                 session_code, channel_code, rank_position)
);

CREATE INDEX ix_candidate_rule ON fee_rule_candidate_index(rule_id);
