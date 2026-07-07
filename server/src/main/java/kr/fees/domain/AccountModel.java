package kr.fees.domain;

import java.math.BigDecimal;

public record AccountModel(
    String id,
    String name,
    String grade,
    boolean dormantReturned,
    BigDecimal metric6mAsset,
    BigDecimal metric6mVolume
) {}
