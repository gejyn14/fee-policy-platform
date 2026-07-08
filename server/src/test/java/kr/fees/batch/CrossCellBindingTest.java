package kr.fees.batch;

import kr.fees.domain.AssetClass;
import kr.fees.domain.LookupKey;
import kr.fees.persistence.BindingRepository;
import kr.fees.persistence.PgIntegrationTest;
import kr.fees.service.LedgerLookupService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 셀 유니버스 교차 전개 관통 테스트.
 *   ① 세션 한정 룰 × 채널 한정 룰 공존 시 교차 셀의 승자가 요율 최저로 정해지는가(고객 유리)
 *   ② 거래소 한정 주식 룰이 배정판에 실제로 붙는가
 */
class CrossCellBindingTest extends PgIntegrationTest {

    private static final LocalDate BASE = LocalDate.of(2026, 7, 7);

    @Autowired BindingRebuilder rebuilder;
    @Autowired BindingRepository bindings;
    @Autowired LedgerLookupService ledger;
    @Autowired JdbcTemplate jdbc;

    private void insertEvent(String ruleId, String scheduleId, double rateBp, String scopeCol, String scopeVal) {
        jdbc.update("INSERT INTO fee_schedule(schedule_id, schedule_name) VALUES (?, ?)", scheduleId, ruleId);
        jdbc.update("""
            INSERT INTO fee_component(schedule_id, seq, name, kind, payer, rate_type, rate_bp)
            VALUES (?, 0, '자사 수수료', 'OWN', 'CUSTOMER', 'RATE', ?)""", scheduleId, rateBp);
        jdbc.update("""
            INSERT INTO fee_rule(rule_id, rule_name, rule_type, rule_status, apply_mode, start_date, end_date,
                benefit_kind, schedule_id, scope_asset_class, scope_lookup_keys, %s)
            VALUES (?, ?, 'EVENT', 'ACTIVE', 'TARGETED', '2026-01-01', '2026-12-31',
                'CALENDAR', ?, ?, ARRAY['STOCK'], ARRAY[?])""".formatted(scopeCol),
            ruleId, ruleId, scheduleId, scopeVal.equals("NIGHT") || scopeVal.equals("MTS") ? "DOMESTIC_STOCK" : "OVERSEAS_STOCK", scopeVal);
    }

    @Test
    void 세션이벤트와_채널이벤트_교차체결은_요율최저로_흘러간다() {
        // 국내주식(기본 rank 25): 야간 한정 5bp vs MTS 한정 12bp
        insertEvent("R-T-NIGHT", "SCH-T-NIGHT", 5.0, "scope_sessions", "NIGHT");
        insertEvent("R-T-MTS", "SCH-T-MTS", 12.0, "scope_channels", "MTS");

        rebuilder.fullRebuild(BASE);

        // 교차 셀 (야간, MTS) 행이 존재하고, 더 싼 야간 이벤트가 승자여야 한다
        var rows = bindings.findByAccount("6015-8890-42");
        assertThat(rows).anySatisfy(r -> {
            assertThat(r.sessionCode()).isEqualTo("NIGHT");
            assertThat(r.channelCode()).isEqualTo("MTS");
            assertThat(r.scheduleId()).isEqualTo("SCH-T-NIGHT");
        });

        // 야간+MTS 체결 → 5bp(야간 이벤트). 채널 우선 폴백으로 12bp에 붙으면 고객 유리 위반
        var hit = ledger.lookup("6015-8890-42", AssetClass.DOMESTIC_STOCK, LookupKey.STOCK,
            "KRX", "NIGHT", "*", "MTS", BASE);
        assertThat(hit).isPresent();
        assertThat(hit.get().scheduleId()).isEqualTo("SCH-T-NIGHT");
    }

    @Test
    void 거래소한정_주식이벤트가_배정판에_붙는다() {
        // 해외주식(기본 rank 25): NASDAQ 한정 7bp
        insertEvent("R-T-NASDAQ", "SCH-T-NASDAQ", 7.0, "scope_exchanges", "NASDAQ");

        rebuilder.fullRebuild(BASE);

        var rows = bindings.findByAccount("8041-2237-01");
        assertThat(rows).anySatisfy(r -> {
            assertThat(r.exchangeCode()).isEqualTo("NASDAQ");
            assertThat(r.lookupKey()).isEqualTo(LookupKey.STOCK);
            assertThat(r.scheduleId()).isEqualTo("SCH-T-NASDAQ");
        });

        // NASDAQ 체결은 이벤트, 타 거래소(NYSE) 체결은 기본으로
        var nasdaq = ledger.lookup("8041-2237-01", AssetClass.OVERSEAS_STOCK, LookupKey.STOCK,
            "NASDAQ", "REGULAR", "*", "HTS", BASE);
        assertThat(nasdaq).isPresent();
        assertThat(nasdaq.get().scheduleId()).isEqualTo("SCH-T-NASDAQ");

        var nyse = ledger.lookup("8041-2237-01", AssetClass.OVERSEAS_STOCK, LookupKey.STOCK,
            "NYSE", "REGULAR", "*", "HTS", BASE);
        assertThat(nyse).isPresent();
        assertThat(nyse.get().fallbackToBase()).isTrue();
    }
}
