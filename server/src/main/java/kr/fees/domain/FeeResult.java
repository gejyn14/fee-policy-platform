package kr.fees.domain;

import java.math.BigDecimal;
import java.util.List;

public record FeeResult(BigDecimal customerTotal, BigDecimal companyBorne, List<FeeLine> lines) {}
