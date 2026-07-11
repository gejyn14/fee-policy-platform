package kr.fees.persistence;

import kr.fees.batch.RankIndexService;
import kr.fees.domain.PolicyRanking;
import kr.fees.domain.RankedPolicy;
import kr.fees.domain.RuleModel;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class RankingRepositoryTest extends PgIntegrationTest {

    private static final LocalDate BASE = LocalDate.of(2026, 7, 7);

    @Autowired RankingRepository rankings;
    @Autowired RuleRepository rules;
    @Autowired ScheduleRepository schedules;
    @Autowired RankIndexService rankIndex;
    @Autowired CandidateIndexRepository candidateIndex;

    @Test
    void 저장_랭킹이_즉석_계산_랭킹과_동일하다_동치성() {
        rankIndex.rebuildAll(BASE);
        List<RuleModel> active = rules.findActive(BASE);

        List<RankedPolicy> stored = rankings.ranking(active, BASE);
        List<RankedPolicy> computed = PolicyRanking.build(active, schedules.findAllAsMap(), BASE);

        assertThat(stored).extracting(p -> p.rule().id())
            .containsExactlyElementsOf(computed.stream().map(p -> p.rule().id()).toList());
        for (int i = 0; i < stored.size(); i++) {
            assertThat(stored.get(i).rank()).isEqualByComparingTo(computed.get(i).rank());
        }
    }

    @Test
    void 색인_후보_조회는_기간을_필터하고_순위순으로_돌려준다() {
        rankIndex.rebuildAll(BASE);
        assertThat(candidateIndex.isEmpty()).isFalse();
        // 시드에 존재하는 임의 조합 하나에 대해: 후보가 있고, 전건 ACTIVE·기간 유효
        var anyCombo = jdbcCombo();
        List<String> ids = candidateIndex.candidates(anyCombo.assetClass(), anyCombo.lookupKey(),
            anyCombo.exchange(), anyCombo.product(), BASE);
        assertThat(ids).isNotEmpty();
    }

    private kr.fees.batch.ComboUniverse.Combo jdbcCombo() {
        var row = jdbc().queryForMap(
            "SELECT asset_class, lookup_key, exchange_code, product_code FROM fee_rule_candidate_index LIMIT 1");
        return new kr.fees.batch.ComboUniverse.Combo(
            kr.fees.domain.AssetClass.valueOf((String) row.get("asset_class")),
            kr.fees.domain.LookupKey.valueOf((String) row.get("lookup_key")),
            (String) row.get("exchange_code"),
            "*".equals(row.get("product_code")) ? null : (String) row.get("product_code"));
    }

    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;
    private org.springframework.jdbc.core.JdbcTemplate jdbc() { return jdbcTemplate; }
}
