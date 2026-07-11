package kr.fees.batch;

import kr.fees.persistence.PgIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class RankIndexServiceTest extends PgIntegrationTest {

    private static final LocalDate BASE = LocalDate.of(2026, 7, 7);

    @Autowired RankIndexService rankIndex;
    @Autowired JdbcTemplate jdbc;

    @Test
    void rebuildAll이_활성_룰_전건에_rank_value를_채운다() {
        rankIndex.rebuildAll(BASE);
        Integer missing = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule WHERE rule_status = 'ACTIVE' AND rank_value IS NULL", Integer.class);
        assertThat(missing).isZero();
    }

    @Test
    void 색인은_조합마다_순위값_오름차순으로_적재된다() {
        rankIndex.rebuildAll(BASE);
        // 임의 조합 하나를 잡아 rank_position 순서 == rank_value 오름차순(동률 시 rule_id) 확인
        List<BigDecimal> values = jdbc.queryForList("""
            SELECT rank_value FROM fee_rule_candidate_index
            WHERE (asset_class, lookup_key, exchange_code, product_code) IN (
                SELECT asset_class, lookup_key, exchange_code, product_code
                FROM fee_rule_candidate_index GROUP BY 1,2,3,4 HAVING count(*) >= 2 LIMIT 1)
            ORDER BY rank_position""", BigDecimal.class);
        assertThat(values).isSorted();
    }

    @Test
    void 색인_후보는_조합_계열_판정을_따른다() {
        rankIndex.rebuildAll(BASE);
        // 파생 품목 조합의 후보는 모두 그 자산군 룰이어야 한다
        Integer crossed = jdbc.queryForObject("""
            SELECT count(*) FROM fee_rule_candidate_index i
            JOIN fee_rule r ON r.rule_id = i.rule_id
            WHERE r.scope_asset_class <> i.asset_class""", Integer.class);
        assertThat(crossed).isZero();
    }

    @Test
    void 재실행해도_결과가_같다_결정성() {
        rankIndex.rebuildAll(BASE);
        List<String> first = jdbc.queryForList(
            "SELECT rule_id FROM fee_rule_candidate_index ORDER BY asset_class, lookup_key, exchange_code, product_code, rank_position",
            String.class);
        rankIndex.rebuildAll(BASE);
        List<String> second = jdbc.queryForList(
            "SELECT rule_id FROM fee_rule_candidate_index ORDER BY asset_class, lookup_key, exchange_code, product_code, rank_position",
            String.class);
        assertThat(second).containsExactlyElementsOf(first);
    }
}
