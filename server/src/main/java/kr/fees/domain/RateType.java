package kr.fees.domain;

public enum RateType {
    RATE,   // 정률(거래대금 대비 bp)
    FLAT,   // 정액(계약/주문당)
    BANDS   // 구간표(체결단가 구간별)
}
