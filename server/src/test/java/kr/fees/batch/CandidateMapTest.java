package kr.fees.batch;

import kr.fees.domain.*;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class CandidateMapTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 7, 11);

    private RuleModel rule(String id, RuleType type, RuleScope scope) {
        return new RuleModel(id, id, type, RuleStatus.ACTIVE, ApplyMode.AUTO_ENROLL,
            LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31), BenefitKind.CALENDAR, null, "S-" + id, scope, null, null);
    }

    private FeeScheduleModel schedule(String id, double bp) {
        return new FeeScheduleModel(id, id, List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.RATE, BigDecimal.valueOf(bp), null, null, null)));
    }

    private List<RankedPolicy> ranking(RuleModel... rules) {
        return java.util.Arrays.stream(rules)
            .map(r -> new RankedPolicy(r, schedule(r.scheduleId(), 1.0), RankKey.of(schedule(r.scheduleId(), 1.0))))
            .sorted(PolicyRanking.comparator())
            .toList();
    }

    @Test
    void 셀마다_ScopeMatcher_통과_후보만_순위순으로_담긴다() {
        var all = rule("R-ALL", RuleType.BASE,
            new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), null));
        var mts = rule("R-MTS", RuleType.EVENT,
            new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), Set.of("MTS")));
        var ranking = ranking(all, mts);
        var universe = CellUniverse.universe(List.of(), List.of(all, mts));

        var map = CandidateMap.build(universe, ranking);

        FeeKey star = FeeKey.of(AssetClass.DOMESTIC_STOCK, "*", LookupKey.STOCK, "*", "*", null);
        FeeKey mtsCell = FeeKey.of(AssetClass.DOMESTIC_STOCK, "*", LookupKey.STOCK, "*", "MTS", null);
        assertThat(map.candidates(star)).extracting(p -> p.rule().id()).containsExactly("R-ALL");
        assertThat(map.candidates(mtsCell)).extracting(p -> p.rule().id()).containsExactly("R-MTS", "R-ALL");
        assertThat(map.cells()).containsExactlyInAnyOrderElementsOf(universe);
    }

    @Test
    void winnerAmong은_winnerFor와_같은_승자를_준다() {
        var all = rule("R-ALL", RuleType.BASE,
            new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), null));
        var mts = rule("R-MTS", RuleType.EVENT,
            new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), Set.of("MTS")));
        var ranking = ranking(all, mts);
        var acct = new AccountModel("A-1", "홍길동", "지점", false, BigDecimal.ZERO, BigDecimal.ZERO);
        FeeKey mtsCell = FeeKey.of(AssetClass.DOMESTIC_STOCK, "*", LookupKey.STOCK, "*", "MTS", null);

        var viaFor = WinnerResolver.winnerFor(mtsCell, acct, List.of(), ranking, TODAY);
        var candidates = CandidateMap.build(
            CellUniverse.universe(List.of(), List.of(all, mts)), ranking).candidates(mtsCell);
        var viaAmong = WinnerResolver.winnerAmong(candidates, acct, List.of(), TODAY);

        assertThat(viaAmong).isPresent();
        assertThat(viaAmong.get().ruleId()).isEqualTo(viaFor.get().ruleId());
        assertThat(viaAmong.get().sourceType()).isEqualTo(viaFor.get().sourceType());
    }
}
