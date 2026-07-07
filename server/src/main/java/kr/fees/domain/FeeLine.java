package kr.fees.domain;

import java.math.BigDecimal;

public record FeeLine(String name, Kind kind, Payer payer, BigDecimal amount) {}
