package kr.fees.persistence;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

class MigrationTest extends PgIntegrationTest {

    @Autowired
    JdbcTemplate jdbc;

    @Test
    void 스키마_핵심_테이블이_생성된다() {
        Integer n = jdbc.queryForObject("""
            SELECT count(*) FROM information_schema.tables
            WHERE table_name IN ('fee_rule','fee_schedule','fee_component','fee_enrollment',
                                 'fee_binding','fee_binding_history','account','product')""",
            Integer.class);
        assertThat(n).isEqualTo(8);
    }

    @Test
    void 배정판_커버링_인덱스가_존재한다() {
        Integer n = jdbc.queryForObject(
            "SELECT count(*) FROM pg_indexes WHERE indexname = 'ix_fee_binding_lookup'",
            Integer.class);
        assertThat(n).isEqualTo(1);
    }
}
