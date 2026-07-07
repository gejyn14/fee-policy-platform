package kr.fees.persistence;

import kr.fees.domain.*;
import kr.fees.service.LedgerLookupService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

class DomesticDerivSeedTest extends PgIntegrationTest {

    @Autowired ScheduleRepository schedules;
    @Autowired LedgerLookupService ledger;

    @Test
    void 국내파생_구간표가_밴드3구간으로_로드된다() {
        var s = schedules.findById("SCH-DD-BASE").orElseThrow();
        var own = s.components().get(0);
        assertThat(own.rateType()).isEqualTo(RateType.BANDS);
        assertThat(own.bands()).hasSize(3);
        assertThat(own.bands().get(0).to()).isEqualByComparingTo("0.42");
        assertThat(own.bands().get(2).to()).isNull(); // 상한 없음
    }

    @Test
    void 구간별_정률_정액_동시_계산() {
        var s = schedules.findById("SCH-DD-BASE").orElseThrow();
        // 정액(FLAT)은 계약당 금액 × 수량. 거래소 300원 × 10계약 = 3000 전 구간 공통.
        // 0.3pt, 10계약 → notional 3 → band0(14bp+13): 3*14bp=0.0042 + 13*10=130 → 130.00 (+3000)
        assertThat(FeeCalculator.calc(s, new Execution(new BigDecimal("0.3"), 10)).customerTotal())
            .isEqualByComparingTo("3130.00");
        // 1.0pt, 10계약 → notional 10 → band1(15bp): 10*15bp=0.015 → 0.02 (+3000)
        assertThat(FeeCalculator.calc(s, new Execution(new BigDecimal("1.0"), 10)).customerTotal())
            .isEqualByComparingTo("3000.02");
        // 3.0pt, 10계약 → notional 30 → band2(14.7bp+78): 30*14.7bp=0.0441 + 78*10=780 → 780.04 (+3000)
        assertThat(FeeCalculator.calc(s, new Execution(new BigDecimal("3.0"), 10)).customerTotal())
            .isEqualByComparingTo("3780.04");
    }

    @Test
    void K200_옵션_조회는_기본_구간표로_fallback() {
        var r = ledger.lookup("8041-2237-01", AssetClass.DOMESTIC_DERIV, LookupKey.OPTIONS,
            "KRX", "REGULAR", "K200", "MTS", LocalDate.of(2026, 7, 7)).orElseThrow();
        assertThat(r.sourceRuleId()).isEqualTo("R-BASE-DD");
        assertThat(r.scheduleId()).isEqualTo("SCH-DD-BASE");
        assertThat(r.fallbackToBase()).isTrue();
    }
}
