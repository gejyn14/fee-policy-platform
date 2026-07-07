package kr.fees.domain;

import java.time.LocalDate;

/** 계좌×룰 부여관계. 협의와 신청형 이벤트가 공용. */
public record Enrollment(
    long id,
    String accountId,
    String ruleId,
    EnrollmentStatus status,
    LocalDate validFrom,
    LocalDate validTo,
    QualifyType qualifyType,
    LocalDate enrolledAt
) {}
