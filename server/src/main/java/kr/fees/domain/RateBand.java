package kr.fees.domain;

import java.math.BigDecimal;

/** 구간표 한 구간. to == null 이면 상한 없음. rateBp/flat 은 한쪽만 있어도 됨(없으면 0). */
public record RateBand(BigDecimal from, BigDecimal to, BigDecimal rateBp, BigDecimal flat) {

    public boolean contains(BigDecimal price) {
        return price.compareTo(from) >= 0 && (to == null || price.compareTo(to) < 0);
    }
}
