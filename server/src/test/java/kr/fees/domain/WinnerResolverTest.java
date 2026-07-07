package kr.fees.domain;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 기술설계서 v1.5 §5.3·§6.2 시나리오를 도메인 레벨로 재현.
 * 계좌 8041-2237-01: 해외파생 협의 T2 보유, 해외 ETF 이벤트 가입.
 */
class WinnerResolverTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 7, 7);
    private final AccountModel acct = new AccountModel("8041-2237-01", "홍길동", "VIP",
        false, BigDecimal.valueOf(500_000_000), BigDecimal.valueOf(3_000_000_000L));

    // ---- 요율표 ----
    private FeeScheduleModel rateSched(String id, double bp) {
        return new FeeScheduleModel(id, id, List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.RATE, BigDecimal.valueOf(bp), null, null, null)));
    }
    private FeeScheduleModel flatSched(String id, double flat) {
        return new FeeScheduleModel(id, id, List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.FLAT, null, BigDecimal.valueOf(flat), null, null)));
    }

    private final Map<String, FeeScheduleModel> schedules = Map.of(
        "SCH-OS-BASE", rateSched("SCH-OS-BASE", 25.0),
        "SCH-OS-EVT-03", rateSched("SCH-OS-EVT-03", 9.0),
        "SCH-OD-BASE", flatSched("SCH-OD-BASE", 2.50),
        "SCH-OD-NEGO-T2", flatSched("SCH-OD-NEGO-T2", 0.80),
        "SCH-OD-NEGO-T3", flatSched("SCH-OD-NEGO-T3", 0.50));

    // ---- 룰 ----
    private RuleModel rule(String id, RuleType type, AssetClass ac, Set<LookupKey> lks, String schedId,
                           ApplyMode mode, LocalDate start, LocalDate end) {
        RuleScope scope = new RuleScope(ac, null, null, lks, null, Set.of(), null);
        return new RuleModel(id, id, type, RuleStatus.ACTIVE, mode, start, end,
            BenefitKind.CALENDAR, null, schedId, scope, null, null);
    }

    private List<RuleModel> rules() {
        return List.of(
            rule("R-BASE-01", RuleType.BASE, AssetClass.OVERSEAS_STOCK, null, "SCH-OS-BASE",
                ApplyMode.AUTO_ENROLL, LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31)),
            rule("R-EVT-12", RuleType.EVENT, AssetClass.OVERSEAS_STOCK, Set.of(LookupKey.ETF), "SCH-OS-EVT-03",
                ApplyMode.APPLICATION, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 12, 31)),
            rule("R-BASE-05", RuleType.BASE, AssetClass.OVERSEAS_DERIV, null, "SCH-OD-BASE",
                ApplyMode.AUTO_ENROLL, LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31)),
            rule("R-NEGO-02", RuleType.NEGOTIATED, AssetClass.OVERSEAS_DERIV, null, "SCH-OD-NEGO-T2",
                ApplyMode.APPLICATION, LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31)),
            rule("R-NEGO-03", RuleType.NEGOTIATED, AssetClass.OVERSEAS_DERIV, null, "SCH-OD-NEGO-T3",
                ApplyMode.APPLICATION, LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31)));
    }

    // enrollment: T2 승인(2026-01-02~12-31), ETF 이벤트 가입(07-01)
    private final List<Enrollment> enrollments = List.of(
        new Enrollment(9001L, acct.id(), "R-NEGO-02", EnrollmentStatus.ACTIVE,
            LocalDate.of(2026, 1, 2), LocalDate.of(2026, 12, 31), QualifyType.MET, null),
        new Enrollment(9002L, acct.id(), "R-EVT-12", EnrollmentStatus.ACTIVE,
            null, null, QualifyType.MET, LocalDate.of(2026, 7, 1)));

    private Optional<Winner> resolve(FeeKey key) {
        return WinnerResolver.winnerFor(key, acct, enrollments, PolicyRanking.build(rules(), schedules, TODAY), TODAY);
    }

    @Test
    void 해외ETF_셀은_이벤트가_승자() {
        var key = FeeKey.of(AssetClass.OVERSEAS_STOCK, "*", LookupKey.ETF, "*", "MTS", null);
        var w = resolve(key).orElseThrow();
        assertThat(w.sourceType()).isEqualTo(RuleType.EVENT);
        assertThat(w.ruleId()).isEqualTo("R-EVT-12");
    }

    @Test
    void 해외주식_셀은_기본이_승자() {
        var key = FeeKey.of(AssetClass.OVERSEAS_STOCK, "*", LookupKey.STOCK, "*", "MTS", null);
        var w = resolve(key).orElseThrow();
        assertThat(w.sourceType()).isEqualTo(RuleType.BASE);
        assertThat(w.ruleId()).isEqualTo("R-BASE-01");
    }

    @Test
    void ES선물_셀은_T3가_더_싸도_enrollment_보유한_T2가_승자() {
        var key = FeeKey.of(AssetClass.OVERSEAS_DERIV, "CME", LookupKey.FUTURES, "*", "MTS", "ES");
        var w = resolve(key).orElseThrow();
        assertThat(w.sourceType()).isEqualTo(RuleType.NEGOTIATED);
        assertThat(w.ruleId()).isEqualTo("R-NEGO-02");   // T3(0.5)는 enrollment 없어 탈락
        assertThat(w.validTo()).isEqualTo(LocalDate.of(2026, 12, 31)); // enrollment 기간 전파
    }

    @Test
    void ES옵션_셀도_협의_범위_전체라_T2가_승자() {
        // 이 시나리오의 협의룰은 lookupKey 무제한이라 옵션에도 적용됨(§6.2 예시는 선물만 협의범위였으나
        // 여기선 룰 scope 전체이므로 옵션도 T2). 조회구분 분리 자체는 ScopeMatcherTest 가 검증.
        var key = FeeKey.of(AssetClass.OVERSEAS_DERIV, "CME", LookupKey.OPTIONS, "*", "MTS", "ES");
        var w = resolve(key).orElseThrow();
        assertThat(w.sourceType()).isEqualTo(RuleType.NEGOTIATED);
    }

    @Test
    void 협의_범위가_선물한정이면_옵션은_기본() {
        // R-NEGO-02 를 FUTURES 한정으로 좁히면 옵션 셀은 기본으로 떨어진다(§6.2 재현).
        var futuresNego = rule("R-NEGO-02", RuleType.NEGOTIATED, AssetClass.OVERSEAS_DERIV,
            Set.of(LookupKey.FUTURES), "SCH-OD-NEGO-T2", ApplyMode.APPLICATION,
            LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31));
        var ruleset = List.of(
            rule("R-BASE-05", RuleType.BASE, AssetClass.OVERSEAS_DERIV, null, "SCH-OD-BASE",
                ApplyMode.AUTO_ENROLL, LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31)),
            futuresNego);
        var ranking = PolicyRanking.build(ruleset, schedules, TODAY);

        var futures = FeeKey.of(AssetClass.OVERSEAS_DERIV, "CME", LookupKey.FUTURES, "*", "MTS", "ES");
        var options = FeeKey.of(AssetClass.OVERSEAS_DERIV, "CME", LookupKey.OPTIONS, "*", "MTS", "ES");
        assertThat(WinnerResolver.winnerFor(futures, acct, enrollments, ranking, TODAY).orElseThrow().sourceType())
            .isEqualTo(RuleType.NEGOTIATED);
        assertThat(WinnerResolver.winnerFor(options, acct, enrollments, ranking, TODAY).orElseThrow().sourceType())
            .isEqualTo(RuleType.BASE);
    }

    @Test
    void 동률이면_협의_이벤트_기본_순() {
        // 같은 요율(rank 동률)일 때 tie-break 확인. 세 룰 모두 정률 10bp.
        var base = rule("R-B", RuleType.BASE, AssetClass.OVERSEAS_STOCK, null, "S10",
            ApplyMode.AUTO_ENROLL, LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31));
        var evt = rule("R-E", RuleType.EVENT, AssetClass.OVERSEAS_STOCK, null, "S10",
            ApplyMode.AUTO_ENROLL, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31));
        var nego = rule("R-N", RuleType.NEGOTIATED, AssetClass.OVERSEAS_STOCK, null, "S10",
            ApplyMode.APPLICATION, LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31));
        var sched = Map.of("S10", rateSched("S10", 10.0));
        var enr = List.of(new Enrollment(1L, acct.id(), "R-N", EnrollmentStatus.ACTIVE,
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), QualifyType.MET, null));
        var ranking = PolicyRanking.build(List.of(base, evt, nego), sched, TODAY);
        var key = FeeKey.of(AssetClass.OVERSEAS_STOCK, "*", LookupKey.STOCK, "*", "MTS", null);
        assertThat(WinnerResolver.winnerFor(key, acct, enr, ranking, TODAY).orElseThrow().sourceType())
            .isEqualTo(RuleType.NEGOTIATED);
    }
}
