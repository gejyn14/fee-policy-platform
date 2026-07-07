package kr.fees.domain;

import java.time.LocalDate;

/** 셀 승자 — 배정판 한 행의 근거. */
public record Winner(
    String scheduleId,
    String ruleId,
    RuleType sourceType,
    LocalDate validFrom,
    LocalDate validTo,
    String reason
) {}
