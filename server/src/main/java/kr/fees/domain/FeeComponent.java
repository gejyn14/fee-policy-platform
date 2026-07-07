package kr.fees.domain;

import java.math.BigDecimal;
import java.util.List;

/**
 * 요율표 구성요소. rateType 에 따라 rateBp(RATE) / flatAmount(FLAT) / bands(BANDS) 중 하나를 쓴다.
 * minFee 는 계산 후 하한.
 */
public record FeeComponent(
    String name,
    Kind kind,
    Payer payer,
    RateType rateType,
    BigDecimal rateBp,
    BigDecimal flatAmount,
    List<RateBand> bands,
    BigDecimal minFee
) {}
