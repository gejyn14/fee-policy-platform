package kr.fees.domain;

public enum RuleType {
    // tieOrder: 동률 시 협의 > 이벤트 > 기본 (낮을수록 우선)
    NEGOTIATED(0), EVENT(1), BASE(2);

    private final int tieOrder;

    RuleType(int tieOrder) {
        this.tieOrder = tieOrder;
    }

    public int tieOrder() {
        return tieOrder;
    }
}
