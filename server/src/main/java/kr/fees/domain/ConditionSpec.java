package kr.fees.domain;

import java.math.BigDecimal;

/** 협의 조건(자격 판정) — 6개월 지표 임계값 + 연장 액션. */
public record ConditionSpec(ConditionMetric metric, BigDecimal threshold, ConditionAction action) {

    public enum ConditionAction { AUTO_EXTEND, APPROVE_EXTEND }
}
