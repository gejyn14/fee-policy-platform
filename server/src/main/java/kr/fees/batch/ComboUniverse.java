package kr.fees.batch;

import kr.fees.domain.*;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 색인 조합(자산군·조회구분·거래소·품목) 열거 — CellUniverse 의 계좌 무관 부분 (§10.4).
 * 파생 = 품목 마스터 × {선물, 옵션} (거래소는 품목의 것).
 * 주식형 = 조회구분 × 거래소 {'*' ∪ 활성 룰이 한정한 거래소들}, 품목 없음.
 * 채널·세션은 색인 키 축이 아니다 — 셀 단계(ScopeMatcher)가 처리한다.
 */
public final class ComboUniverse {

    private static final String ALL = "*";

    private ComboUniverse() {}

    public record Combo(AssetClass assetClass, LookupKey lookupKey, String exchange, String product) {}

    public static List<Combo> enumerate(List<ProductModel> products, List<RuleModel> activeRules) {
        LinkedHashSet<Combo> out = new LinkedHashSet<>();
        for (AssetClass ac : AssetClass.values()) {
            if (ac.isDerivative()) {
                for (ProductModel p : products) {
                    if (p.assetClass() != ac) continue;
                    for (LookupKey lk : List.of(LookupKey.FUTURES, LookupKey.OPTIONS)) {
                        out.add(new Combo(ac, lk, p.exchange(), p.code()));
                    }
                }
            } else {
                Set<String> exchanges = new LinkedHashSet<>(List.of(ALL));
                for (RuleModel r : activeRules) {
                    if (r.scope().assetClass() == ac && r.scope().exchanges() != null) {
                        exchanges.addAll(r.scope().exchanges());
                    }
                }
                for (LookupKey lk : CellUniverse.stockLookupKeys(ac)) {
                    for (String ex : exchanges) {
                        out.add(new Combo(ac, lk, ex, null));
                    }
                }
            }
        }
        return new ArrayList<>(out);
    }

    /** 조합 계열 후보 판정 — CellUniverse.matchesFamily 와 동일 의미론 + 주식형 거래소 축. */
    public static boolean isCandidate(RuleScope s, Combo c) {
        if (s.assetClass() != c.assetClass()) return false;
        if (s.lookupKeys() != null && !s.lookupKeys().contains(c.lookupKey())) return false;
        if (s.exchanges() != null) {
            // '*' 조합은 한정 룰을 통과시키지 않는다 (ScopeMatcher 와 동일 원칙)
            if (ALL.equals(c.exchange()) || !s.exchanges().contains(c.exchange())) return false;
        }
        if (c.product() != null) { // 파생만 품목 차원
            if (s.products() != null && !s.products().contains(c.product())) return false;
            if (s.excludeProducts().contains(c.product())) return false;
        }
        return true;
    }
}
