package kr.fees.domain;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/**
 * 셀 승자 확정 — 단일 경로 (기술설계서 v1.5 §3·§5). 협의 우선 분기 없음.
 * 랭킹을 내려가며 scope 매칭 + 자격 게이트 통과하는 첫 정책이 승자. resolve.ts 대체.
 * 전체 재산출·delta·수시 증분 세 배치 경로가 이 함수를 공유한다(로직 한 벌).
 */
public final class WinnerResolver {

    private WinnerResolver() {}

    public static Optional<Winner> winnerFor(FeeKey key, AccountModel acct, List<Enrollment> enrollments,
                                             List<RankedPolicy> ranking, LocalDate today) {
        for (RankedPolicy p : ranking) {
            RuleModel rule = p.rule();
            if (!ScopeMatcher.matches(rule.scope(), key)) continue;
            if (!EligibilityGate.passes(rule, acct, enrollments, today)) continue;
            return Optional.of(toWinner(rule, acct, enrollments));
        }
        return Optional.empty();
    }

    private static Winner toWinner(RuleModel rule, AccountModel acct, List<Enrollment> enrollments) {
        LocalDate from = rule.startDate();
        LocalDate to = rule.endDate();

        if (rule.type() == RuleType.NEGOTIATED) {
            Enrollment e = activeEnrollment(rule, acct, enrollments);
            if (e != null) { from = e.validFrom(); to = e.validTo(); }
        } else if (rule.type() == RuleType.EVENT && rule.benefitKind() == BenefitKind.RELATIVE) {
            Enrollment e = enrollmentFor(rule, acct, enrollments);
            if (e != null && e.enrolledAt() != null) {
                int months = rule.benefitMonths() == null ? 0 : rule.benefitMonths();
                from = e.enrolledAt();
                to = e.enrolledAt().plusMonths(months);
            }
        }

        return new Winner(rule.scheduleId(), rule.id(), rule.type(), from, to, reason(rule));
    }

    private static Enrollment activeEnrollment(RuleModel rule, AccountModel acct, List<Enrollment> enr) {
        return enr.stream()
            .filter(e -> e.accountId().equals(acct.id()) && e.ruleId().equals(rule.id())
                && e.status() == EnrollmentStatus.ACTIVE)
            .findFirst().orElse(null);
    }

    private static Enrollment enrollmentFor(RuleModel rule, AccountModel acct, List<Enrollment> enr) {
        return enr.stream()
            .filter(e -> e.accountId().equals(acct.id()) && e.ruleId().equals(rule.id()))
            .findFirst().orElse(null);
    }

    private static String reason(RuleModel rule) {
        String label = switch (rule.type()) {
            case BASE -> "기본(등급)";
            case EVENT -> "이벤트";
            case NEGOTIATED -> "협의수수료";
        };
        return label + " '" + rule.name() + "' 최저가 적용";
    }
}
