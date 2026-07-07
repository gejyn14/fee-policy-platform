package kr.fees.domain;

import java.math.BigDecimal;

/** 체결 표본. notional = price * qty. */
public record Execution(BigDecimal price, long qty) {

    public BigDecimal notional() {
        return price.multiply(BigDecimal.valueOf(qty));
    }
}
