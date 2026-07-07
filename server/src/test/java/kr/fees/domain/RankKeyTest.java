package kr.fees.domain;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class RankKeyTest {

    @Test
    void 정률_요율표는_고객부과_bp_합() {
        var s = new FeeScheduleModel("SCH-OS-BASE", "해외주식 기본 0.25%", List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.RATE, BigDecimal.valueOf(25.0), null, null, null),
            new FeeComponent("거래소", Kind.AGENCY, Payer.COMPANY, RateType.RATE, BigDecimal.valueOf(3.0), null, null, null)));
        // 고객부과만: 25 (회사부담 3 제외)
        assertThat(RankKey.of(s)).isEqualByComparingTo("25.0");
    }

    @Test
    void 정액_요율표는_고객부과_정액_합() {
        var s = new FeeScheduleModel("SCH-OD-NEGO-T2", "해외파생 협의 T2 $0.80", List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.FLAT, null, BigDecimal.valueOf(0.80), null, null)));
        assertThat(RankKey.of(s)).isEqualByComparingTo("0.80");
    }

    @Test
    void 협의_T3가_T2보다_순위값이_낮다() {
        var t2 = new FeeScheduleModel("T2", "T2", List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.FLAT, null, BigDecimal.valueOf(0.80), null, null)));
        var t3 = new FeeScheduleModel("T3", "T3", List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.FLAT, null, BigDecimal.valueOf(0.50), null, null)));
        assertThat(RankKey.of(t3)).isLessThan(RankKey.of(t2));
    }

    @Test
    void 구간표는_대표구간_요율과_정액_합() {
        var band = new RateBand(BigDecimal.ZERO, null, BigDecimal.valueOf(14), BigDecimal.valueOf(13));
        var s = new FeeScheduleModel("OPT", "옵션", List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.BANDS, null, null, List.of(band), null)));
        assertThat(RankKey.of(s)).isEqualByComparingTo("27"); // 14 + 13
    }
}
