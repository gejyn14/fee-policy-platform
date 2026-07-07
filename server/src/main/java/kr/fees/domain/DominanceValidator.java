package kr.fees.domain;

import java.math.BigDecimal;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 등록 시점 지배관계 검증 (dominance.ts 이식) + 역마진 경고.
 * 우대 요율표가 기준선(기본)을 전 가격구간에서 하회해야 "진짜 우대"로 인정한다.
 */
public final class DominanceValidator {

    private DominanceValidator() {}

    public record Failure(BigDecimal price, BigDecimal candidateFee, BigDecimal incumbentFee) {}

    /** 두 요율표의 구간 경계 주변 + 기본 표본가로 검사 가격 목록 생성. */
    public static List<BigDecimal> probePrices(FeeScheduleModel a, FeeScheduleModel b) {
        Set<BigDecimal> pts = new LinkedHashSet<>();
        pts.add(BigDecimal.ONE);
        pts.add(BigDecimal.valueOf(100));
        pts.add(BigDecimal.valueOf(100_000));
        for (FeeScheduleModel s : List.of(a, b)) {
            for (FeeComponent c : s.components()) {
                if (c.bands() == null) continue;
                for (RateBand band : c.bands()) {
                    pts.add(band.from().add(new BigDecimal("0.01")));
                    if (band.to() != null) {
                        BigDecimal upper = band.to().subtract(new BigDecimal("0.01"));
                        pts.add(upper.max(band.from().add(new BigDecimal("0.01"))));
                    }
                }
            }
        }
        return pts.stream().sorted().toList();
    }

    /** candidate 가 모든 검사 가격에서 incumbent 이하인가. */
    public static boolean dominates(FeeScheduleModel candidate, FeeScheduleModel incumbent) {
        for (BigDecimal p : probePrices(candidate, incumbent)) {
            if (fee(candidate, p).compareTo(fee(incumbent, p)) > 0) return false;
        }
        return true;
    }

    /** candidate 가 incumbent 보다 비싼 지점 중 차액 최대 지점. 지배 성립이면 empty. */
    public static Optional<Failure> explainFailure(FeeScheduleModel candidate, FeeScheduleModel incumbent) {
        Failure worst = null;
        for (BigDecimal p : probePrices(candidate, incumbent)) {
            BigDecimal c = fee(candidate, p);
            BigDecimal i = fee(incumbent, p);
            if (c.compareTo(i) > 0) {
                BigDecimal gap = c.subtract(i);
                if (worst == null || gap.compareTo(worst.candidateFee().subtract(worst.incumbentFee())) > 0) {
                    worst = new Failure(p, c, i);
                }
            }
        }
        return Optional.ofNullable(worst);
    }

    /** 역마진: 회사부담 합계가 자사(OWN) 고객부과 수취분을 초과하면 경고. */
    public static boolean reverseMargin(FeeScheduleModel schedule, Execution probe) {
        FeeResult r = FeeCalculator.calc(schedule, probe);
        BigDecimal ownCustomer = r.lines().stream()
            .filter(l -> l.payer() == Payer.CUSTOMER && l.kind() == Kind.OWN)
            .map(FeeLine::amount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        return r.companyBorne().compareTo(ownCustomer) > 0;
    }

    private static BigDecimal fee(FeeScheduleModel s, BigDecimal price) {
        return FeeCalculator.calc(s, new Execution(price, 10)).customerTotal();
    }
}
