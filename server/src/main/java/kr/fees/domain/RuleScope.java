package kr.fees.domain;

import java.util.Set;

/**
 * 룰 적용범위. null Set = 전체(제약 없음). excludeProducts 는 항상 non-null(빈 Set 허용).
 * 파생만 products/excludeProducts 차원이 의미를 가진다.
 */
public record RuleScope(
    AssetClass assetClass,
    Set<String> exchanges,
    Set<String> sessions,
    Set<LookupKey> lookupKeys,
    Set<String> products,
    Set<String> excludeProducts,
    Set<String> channels
) {
    public RuleScope {
        if (excludeProducts == null) excludeProducts = Set.of();
    }

    /** 동률 tie-break용 구체성 = 제약 차원 수. 높을수록 더 좁게 겨냥. */
    public int specificity() {
        int n = 0;
        if (exchanges != null) n++;
        if (sessions != null) n++;
        if (lookupKeys != null) n++;
        if (channels != null) n++;
        if (products != null) n++;
        if (!excludeProducts.isEmpty()) n++;
        return n;
    }
}
