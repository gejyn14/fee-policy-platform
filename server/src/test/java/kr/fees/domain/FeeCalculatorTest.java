package kr.fees.domain;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class FeeCalculatorTest {

    private FeeComponent rate(String name, Payer p, double bp) {
        return new FeeComponent(name, Kind.OWN, p, RateType.RATE, BigDecimal.valueOf(bp), null, null, null);
    }

    private Execution exec(double price, long qty) {
        return new Execution(BigDecimal.valueOf(price), qty);
    }

    @Test
    void 정률_구성요소는_거래대금_bp로_계산한다() {
        var s = new FeeScheduleModel("S1", "테스트", List.of(rate("자사", Payer.CUSTOMER, 25.0)));
        var r = FeeCalculator.calc(s, exec(100, 100)); // notional 10,000 * 25bp = 25
        assertThat(r.customerTotal()).isEqualByComparingTo("25.00");
    }

    @Test
    void 정액_구성요소는_수량당_금액으로_계산한다() {
        var c = new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.FLAT,
            null, BigDecimal.valueOf(0.80), null, null);
        var s = new FeeScheduleModel("OD", "해외파생 협의 T2", List.of(c));
        var r = FeeCalculator.calc(s, exec(5000, 10)); // 0.8 * 10 = 8
        assertThat(r.customerTotal()).isEqualByComparingTo("8.00");
    }

    @Test
    void 구간표는_정률과_정액을_동시에_더하고_최소수수료로_하한한다() {
        var band = new RateBand(BigDecimal.ZERO, null, BigDecimal.valueOf(14), BigDecimal.valueOf(13));
        var c = new FeeComponent("옵션", Kind.OWN, Payer.CUSTOMER, RateType.BANDS,
            null, null, List.of(band), BigDecimal.valueOf(1000));
        // price 50, qty 10 → notional 500 → 500*14bp=0.7 + 13*10=130 → 130.7 < min 1000 → 1000
        assertThat(FeeCalculator.componentAmount(c, exec(50, 10))).isEqualByComparingTo("1000.00");
    }

    @Test
    void 구간표_상한없는_구간과_경계_매칭() {
        var b1 = new RateBand(BigDecimal.ZERO, BigDecimal.valueOf(1000), BigDecimal.valueOf(10), null);
        var b2 = new RateBand(BigDecimal.valueOf(1000), null, BigDecimal.valueOf(5), null);
        var c = new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.BANDS, null, null, List.of(b1, b2), null);
        // price 1000 → b1 은 [0,1000) 이라 미포함, b2 [1000,∞) 포함 → notional 1000*10 * 5bp = 5
        assertThat(FeeCalculator.componentAmount(c, exec(1000, 10))).isEqualByComparingTo("5.00");
    }

    @Test
    void 면제는_0이고_회사부담은_고객합계에서_빠진다() {
        var s = new FeeScheduleModel("S2", "테스트", List.of(
            rate("자사", Payer.CUSTOMER, 20.0),
            rate("거래소", Payer.COMPANY, 5.0),
            rate("예탁원", Payer.EXEMPT, 3.0)));
        var r = FeeCalculator.calc(s, exec(100, 100)); // notional 10,000
        assertThat(r.customerTotal()).isEqualByComparingTo("20.00");
        assertThat(r.companyBorne()).isEqualByComparingTo("5.00");
        assertThat(r.lines().get(2).amount()).isEqualByComparingTo("0");
    }

    @Test
    void 여러_고객부과_구성요소는_합산된다() {
        var s = new FeeScheduleModel("S3", "해외주식 기본", List.of(
            rate("자사", Payer.CUSTOMER, 25.0),
            rate("거래소", Payer.CUSTOMER, 2.0)));
        var r = FeeCalculator.calc(s, exec(100, 100)); // (25+2)bp * 10000 = 27
        assertThat(r.customerTotal()).isEqualByComparingTo("27.00");
    }
}
