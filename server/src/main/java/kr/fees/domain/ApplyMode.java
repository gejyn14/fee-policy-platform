package kr.fees.domain;

public enum ApplyMode {
    APPLICATION,     // 신청형
    AUTO_ENROLL,     // 가입형(프로토타입: 전 계좌 가입 간주)
    DORMANT_RETURN,  // 휴면복귀형
    TARGETED         // 타겟추출형
}
