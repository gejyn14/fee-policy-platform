package kr.fees.persistence;

import kr.fees.domain.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class RepositoryTest extends PgIntegrationTest {

    @Autowired ScheduleRepository schedules;
    @Autowired RuleRepository rules;
    @Autowired EnrollmentRepository enrollments;
    @Autowired BindingRepository bindings;
    @Autowired AccountRepository accounts;

    @Test
    void 요율표를_구성요소와_함께_로드() {
        var s = schedules.findById("SCH-OS-BASE").orElseThrow();
        assertThat(s.components()).hasSize(1);
        assertThat(RankKey.of(s)).isEqualByComparingTo("25.0");
    }

    @Test
    void 활성룰만_findActive에_나오고_대기룰은_제외() {
        var active = rules.findActive(LocalDate.of(2026, 7, 7));
        assertThat(active).extracting(RuleModel::id).contains("R-BASE-01", "R-NEGO-02");
        assertThat(active).extracting(RuleModel::id).doesNotContain("R-EVT-DS"); // PENDING
    }

    @Test
    void 룰_scope_배열이_왕복된다() {
        var etf = rules.findById("R-EVT-12").orElseThrow();
        assertThat(etf.scope().lookupKeys()).containsExactly(LookupKey.ETF);
        var base = rules.findById("R-BASE-01").orElseThrow();
        assertThat(base.scope().lookupKeys()).isNull(); // 전체
    }

    @Test
    void 룰_insert_후_scope_배열과_조건이_보존된다() {
        var scope = new RuleScope(AssetClass.OVERSEAS_DERIV, java.util.Set.of("CME"), null,
            java.util.Set.of(LookupKey.FUTURES), java.util.Set.of("ES"), java.util.Set.of("GC"), java.util.Set.of("MTS"));
        var cond = new ConditionSpec(ConditionMetric.VOLUME_6M, BigDecimal.valueOf(100000000),
            ConditionSpec.ConditionAction.APPROVE_EXTEND);
        var r = new RuleModel("R-TEST-INS", "테스트룰", RuleType.EVENT, RuleStatus.DRAFT, ApplyMode.TARGETED,
            LocalDate.of(2026, 7, 1), LocalDate.of(2026, 12, 31), BenefitKind.CALENDAR, null, "SCH-OD-BASE",
            scope, cond, java.util.Set.of("8041-2237-01"));
        rules.insert(r);
        var back = rules.findById("R-TEST-INS").orElseThrow();
        assertThat(back.scope().exchanges()).containsExactly("CME");
        assertThat(back.scope().lookupKeys()).containsExactly(LookupKey.FUTURES);
        assertThat(back.scope().excludeProducts()).containsExactly("GC");
        assertThat(back.condition().metric()).isEqualTo(ConditionMetric.VOLUME_6M);
        assertThat(back.targetAccountIds()).containsExactly("8041-2237-01");
    }

    @Test
    void 계좌의_부여관계_로드() {
        var e = enrollments.findByAccount("8041-2237-01");
        assertThat(e).extracting(Enrollment::ruleId).containsExactlyInAnyOrder("R-NEGO-02", "R-EVT-12");
        var nego = e.stream().filter(x -> x.ruleId().equals("R-NEGO-02")).findFirst().orElseThrow();
        assertThat(nego.validTo()).isEqualTo(LocalDate.of(2026, 12, 31));
    }

    @Test
    void 배정판_적재후_조회계약이_구체행을_우선한다() {
        // 두 행: '*' 채널 기본우대 + MTS 한정 우대 — MTS 조회 시 MTS 행이 우선
        var star = new BindingRow("ACC-LKP", AssetClass.OVERSEAS_DERIV, "CME", LookupKey.FUTURES, "*", "ES", "*",
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), "SCH-OD-NEGO-T3", "R-NEGO-03", RuleType.NEGOTIATED, "star");
        var mts = new BindingRow("ACC-LKP", AssetClass.OVERSEAS_DERIV, "CME", LookupKey.FUTURES, "*", "ES", "MTS",
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), "SCH-OD-NEGO-T2", "R-NEGO-02", RuleType.NEGOTIATED, "mts");
        bindings.batchInsert(List.of(star, mts));

        var p = new BindingRepository.LookupParams("ACC-LKP", AssetClass.OVERSEAS_DERIV, LookupKey.FUTURES,
            "CME", "REGULAR", "ES", "MTS", LocalDate.of(2026, 7, 7));
        Optional<BindingRepository.LookupResult> r = bindings.lookup(p);
        assertThat(r).isPresent();
        assertThat(r.get().sourceRuleId()).isEqualTo("R-NEGO-02"); // MTS 구체행 우선
    }

    @Test
    void 배정판_미스는_empty를_반환() {
        var p = new BindingRepository.LookupParams("NO-SUCH-ACCT", AssetClass.DOMESTIC_STOCK, LookupKey.STOCK,
            "KRX", "REGULAR", "*", "MTS", LocalDate.of(2026, 7, 7));
        assertThat(bindings.lookup(p)).isEmpty();
    }

    @Test
    void 계좌가_개설한_상품군_조회() {
        assertThat(accounts.openedGroups("8041-2237-01"))
            .containsExactlyInAnyOrder(AssetClass.OVERSEAS_DERIV, AssetClass.OVERSEAS_STOCK);
    }
}
