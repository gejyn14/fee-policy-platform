package kr.fees.batch;

import kr.fees.persistence.PgIntegrationTest;
import kr.fees.persistence.RuleRepository;
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
    @Autowired RuleRepository ruleRepository;

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
            WHERE (asset_class, lookup_key, exchange_code, product_code, session_code, channel_code) IN (
                SELECT asset_class, lookup_key, exchange_code, product_code, session_code, channel_code
                FROM fee_rule_candidate_index GROUP BY 1,2,3,4,5,6 HAVING count(*) >= 2 LIMIT 1)
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
            "SELECT rule_id FROM fee_rule_candidate_index ORDER BY asset_class, lookup_key, exchange_code, product_code, session_code, channel_code, rank_position",
            String.class);
        rankIndex.rebuildAll(BASE);
        List<String> second = jdbc.queryForList(
            "SELECT rule_id FROM fee_rule_candidate_index ORDER BY asset_class, lookup_key, exchange_code, product_code, session_code, channel_code, rank_position",
            String.class);
        assertThat(second).containsExactlyElementsOf(first);
    }

    @Test
    void 세션_한정_룰은_자기_세션_조합에만_실린다() {
        // 세션 NIGHT 한정 ACTIVE 룰을 직접 삽입(승인 우회) 후 재적재
        insertNightRule();
        rankIndex.rebuildAll(BASE);

        Integer wrong = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule_candidate_index WHERE rule_id = 'R-TEST-NIGHT' AND session_code <> 'NIGHT'",
            Integer.class);
        Integer right = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule_candidate_index WHERE rule_id = 'R-TEST-NIGHT' AND session_code = 'NIGHT'",
            Integer.class);
        assertThat(wrong).isZero();
        assertThat(right).isGreaterThan(0);
    }

    @Test
    void 별표_세션_조합은_세션_한정_룰을_담지_않는다() {
        insertNightRule();          // 첫 테스트와 공유하는 픽스처 헬퍼
        rankIndex.rebuildAll(BASE);
        Integer leaked = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule_candidate_index WHERE rule_id = 'R-TEST-NIGHT' AND session_code = '*'",
            Integer.class);
        assertThat(leaked).isZero();
    }

    private String existingScheduleId() {
        return jdbc.queryForObject("SELECT schedule_id FROM fee_schedule LIMIT 1", String.class);
    }

    private void insertNightRule() {
        var scope = new kr.fees.domain.RuleScope(kr.fees.domain.AssetClass.DOMESTIC_STOCK,
            null, java.util.Set.of("NIGHT"), null, null, java.util.Set.of(), null);
        ruleRepository.insert(new kr.fees.domain.RuleModel("R-TEST-NIGHT", "야간 테스트",
            kr.fees.domain.RuleType.EVENT, kr.fees.domain.RuleStatus.ACTIVE,
            kr.fees.domain.ApplyMode.AUTO_ENROLL, BASE, BASE.plusMonths(6),
            kr.fees.domain.BenefitKind.CALENDAR, null, existingScheduleId(), scope, null, null));
    }
}
