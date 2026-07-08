package kr.fees.batch;

import kr.fees.domain.*;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class CellUniverseTest {

    private final List<ProductModel> products = List.of(
        new ProductModel(AssetClass.OVERSEAS_DERIV, "CME", "ES", "E-mini", "USD", List.of("REGULAR")),
        new ProductModel(AssetClass.OVERSEAS_DERIV, "CME", "GC", "Gold", "USD", List.of("REGULAR")));

    private RuleModel channelRule(Set<String> channels) {
        var scope = new RuleScope(AssetClass.OVERSEAS_STOCK, null, null, Set.of(LookupKey.ETF), null, Set.of(), channels);
        return new RuleModel("R-CH", "MTS 이벤트", RuleType.EVENT, RuleStatus.ACTIVE, ApplyMode.AUTO_ENROLL,
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), BenefitKind.CALENDAR, null, "S", scope, null, null);
    }

    @Test
    void 파생은_품목마다_선물옵션_두_셀() {
        var cells = CellUniverse.cellsFor("A", Set.of(AssetClass.OVERSEAS_DERIV), products, List.of());
        // ES,GC × {FUTURES,OPTIONS} = 4
        assertThat(cells).hasSize(4);
        assertThat(cells).allSatisfy(c -> assertThat(c.product()).isIn("ES", "GC"));
        assertThat(cells).extracting(FeeKey::lookupKey)
            .contains(LookupKey.FUTURES, LookupKey.OPTIONS);
    }

    @Test
    void 해외주식은_STOCK과_ETF_품목없음() {
        var cells = CellUniverse.cellsFor("A", Set.of(AssetClass.OVERSEAS_STOCK), List.of(), List.of());
        assertThat(cells).hasSize(2);
        assertThat(cells).allSatisfy(c -> assertThat(c.product()).isNull());
        assertThat(cells).extracting(FeeKey::lookupKey).containsExactlyInAnyOrder(LookupKey.STOCK, LookupKey.ETF);
    }

    @Test
    void 미개설_상품군은_전개되지_않는다() {
        var cells = CellUniverse.cellsFor("A", Set.of(AssetClass.DOMESTIC_STOCK), products, List.of());
        assertThat(cells).hasSize(1); // STOCK 하나
        assertThat(cells.get(0).assetClass()).isEqualTo(AssetClass.DOMESTIC_STOCK);
    }

    private RuleModel eventRule(String id, RuleScope scope) {
        return new RuleModel(id, id, RuleType.EVENT, RuleStatus.ACTIVE, ApplyMode.TARGETED,
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), BenefitKind.CALENDAR, null, "S", scope, null, null);
    }

    @Test
    void 세션한정과_채널한정이_공존하면_교차셀도_전개() {
        var nightRule = eventRule("R-NIGHT", new RuleScope(AssetClass.OVERSEAS_DERIV,
            null, Set.of("NIGHT"), Set.of(LookupKey.FUTURES), null, Set.of(), null));
        var mtsRule = eventRule("R-MTS", new RuleScope(AssetClass.OVERSEAS_DERIV,
            null, null, Set.of(LookupKey.FUTURES), null, Set.of(), Set.of("MTS")));

        var cells = CellUniverse.cellsFor("A", Set.of(AssetClass.OVERSEAS_DERIV), products,
            List.of(nightRule, mtsRule));

        // 두 룰이 동시에 적용되는 (야간, MTS) 교차 셀이 있어야 대각선 체결의 완결된 답이 판에 실린다
        assertThat(cells).anySatisfy(c -> {
            assertThat(c.lookupKey()).isEqualTo(LookupKey.FUTURES);
            assertThat(c.session()).isEqualTo("NIGHT");
            assertThat(c.channel()).isEqualTo("MTS");
        });
    }

    @Test
    void 주식_거래소한정_룰은_거래소_구체셀을_만든다() {
        var nasdaqRule = eventRule("R-NASDAQ", new RuleScope(AssetClass.OVERSEAS_STOCK,
            Set.of("NASDAQ"), null, Set.of(LookupKey.STOCK), null, Set.of(), null));

        var cells = CellUniverse.cellsFor("A", Set.of(AssetClass.OVERSEAS_STOCK), List.of(),
            List.of(nasdaqRule));

        // 거래소 한정 주식 룰이 매칭될 수 있는 NASDAQ 구체 셀 + 기존 '*' 셀 유지
        assertThat(cells).anySatisfy(c -> {
            assertThat(c.lookupKey()).isEqualTo(LookupKey.STOCK);
            assertThat(c.exchange()).isEqualTo("NASDAQ");
        });
        assertThat(cells).anySatisfy(c -> {
            assertThat(c.lookupKey()).isEqualTo(LookupKey.STOCK);
            assertThat(c.exchange()).isEqualTo("*");
        });
    }

    @Test
    void 채널한정_이벤트가_있으면_해당_셀에_채널_구체행_추가() {
        var withMts = CellUniverse.cellsFor("A", Set.of(AssetClass.OVERSEAS_STOCK), List.of(),
            List.of(channelRule(Set.of("MTS"))));
        // STOCK('*') + ETF('*') + ETF(MTS) = 3  (ETF만 채널룰 매칭)
        assertThat(withMts).hasSize(3);
        assertThat(withMts).anySatisfy(c -> {
            assertThat(c.lookupKey()).isEqualTo(LookupKey.ETF);
            assertThat(c.channel()).isEqualTo("MTS");
        });
    }
}
