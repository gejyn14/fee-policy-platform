package kr.fees.domain;

import java.time.LocalDate;
import java.util.List;

/**
 * 계좌별 자격 게이트 (기술설계서 v1.5 §5.2). binding.ts isTarget/isBenefitActive + eligibility.ts 이식.
 *   BASE       → 항상 통과(후보)
 *   EVENT      → 대상 게이트(isTarget) AND 기간 게이트(isBenefitActive)
 *   NEGOTIATED → 그 협의룰에 대해 ACTIVE enrollment 가 있고 validFrom ≤ today ≤ validTo
 */
public final class EligibilityGate {

    private EligibilityGate() {}

    public static boolean passes(RuleModel rule, AccountModel acct, List<Enrollment> enrollments, LocalDate today) {
        return switch (rule.type()) {
            case BASE -> true;
            case NEGOTIATED -> hasActiveEnrollment(rule, acct, enrollments, today);
            case EVENT -> isTarget(rule, acct, enrollments) && isBenefitActive(rule, acct, enrollments, today);
        };
    }

    private static boolean hasActiveEnrollment(RuleModel rule, AccountModel acct, List<Enrollment> enr, LocalDate today) {
        return enr.stream().anyMatch(e ->
            e.accountId().equals(acct.id())
                && e.ruleId().equals(rule.id())
                && e.status() == EnrollmentStatus.ACTIVE
                && e.validFrom() != null && e.validTo() != null
                && !today.isBefore(e.validFrom()) && !today.isAfter(e.validTo()));
    }

    /** 대상 편입 판정 — 조건 하드 게이트 후 apply mode 별. */
    static boolean isTarget(RuleModel rule, AccountModel acct, List<Enrollment> enr) {
        if (rule.condition() != null && !evalCondition(rule.condition(), acct)) return false;
        return switch (rule.applyMode()) {
            case TARGETED -> rule.targetAccountIds() == null || rule.targetAccountIds().contains(acct.id());
            case AUTO_ENROLL -> true;                 // 프로토타입: 전 계좌 가입 간주
            case DORMANT_RETURN -> acct.dormantReturned();
            case APPLICATION -> hasEnrollment(rule, acct, enr);
        };
    }

    /** 혜택 유효(시간) 판정 — 상대형은 계좌별 가입일 기준이라 룰 마감 이후에도 가입일+N까지 유효. */
    static boolean isBenefitActive(RuleModel rule, AccountModel acct, List<Enrollment> enr, LocalDate today) {
        if (rule.benefitKind() == BenefitKind.RELATIVE) {
            int months = rule.benefitMonths() == null ? 0 : rule.benefitMonths();
            return enr.stream()
                .filter(e -> e.accountId().equals(acct.id()) && e.ruleId().equals(rule.id()) && e.enrolledAt() != null)
                .findFirst()
                .map(e -> !today.isBefore(e.enrolledAt()) && !today.isAfter(e.enrolledAt().plusMonths(months)))
                .orElse(false);
        }
        return !today.isBefore(rule.startDate()) && !today.isAfter(rule.endDate());
    }

    private static boolean hasEnrollment(RuleModel rule, AccountModel acct, List<Enrollment> enr) {
        return enr.stream().anyMatch(e -> e.accountId().equals(acct.id()) && e.ruleId().equals(rule.id()));
    }

    static boolean evalCondition(ConditionSpec c, AccountModel acct) {
        java.math.BigDecimal value = c.metric() == ConditionMetric.AVG_ASSET_6M
            ? acct.metric6mAsset() : acct.metric6mVolume();
        return value.compareTo(c.threshold()) >= 0;
    }
}
