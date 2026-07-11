package kr.fees.batch;

import kr.fees.persistence.PgIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

class RankIndexBootstrapTest extends PgIntegrationTest {

    @Autowired RankIndexBootstrap bootstrap;
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
}
