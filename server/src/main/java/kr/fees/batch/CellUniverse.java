package kr.fees.batch;

import kr.fees.domain.*;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 계좌의 셀 유니버스 전개 (기술설계서 v1.5 §10.1 ②).
 *   파생 = 상품군 × 거래소 × 품목 × {FUTURES, OPTIONS}
 *   주식형 = {STOCK, ETF}(해외) / {STOCK}(국내) / {GOLD}(금), 품목 '*'·거래소 기본 '*'
 * 세션·채널(주식형은 거래소도)은 기본 '*' 한 칸으로 압축하되, 그 축을 한정하는 활성 룰이
 * 셀 계열에 매칭되면 한정 값들을 모아 '*'와의 데카르트 곱으로 전개한다.
 * 곱집합이어야 서로 다른 축을 한정한 룰 둘이 겹치는 교차 셀(예: 야간×MTS)에도
 * 완결된 승자가 실린다 — 축별 독립 전개는 대각선 체결에서 고객 유리 원칙을 깬다.
 * 계좌가 개설한 상품군(openedGroups)만 전개 — pruning.
 */
public final class CellUniverse {

    private static final String ALL = "*";

    private CellUniverse() {}

    public static List<FeeKey> cellsFor(String accountId, Set<AssetClass> openedGroups,
                                        List<ProductModel> products, List<RuleModel> activeRules) {
        Set<FeeKey> cells = new LinkedHashSet<>();
        for (AssetClass ac : openedGroups) {
            boolean deriv = ac.isDerivative();
            for (FeeKey base : baseCells(ac, products)) {
                Set<String> exchanges = new LinkedHashSet<>(List.of(base.exchange()));
                Set<String> sessions = new LinkedHashSet<>(List.of(ALL));
                Set<String> channels = new LinkedHashSet<>(List.of(ALL));
                for (RuleModel r : activeRules) {
                    RuleScope s = r.scope();
                    if (!matchesFamily(s, base, deriv)) continue;
                    if (!deriv && s.exchanges() != null) exchanges.addAll(s.exchanges());
                    if (s.sessions() != null) sessions.addAll(s.sessions());
                    if (s.channels() != null) channels.addAll(s.channels());
                }
                for (String ex : exchanges) {
                    for (String se : sessions) {
                        for (String ch : channels) {
                            cells.add(new FeeKey(ac, ex, base.lookupKey(), se, ch, base.product()));
                        }
                    }
                }
            }
        }
        return new ArrayList<>(cells);
    }

    private static List<FeeKey> baseCells(AssetClass ac, List<ProductModel> products) {
        List<FeeKey> cells = new ArrayList<>();
        if (ac.isDerivative()) {
            for (ProductModel p : products) {
                if (p.assetClass() != ac) continue;
                for (LookupKey lk : List.of(LookupKey.FUTURES, LookupKey.OPTIONS)) {
                    cells.add(FeeKey.of(ac, p.exchange(), lk, ALL, ALL, p.code()));
                }
            }
        } else {
            for (LookupKey lk : stockLookupKeys(ac)) {
                cells.add(FeeKey.of(ac, ALL, lk, ALL, ALL, null));
            }
        }
        return cells;
    }

    private static List<LookupKey> stockLookupKeys(AssetClass ac) {
        return switch (ac) {
            case OVERSEAS_STOCK -> List.of(LookupKey.STOCK, LookupKey.ETF);
            case DOMESTIC_STOCK -> List.of(LookupKey.STOCK);
            case GOLD_SPOT -> List.of(LookupKey.GOLD);
            default -> List.of();
        };
    }

    /**
     * 전개 축을 무시한 셀 계열 매칭 — 자산군·조회구분·품목(파생). 거래소는 파생만 계열에
     * 포함(품목 마스터 기준 구체값), 주식형은 전개 축이라 여기서 검사하지 않는다.
     */
    private static boolean matchesFamily(RuleScope s, FeeKey k, boolean deriv) {
        if (s.assetClass() != k.assetClass()) return false;
        if (s.lookupKeys() != null && !s.lookupKeys().contains(k.lookupKey())) return false;
        if (deriv && s.exchanges() != null && !s.exchanges().contains(k.exchange())) return false;
        if (k.product() != null) { // 파생만 품목 차원
            if (s.products() != null && !s.products().contains(k.product())) return false;
            if (s.excludeProducts().contains(k.product())) return false;
        }
        return true;
    }
}
