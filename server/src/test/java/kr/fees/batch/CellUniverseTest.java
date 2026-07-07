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
