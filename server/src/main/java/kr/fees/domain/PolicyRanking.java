package kr.fees.domain;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 통합 우선순위 랭킹 (기술설계서 v1.5 §5.1). BASE+EVENT+NEGOTIATED 를 한 순위에 담는다.
 * 정렬: ① rank(요율 최저) ② 타입(협의>이벤트>기본) ③ 범위 구체성(높은 쪽) ④ 룰ID(결정성).
 * build = 즉석 계산(순위 확정 시점에만 사용), fromStored = 승인 시점에 저장된 rank_value 를 읽어 구성(§10.4).
 */
public final class PolicyRanking {

    private static final Logger LOG = LoggerFactory.getLogger(PolicyRanking.class);

    private PolicyRanking() {}

    /** 4키 정렬의 단일 출처. */
    public static Comparator<RankedPolicy> comparator() {
        return Comparator
            .comparing(RankedPolicy::rank)
            .thenComparingInt((RankedPolicy p) -> p.rule().type().tieOrder())
            .thenComparing((RankedPolicy p) -> p.rule().scope().specificity(), Comparator.reverseOrder())
            .thenComparing(p -> p.rule().id());
    }

    public static List<RankedPolicy> build(List<RuleModel> rules, Map<String, FeeScheduleModel> schedules, LocalDate today) {
        return rules.stream()
            .filter(r -> inRanking(r, today))
            .map(r -> {
                FeeScheduleModel s = schedules.get(r.scheduleId());
                return s == null ? null : new RankedPolicy(r, s, RankKey.of(s));
            })
            .filter(Objects::nonNull)
            .sorted(comparator())
            .toList();
    }

    /**
     * 저장 순위값(fee_rule.rank_value)으로 랭킹 구성 — 배치·증분·화면의 표준 경로.
     * 저장값이 없는 룰(승인 경로를 우회해 ACTIVE 로 삽입된 시드·테스트 픽스처)은
     * 즉석 계산으로 fallback 하고 WARN 을 남긴다. 운영 경로는 승인/기동 시 항상 채운다.
     */
    public static List<RankedPolicy> fromStored(List<RuleModel> rules, Map<String, FeeScheduleModel> schedules,
                                                Map<String, BigDecimal> storedRanks, LocalDate today) {
        return rules.stream()
            .filter(r -> inRanking(r, today))
            .map(r -> {
                FeeScheduleModel s = schedules.get(r.scheduleId());
                if (s == null) return null;
                BigDecimal rank = storedRanks.get(r.id());
                if (rank == null) {
                    LOG.warn("rank_value 미저장 — 즉석 계산 fallback: {}", r.id());
                    rank = RankKey.of(s);
                }
                return new RankedPolicy(r, s, rank);
            })
            .filter(Objects::nonNull)
            .sorted(comparator())
            .toList();
    }

    /**
     * 순위 편입 조건 — ACTIVE + 기간. 단 상대형 이벤트는 기간이 계좌별 가입일 기준이라
     * 룰 기간(신청 마감)이 지나도 편입하고, 실제 유효는 게이트가 계좌별로 판정한다.
     */
    public static boolean inRanking(RuleModel r, LocalDate today) {
        if (r.status() != RuleStatus.ACTIVE) return false;
        if (r.type() == RuleType.EVENT && r.benefitKind() == BenefitKind.RELATIVE) return true;
        return !today.isBefore(r.startDate()) && !today.isAfter(r.endDate());
    }
}
