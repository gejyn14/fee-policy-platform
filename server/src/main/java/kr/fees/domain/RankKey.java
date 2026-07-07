package kr.fees.domain;

import java.math.BigDecimal;

/**
 * 구조 그룹 순위값 — 기준체결 없이 고객부과 요율 파라미터로 직접 비교.
 * 정률=요율(bp) 합, 정액=정액 합, 구간표=대표(첫) 구간의 (요율 + 정액). 최저가 우선.
 * policyRank.ts rankKey 이식.
 */
public final class RankKey {

    private RankKey() {}

    public static BigDecimal of(FeeScheduleModel schedule) {
        BigDecimal v = BigDecimal.ZERO;
        for (FeeComponent c : schedule.components()) {
            if (c.payer() != Payer.CUSTOMER) continue;
            switch (c.rateType()) {
                case RATE -> v = v.add(nz(c.rateBp()));
                case FLAT -> v = v.add(nz(c.flatAmount()));
                case BANDS -> {
                    if (c.bands() != null && !c.bands().isEmpty()) {
                        RateBand b = c.bands().get(0);
                        v = v.add(nz(b.rateBp())).add(nz(b.flat()));
                    }
                }
            }
        }
        return v;
    }

    private static BigDecimal nz(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }
}
