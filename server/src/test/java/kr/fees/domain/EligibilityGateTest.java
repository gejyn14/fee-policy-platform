package kr.fees.domain;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class EligibilityGateTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 7, 7);
    private final AccountModel acct = new AccountModel("8041-2237-01", "홍길동", "VIP",
        false, BigDecimal.valueOf(500_000_000), BigDecimal.valueOf(3_000_000_000L));

    private RuleModel rule(String id, RuleType type, ApplyMode mode, LocalDate start, LocalDate end,
                           BenefitKind bk, Integer months, ConditionSpec cond, Set<String> targets) {
        RuleScope scope = new RuleScope(AssetClass.OVERSEAS_DERIV, null, null, null, null, Set.of(), null);
        return new RuleModel(id, id, type, RuleStatus.ACTIVE, mode, start, end, bk, months, "SCH", scope, cond, targets);
    }

    private Enrollment enr(String ruleId, EnrollmentStatus st, LocalDate from, LocalDate to, LocalDate enrolledAt) {
        return new Enrollment(1L, acct.id(), ruleId, st, from, to, QualifyType.MET, enrolledAt);
    }

    @Test
    void 기본은_항상_통과() {
        var base = rule("R-BASE", RuleType.BASE, ApplyMode.AUTO_ENROLL,
            LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31), BenefitKind.CALENDAR, null, null, null);
        assertThat(EligibilityGate.passes(base, acct, List.of(), TODAY)).isTrue();
    }

    @Test
    void 협의는_enrollment_없으면_탈락_ACTIVE_기간내면_통과() {
        var nego = rule("R-NEGO-02", RuleType.NEGOTIATED, ApplyMode.APPLICATION,
            LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31), BenefitKind.CALENDAR, null, null, null);
        assertThat(EligibilityGate.passes(nego, acct, List.of(), TODAY)).isFalse();

        var active = enr("R-NEGO-02", EnrollmentStatus.ACTIVE,
            LocalDate.of(2026, 1, 2), LocalDate.of(2026, 12, 31), null);
        assertThat(EligibilityGate.passes(nego, acct, List.of(active), TODAY)).isTrue();
    }

    @Test
    void 협의_enrollment가_기간밖이면_탈락() {
        var nego = rule("R-NEGO-03", RuleType.NEGOTIATED, ApplyMode.APPLICATION,
            LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31), BenefitKind.CALENDAR, null, null, null);
        var expired = enr("R-NEGO-03", EnrollmentStatus.ACTIVE,
            LocalDate.of(2025, 1, 1), LocalDate.of(2026, 6, 30), null); // valid_to < today
        assertThat(EligibilityGate.passes(nego, acct, List.of(expired), TODAY)).isFalse();
    }

    @Test
    void 이벤트_상대형은_가입일_기준_윈도로_판정() {
        var evt = rule("R-EVT-REL", RuleType.EVENT, ApplyMode.APPLICATION,
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 6, 30),  // 신청 마감은 지났지만
            BenefitKind.RELATIVE, 3, null, null);
        var enrolled = enr("R-EVT-REL", EnrollmentStatus.ACTIVE, null, null, LocalDate.of(2026, 6, 1));
        // 가입일 2026-06-01 + 3개월 = 2026-09-01, today 07-07 은 윈도 안 → 통과
        assertThat(EligibilityGate.passes(evt, acct, List.of(enrolled), TODAY)).isTrue();
    }

    @Test
    void 이벤트_캘린더형은_룰_기간으로_판정() {
        var evt = rule("R-EVT-12", RuleType.EVENT, ApplyMode.APPLICATION,
            LocalDate.of(2026, 7, 1), LocalDate.of(2026, 12, 31), BenefitKind.CALENDAR, null, null, null);
        var enrolled = enr("R-EVT-12", EnrollmentStatus.ACTIVE, null, null, LocalDate.of(2026, 7, 1));
        assertThat(EligibilityGate.passes(evt, acct, List.of(enrolled), TODAY)).isTrue();
    }

    @Test
    void 휴면복귀형은_복귀_계좌만() {
        var dormant = rule("R-DORM", RuleType.EVENT, ApplyMode.DORMANT_RETURN,
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), BenefitKind.CALENDAR, null, null, null);
        assertThat(EligibilityGate.passes(dormant, acct, List.of(), TODAY)).isFalse();
        var returned = new AccountModel(acct.id(), acct.name(), acct.grade(), true,
            acct.metric6mAsset(), acct.metric6mVolume());
        assertThat(EligibilityGate.passes(dormant, returned, List.of(), TODAY)).isTrue();
    }

    @Test
    void 타겟추출형은_목록_포함_계좌만() {
        var targeted = rule("R-TGT", RuleType.EVENT, ApplyMode.TARGETED,
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), BenefitKind.CALENDAR, null, null,
            Set.of("9999-0000-01"));
        assertThat(EligibilityGate.passes(targeted, acct, List.of(), TODAY)).isFalse();
        var withMe = rule("R-TGT2", RuleType.EVENT, ApplyMode.TARGETED,
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), BenefitKind.CALENDAR, null, null,
            Set.of(acct.id()));
        assertThat(EligibilityGate.passes(withMe, acct, List.of(), TODAY)).isTrue();
    }

    @Test
    void 조건_미달이면_이벤트_대상에서_탈락() {
        var cond = new ConditionSpec(ConditionMetric.AVG_ASSET_6M,
            BigDecimal.valueOf(1_000_000_000L), ConditionSpec.ConditionAction.APPROVE_EXTEND);
        var evt = rule("R-COND", RuleType.EVENT, ApplyMode.AUTO_ENROLL,
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), BenefitKind.CALENDAR, null, cond, null);
        // acct 자산 5억 < 임계 10억 → 탈락
        assertThat(EligibilityGate.passes(evt, acct, List.of(), TODAY)).isFalse();
    }
}
