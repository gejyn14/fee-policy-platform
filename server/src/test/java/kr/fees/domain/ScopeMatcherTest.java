package kr.fees.domain;

import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class ScopeMatcherTest {

    private FeeKey derivKey(LookupKey lk, String product) {
        return FeeKey.of(AssetClass.OVERSEAS_DERIV, "CME", lk, "*", "MTS", product);
    }

    @Test
    void 주식형_FeeKey는_품목코드를_줘도_product가_null() {
        FeeKey k = FeeKey.of(AssetClass.OVERSEAS_STOCK, "*", LookupKey.STOCK, "*", "MTS", "AAPL");
        assertThat(k.product()).isNull();
    }

    @Test
    void 파생_FeeKey는_품목코드를_유지() {
        FeeKey k = derivKey(LookupKey.FUTURES, "ES");
        assertThat(k.product()).isEqualTo("ES");
    }

    @Test
    void 조회구분_불일치면_매칭_실패() {
        RuleScope futuresOnly = new RuleScope(AssetClass.OVERSEAS_DERIV, null, null,
            Set.of(LookupKey.FUTURES), null, Set.of(), null);
        assertThat(ScopeMatcher.matches(futuresOnly, derivKey(LookupKey.FUTURES, "ES"))).isTrue();
        assertThat(ScopeMatcher.matches(futuresOnly, derivKey(LookupKey.OPTIONS, "ES"))).isFalse();
    }

    @Test
    void null_Set은_전체로_통과() {
        RuleScope all = new RuleScope(AssetClass.OVERSEAS_DERIV, null, null, null, null, Set.of(), null);
        assertThat(ScopeMatcher.matches(all, derivKey(LookupKey.FUTURES, "GC"))).isTrue();
    }

    @Test
    void 파생_품목_제약과_제외품목을_검사() {
        RuleScope esOnly = new RuleScope(AssetClass.OVERSEAS_DERIV, null, null, null,
            Set.of("ES"), Set.of(), null);
        assertThat(ScopeMatcher.matches(esOnly, derivKey(LookupKey.FUTURES, "ES"))).isTrue();
        assertThat(ScopeMatcher.matches(esOnly, derivKey(LookupKey.FUTURES, "GC"))).isFalse();

        RuleScope exceptGc = new RuleScope(AssetClass.OVERSEAS_DERIV, null, null, null,
            null, Set.of("GC"), null);
        assertThat(ScopeMatcher.matches(exceptGc, derivKey(LookupKey.FUTURES, "GC"))).isFalse();
        assertThat(ScopeMatcher.matches(exceptGc, derivKey(LookupKey.FUTURES, "ES"))).isTrue();
    }

    @Test
    void 자산군_불일치면_실패() {
        RuleScope stock = new RuleScope(AssetClass.OVERSEAS_STOCK, null, null, null, null, Set.of(), null);
        assertThat(ScopeMatcher.matches(stock, derivKey(LookupKey.FUTURES, "ES"))).isFalse();
    }

    @Test
    void 세션_채널_제약() {
        RuleScope mtsOnly = new RuleScope(AssetClass.OVERSEAS_DERIV, null, null, null, null, Set.of(),
            Set.of("MTS"));
        assertThat(ScopeMatcher.matches(mtsOnly, derivKey(LookupKey.FUTURES, "ES"))).isTrue();
        FeeKey htsKey = FeeKey.of(AssetClass.OVERSEAS_DERIV, "CME", LookupKey.FUTURES, "*", "HTS", "ES");
        assertThat(ScopeMatcher.matches(mtsOnly, htsKey)).isFalse();
    }

    @Test
    void 구체성은_제약_차원_수() {
        RuleScope none = new RuleScope(AssetClass.OVERSEAS_DERIV, null, null, null, null, Set.of(), null);
        RuleScope two = new RuleScope(AssetClass.OVERSEAS_DERIV, Set.of("CME"), null,
            Set.of(LookupKey.FUTURES), null, Set.of(), null);
        assertThat(none.specificity()).isZero();
        assertThat(two.specificity()).isEqualTo(2);
    }
}
