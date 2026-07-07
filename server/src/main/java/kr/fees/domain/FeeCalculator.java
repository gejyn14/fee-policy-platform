package kr.fees.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * 요율표 평가. calc.ts 이식.
 *   정률 = 거래대금(notional) * bp / 10000
 *   정액 = flatAmount * qty
 *   구간표 = 매칭 구간의 (정률 + 정액) 동시 합산
 * 최소수수료로 하한. 반올림 HALF_UP 소수 2자리(구성요소·합계 각각).
 */
public final class FeeCalculator {

    private static final BigDecimal BP_DIVISOR = BigDecimal.valueOf(10_000);

    private FeeCalculator() {}

    public static BigDecimal componentAmount(FeeComponent c, Execution e) {
        BigDecimal amt = BigDecimal.ZERO;
        switch (c.rateType()) {
            case RATE -> amt = e.notional().multiply(nz(c.rateBp())).divide(BP_DIVISOR);
            case FLAT -> amt = nz(c.flatAmount()).multiply(BigDecimal.valueOf(e.qty()));
            case BANDS -> {
                RateBand band = bands(c).stream().filter(b -> b.contains(e.price())).findFirst().orElse(null);
                if (band != null) {
                    amt = e.notional().multiply(nz(band.rateBp())).divide(BP_DIVISOR)
                        .add(nz(band.flat()).multiply(BigDecimal.valueOf(e.qty())));
                }
            }
        }
        if (c.minFee() != null && amt.compareTo(c.minFee()) < 0) {
            amt = c.minFee();
        }
        return round(amt);
    }

    public static FeeResult calc(FeeScheduleModel schedule, Execution e) {
        List<FeeLine> lines = schedule.components().stream()
            .map(c -> new FeeLine(c.name(), c.kind(), c.payer(),
                c.payer() == Payer.EXEMPT ? BigDecimal.ZERO : componentAmount(c, e)))
            .toList();
        return new FeeResult(sumBy(lines, Payer.CUSTOMER), sumBy(lines, Payer.COMPANY), lines);
    }

    private static BigDecimal sumBy(List<FeeLine> lines, Payer payer) {
        BigDecimal s = lines.stream()
            .filter(l -> l.payer() == payer)
            .map(FeeLine::amount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        return round(s);
    }

    private static List<RateBand> bands(FeeComponent c) {
        return c.bands() == null ? List.of() : c.bands();
    }

    private static BigDecimal nz(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }

    private static BigDecimal round(BigDecimal v) {
        return v.setScale(2, RoundingMode.HALF_UP);
    }
}
