package kr.fees.domain;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * 통합 우선순위 랭킹 (기술설계서 v1.5 §5.1). BASE+EVENT+NEGOTIATED 를 한 순위에 담는다.
 * 정렬: ① rank(요율 최저) ② 타입(협의>이벤트>기본) ③ 범위 구체성(높은 쪽) ④ 룰ID(결정성).
 * policyRank.ts 이식 — 단, NEGOTIATED 를 편입한다(v0.8 오버레이 폐기).
 */
public final class PolicyRanking {

    private PolicyRanking() {}

    public static List<RankedPolicy> build(List<RuleModel> rules, Map<String, FeeScheduleModel> schedules, LocalDate today) {
        return rules.stream()
            .filter(r -> inRanking(r, today))
            .map(r -> {
                FeeScheduleModel s = schedules.get(r.scheduleId());
                return s == null ? null : new RankedPolicy(r, s, RankKey.of(s));
            })
            .filter(p -> p != null)
            .sorted(Comparator
                .comparing(RankedPolicy::rank)
                .thenComparingInt((RankedPolicy p) -> p.rule().type().tieOrder())
                .thenComparing((RankedPolicy p) -> p.rule().scope().specificity(), Comparator.reverseOrder())
                .thenComparing(p -> p.rule().id()))
            .toList();
    }

    /**
     * 순위 편입 조건 — ACTIVE + 기간. 단 상대형 이벤트는 기간이 계좌별 가입일 기준이라
     * 룰 기간(신청 마감)이 지나도 편입하고, 실제 유효는 게이트가 계좌별로 판정한다.
     */
    private static boolean inRanking(RuleModel r, LocalDate today) {
        if (r.status() != RuleStatus.ACTIVE) return false;
        if (r.type() == RuleType.EVENT && r.benefitKind() == BenefitKind.RELATIVE) return true;
        return !today.isBefore(r.startDate()) && !today.isAfter(r.endDate());
    }
}
