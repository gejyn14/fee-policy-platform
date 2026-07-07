package kr.fees.domain;

import java.time.LocalDate;
import java.util.Set;

public record RuleModel(
    String id,
    String name,
    RuleType type,
    RuleStatus status,
    ApplyMode applyMode,
    LocalDate startDate,
    LocalDate endDate,
    BenefitKind benefitKind,
    Integer benefitMonths,
    String scheduleId,
    RuleScope scope,
    ConditionSpec condition,
    Set<String> targetAccountIds
) {}
