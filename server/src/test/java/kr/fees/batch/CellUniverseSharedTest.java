package kr.fees.batch;

import kr.fees.domain.*;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class CellUniverseSharedTest {

    private final List<ProductModel> products = List.of(
        new ProductModel(AssetClass.OVERSEAS_DERIV, "CME", "ES", "E-mini", "USD", List.of("REGULAR")));

    private RuleModel rule(String id, RuleScope scope) {
        return new RuleModel(id, id, RuleType.EVENT, RuleStatus.ACTIVE, ApplyMode.AUTO_ENROLL,
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), BenefitKind.CALENDAR, null, "S", scope, null, null);
    }

    @Test
    void universe는_cellsFor와_같은_열거의_계좌무관_상위집합이다() {
        var night = rule("R-N", new RuleScope(AssetClass.OVERSEAS_DERIV, null, Set.of("NIGHT"), null, null, Set.of(), null));
        var mts = rule("R-M", new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), Set.of("MTS")));
        var rules = List.of(night, mts);

        var uni = CellUniverse.universe(products, rules);
        var derivCells = CellUniverse.cellsFor("A", Set.of(AssetClass.OVERSEAS_DERIV), products, rules);
        var stockCells = CellUniverse.cellsFor("A", Set.of(AssetClass.DOMESTIC_STOCK), products, rules);

        // 계좌 전개는 universe 를 자산군으로 거른 것과 정확히 일치한다
        assertThat(uni.stream().filter(k -> k.assetClass() == AssetClass.OVERSEAS_DERIV).toList())
            .containsExactlyInAnyOrderElementsOf(derivCells);
        assertThat(uni.stream().filter(k -> k.assetClass() == AssetClass.DOMESTIC_STOCK).toList())
            .containsExactlyInAnyOrderElementsOf(stockCells);
        // 세션·채널 축이 유니버스에도 갈라져 있다 (야간 셀, MTS 셀 존재)
        assertThat(uni).anyMatch(k -> "NIGHT".equals(k.session()));
        assertThat(uni).anyMatch(k -> "MTS".equals(k.channel()));
    }
}
