package kr.fees.domain;

import java.math.BigDecimal;

/** 통합 랭킹 한 항목 — 기본·이벤트·협의를 한 순위에 담는다. rank = 구조 그룹 순위값. */
public record RankedPolicy(RuleModel rule, FeeScheduleModel schedule, BigDecimal rank) {}
