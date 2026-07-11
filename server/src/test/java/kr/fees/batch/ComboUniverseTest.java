package kr.fees.batch;

import kr.fees.domain.*;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class ComboUniverseTest {

    private final List<ProductModel> products = List.of(
        new ProductModel(AssetClass.OVERSEAS_DERIV, "CME", "ES", "E-mini", "USD", List.of("REGULAR")),
        new ProductModel(AssetClass.OVERSEAS_DERIV, "CME", "GC", "Gold", "USD", List.of("REGULAR")));

    private RuleModel rule(String id, RuleScope scope) {
        return new RuleModel(id, id, RuleType.BASE, RuleStatus.ACTIVE, ApplyMode.AUTO_ENROLL,
            LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31), BenefitKind.CALENDAR, null, "S", scope, null, null);
    }

    @Test
    void 파생_조합은_품목마다_선물옵션_둘() {
        var combos = ComboUniverse.enumerate(products, List.of());
        var deriv = combos.stream().filter(c -> c.assetClass() == AssetClass.OVERSEAS_DERIV).toList();
        // ES,GC × {FUTURES,OPTIONS} = 4, exchange 는 품목 마스터의 CME
        assertThat(deriv).hasSize(4);
        assertThat(deriv).allSatisfy(c -> {
            assertThat(c.exchange()).isEqualTo("CME");
            assertThat(c.product()).isIn("ES", "GC");
        });
    }

    @Test
    void 주식형_조합은_기본_별표_거래소이고_룰이_한정하면_거래소가_늘어난다() {
        var krxRule = rule("R-KRX", new RuleScope(AssetClass.DOMESTIC_STOCK,
            Set.of("KRX"), null, null, null, Set.of(), null));
        var combos = ComboUniverse.enumerate(List.of(), List.of(krxRule));
        var ds = combos.stream().filter(c -> c.assetClass() == AssetClass.DOMESTIC_STOCK).toList();
        // DOMESTIC_STOCK 은 STOCK 하나 × 거래소 {*, KRX} = 2, 품목 없음
        assertThat(ds).hasSize(2);
        assertThat(ds).allSatisfy(c -> assertThat(c.product()).isNull());
        assertThat(ds).extracting(ComboUniverse.Combo::exchange).containsExactlyInAnyOrder("*", "KRX");
    }

    @Test
    void KRX한정_룰은_별표_조합과_타거래소_조합의_후보가_아니다() {
        var krxScope = new RuleScope(AssetClass.DOMESTIC_STOCK, Set.of("KRX"), null, null, null, Set.of(), null);
        var star = new ComboUniverse.Combo(AssetClass.DOMESTIC_STOCK, LookupKey.STOCK, "*", null);
        var krx  = new ComboUniverse.Combo(AssetClass.DOMESTIC_STOCK, LookupKey.STOCK, "KRX", null);
        var nxt  = new ComboUniverse.Combo(AssetClass.DOMESTIC_STOCK, LookupKey.STOCK, "NXT", null);
        assertThat(ComboUniverse.isCandidate(krxScope, star)).isFalse(); // '*' 키는 한정 룰 통과 못함
        assertThat(ComboUniverse.isCandidate(krxScope, krx)).isTrue();
        assertThat(ComboUniverse.isCandidate(krxScope, nxt)).isFalse();
    }

    @Test
    void 채널만_한정한_룰은_모든_조합의_후보다() {
        // 채널·세션은 색인 키 축이 아님 — 셀 단계(ScopeMatcher)가 처리
        var arsScope = new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), Set.of("ARS"));
        var star = new ComboUniverse.Combo(AssetClass.DOMESTIC_STOCK, LookupKey.STOCK, "*", null);
        assertThat(ComboUniverse.isCandidate(arsScope, star)).isTrue();
    }

    @Test
    void 파생_후보는_품목_스코프와_제외품목을_따른다() {
        var esOnly = new RuleScope(AssetClass.OVERSEAS_DERIV, null, null, null, Set.of("ES"), Set.of(), null);
        var exclGc = new RuleScope(AssetClass.OVERSEAS_DERIV, null, null, null, null, Set.of("GC"), null);
        var es = new ComboUniverse.Combo(AssetClass.OVERSEAS_DERIV, LookupKey.FUTURES, "CME", "ES");
        var gc = new ComboUniverse.Combo(AssetClass.OVERSEAS_DERIV, LookupKey.FUTURES, "CME", "GC");
        assertThat(ComboUniverse.isCandidate(esOnly, es)).isTrue();
        assertThat(ComboUniverse.isCandidate(esOnly, gc)).isFalse();
        assertThat(ComboUniverse.isCandidate(exclGc, gc)).isFalse();
        assertThat(ComboUniverse.isCandidate(exclGc, es)).isTrue();
    }
}
