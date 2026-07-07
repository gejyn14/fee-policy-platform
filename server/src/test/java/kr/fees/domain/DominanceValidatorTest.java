package kr.fees.domain;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class DominanceValidatorTest {

    private FeeScheduleModel rate(String id, double bp) {
        return new FeeScheduleModel(id, id, List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.RATE, BigDecimal.valueOf(bp), null, null, null)));
    }

    @Test
    void 전_구간_싼_요율표는_지배_성립() {
        assertThat(DominanceValidator.dominates(rate("EVT", 9.0), rate("BASE", 25.0))).isTrue();
    }

    @Test
    void 비싼_요율표는_지배_실패() {
        assertThat(DominanceValidator.dominates(rate("EVT", 30.0), rate("BASE", 25.0))).isFalse();
    }

    @Test
    void 지배_실패_지점을_반환() {
        var failure = DominanceValidator.explainFailure(rate("EVT", 30.0), rate("BASE", 25.0));
        assertThat(failure).isPresent();
        assertThat(failure.get().candidateFee()).isGreaterThan(failure.get().incumbentFee());
    }

    @Test
    void 구간_교차형은_역전_지점에서_지배_실패() {
        // 저가에선 싸지만 고가 구간에서 비싸지는 요율표
        var candidate = new FeeScheduleModel("C", "C", List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.BANDS, null, null, List.of(
                new RateBand(BigDecimal.ZERO, BigDecimal.valueOf(1000), BigDecimal.valueOf(5), null),
                new RateBand(BigDecimal.valueOf(1000), null, BigDecimal.valueOf(50), null)), null)));
        var incumbent = rate("BASE", 20.0);
        assertThat(DominanceValidator.dominates(candidate, incumbent)).isFalse();
    }

    @Test
    void 역마진_회사부담이_자사수취_초과시_경고() {
        var s = new FeeScheduleModel("RM", "역마진", List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.RATE, BigDecimal.valueOf(2.0), null, null, null),
            new FeeComponent("거래소", Kind.AGENCY, Payer.COMPANY, RateType.RATE, BigDecimal.valueOf(10.0), null, null, null)));
        // 자사 고객부과 2bp < 회사부담 10bp → 역마진
        assertThat(DominanceValidator.reverseMargin(s, new Execution(BigDecimal.valueOf(100), 10))).isTrue();
    }

    @Test
    void 정상_요율표는_역마진_아님() {
        var s = new FeeScheduleModel("OK", "정상", List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.RATE, BigDecimal.valueOf(20.0), null, null, null),
            new FeeComponent("거래소", Kind.AGENCY, Payer.COMPANY, RateType.RATE, BigDecimal.valueOf(3.0), null, null, null)));
        assertThat(DominanceValidator.reverseMargin(s, new Execution(BigDecimal.valueOf(100), 10))).isFalse();
    }
}
