package kr.fees.domain;

/**
 * 룰 적용범위 × 조회키 매칭. null Set(전체)은 통과. '*' 값은 구체 매칭 대상이 아니므로
 * 해당 차원 제약이 있으면 '*' 키는 통과시키지 않는다(구체 룰은 구체 키에만).
 * 파생만 품목(products/excludeProducts) 차원을 검사한다.
 */
public final class ScopeMatcher {

    private ScopeMatcher() {}

    public static boolean matches(RuleScope s, FeeKey k) {
        if (s.assetClass() != k.assetClass()) return false;
        if (s.lookupKeys() != null && !s.lookupKeys().contains(k.lookupKey())) return false;
        if (s.exchanges() != null && !s.exchanges().contains(k.exchange())) return false;
        if (s.sessions() != null && !s.sessions().contains(k.session())) return false;
        if (s.channels() != null && !s.channels().contains(k.channel())) return false;
        if (k.product() != null) { // 파생만 품목 차원
            if (s.products() != null && !s.products().contains(k.product())) return false;
            if (s.excludeProducts().contains(k.product())) return false;
        }
        return true;
    }
}
