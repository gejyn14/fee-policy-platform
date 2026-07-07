package kr.fees.domain;

public enum Payer {
    CUSTOMER,  // 고객부과
    COMPANY,   // 회사부담(고객총액 제외)
    EXEMPT     // 면제(0)
}
