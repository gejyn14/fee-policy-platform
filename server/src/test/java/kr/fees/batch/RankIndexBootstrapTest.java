package kr.fees.batch;

import kr.fees.persistence.PgIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class RankIndexBootstrapTest extends PgIntegrationTest {

    @Autowired RankIndexBootstrap bootstrap;
    @Autowired RankIndexService rankIndex;
    @Autowired JdbcTemplate jdbc;

    @Test
    void 누락_상태에서_기동_보정이_순위와_색인을_채운다() throws Exception {
        // 강제로 누락 상태를 만든다
        jdbc.update("UPDATE fee_rule SET rank_value = NULL");
        jdbc.update("DELETE FROM fee_rule_candidate_index");

        bootstrap.run(new DefaultApplicationArguments());

        Integer missing = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule WHERE rule_status = 'ACTIVE' AND rank_value IS NULL", Integer.class);
        Integer indexed = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule_candidate_index", Integer.class);
        assertThat(missing).isZero();
        assertThat(indexed).isGreaterThan(0);
    }

    @Test
    void 건강한_상태에서는_재적재하지_않는다() throws Exception {
        // 건강한 상태를 만든다: rank_value 전건 스탬프 + 색인 채움
        rankIndex.rebuildAll(LocalDate.now());

        // 실제 재적재라면 DELETE FROM fee_rule_candidate_index 로 지워질 sentinel 행을 심는다.
        // 기존 행 하나를 복제해 rank_position 만 충돌 없는 값(9999)으로 바꿔 삽입한다.
        Map<String, Object> row = jdbc.queryForMap(
            "SELECT asset_class, lookup_key, exchange_code, product_code, rule_id, rank_value, " +
            "rule_type, start_date, end_date, benefit_kind FROM fee_rule_candidate_index LIMIT 1");
        jdbc.update("""
            INSERT INTO fee_rule_candidate_index(asset_class, lookup_key, exchange_code, product_code,
                rank_position, rule_id, rank_value, rule_type, start_date, end_date, benefit_kind)
            VALUES (?,?,?,?,9999,?,?,?,?,?,?)""",
            row.get("asset_class"), row.get("lookup_key"), row.get("exchange_code"), row.get("product_code"),
            row.get("rule_id"), row.get("rank_value"), row.get("rule_type"),
            row.get("start_date"), row.get("end_date"), row.get("benefit_kind"));

        // 전제 확인: ACTIVE 룰 전건 스탬프됨 + 색인 비어있지 않음 → 가드는 "건강함"으로 판정해야 한다
        Integer missing = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule WHERE rule_status = 'ACTIVE' AND rank_value IS NULL", Integer.class);
        assertThat(missing).isZero();

        bootstrap.run(new DefaultApplicationArguments());

        // 재적재가 일어났다면 DELETE 로 sentinel 이 사라졌을 것 — 생존 여부로 무재적재를 증명한다
        Integer sentinelCount = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule_candidate_index WHERE rank_position = 9999", Integer.class);
        assertThat(sentinelCount).isEqualTo(1);
    }
}
