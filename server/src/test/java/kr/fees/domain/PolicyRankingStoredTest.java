package kr.fees.domain;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class PolicyRankingStoredTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 7, 11);

    private RuleModel rule(String id, RuleType type, String scheduleId) {
        var scope = new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), null);
        return new RuleModel(id, id, type, RuleStatus.ACTIVE, ApplyMode.AUTO_ENROLL,
            LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31), BenefitKind.CALENDAR, null,
            scheduleId, scope, null, null);
    }

    private FeeScheduleModel schedule(String id, double customerBp) {
        return new FeeScheduleModel(id, id, List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.RATE,
                BigDecimal.valueOf(customerBp), null, null, null)));
    }

    @Test
    void 저장_순위값으로_정렬하고_결과가_build와_동일하다() {
        var rules = List.of(rule("R-B", RuleType.BASE, "S-B"), rule("R-E", RuleType.EVENT, "S-E"));
        var schedules = Map.of("S-B", schedule("S-B", 1.5), "S-E", schedule("S-E", 0.9));
        var stored = Map.of("R-B", new BigDecimal("1.5000"), "R-E", new BigDecimal("0.9000"));

        var fromStored = PolicyRanking.fromStored(rules, schedules, stored, TODAY);
        var fromBuild = PolicyRanking.build(rules, schedules, TODAY);

        assertThat(fromStored).extracting(p -> p.rule().id())
            .containsExactlyElementsOf(fromBuild.stream().map(p -> p.rule().id()).toList());
        assertThat(fromStored.get(0).rank()).isEqualByComparingTo("0.9000"); // 저장값 그대로
    }

    @Test
    void 저장값이_없는_룰은_즉석_계산으로_fallback() {
        var rules = List.of(rule("R-B", RuleType.BASE, "S-B"));
        var schedules = Map.of("S-B", schedule("S-B", 1.5));

        var out = PolicyRanking.fromStored(rules, schedules, Map.of(), TODAY);

        assertThat(out).hasSize(1);
        assertThat(out.get(0).rank()).isEqualByComparingTo("1.5"); // RankKey.of fallback
    }

    @Test
    void fromStored는_RankKey_재계산이_아닌_저장값을_사용한다() {
        // RankKey.of 순서상 R-A(1.0bp)가 R-B(2.0bp)보다 항상 싸다.
        // 하지만 storedRanks 에는 반대로(B 가 더 싸게) 박아넣어 fromStored 가
        // 재계산이 아니라 저장값을 그대로 신뢰하는지 검증한다.
        var ruleA = rule("R-A", RuleType.BASE, "S-A");
        var ruleB = rule("R-B2", RuleType.BASE, "S-B2");
        var schedules = Map.of("S-A", schedule("S-A", 1.0), "S-B2", schedule("S-B2", 2.0));
        var storedDivergent = Map.of("R-A", new BigDecimal("9.9999"), "R-B2", new BigDecimal("0.0001"));

        var fromBuild = PolicyRanking.build(List.of(ruleA, ruleB), schedules, TODAY);
        assertThat(fromBuild.get(0).rule().id()).isEqualTo("R-A"); // 재계산 기준으로는 A 가 1위

        var fromStored = PolicyRanking.fromStored(List.of(ruleA, ruleB), schedules, storedDivergent, TODAY);
        assertThat(fromStored.get(0).rule().id()).isEqualTo("R-B2"); // 저장값 기준으로는 B 가 1위
        assertThat(fromStored.get(0).rank()).isEqualByComparingTo("0.0001");
    }

    @Test
    void 기간_밖_룰은_저장값이_있어도_편입되지_않는다() {
        var expired = new RuleModel("R-X", "X", RuleType.EVENT, RuleStatus.ACTIVE, ApplyMode.AUTO_ENROLL,
            LocalDate.of(2025, 1, 1), LocalDate.of(2025, 12, 31), BenefitKind.CALENDAR, null, "S-B",
            new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), null), null, null);
        var out = PolicyRanking.fromStored(List.of(expired), Map.of("S-B", schedule("S-B", 1.5)),
            Map.of("R-X", BigDecimal.ONE), TODAY);
        assertThat(out).isEmpty(); // 멤버십(기간)은 읽기 시점 판정
    }
}
