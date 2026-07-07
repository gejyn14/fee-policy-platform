package kr.fees.batch;

import kr.fees.domain.*;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 계좌의 셀 유니버스 전개 (기술설계서 v1.5 §10.1 ②).
 *   파생 = 상품군 × 거래소 × 품목 × {FUTURES, OPTIONS}
 *   주식형 = {STOCK, ETF}(해외) / {STOCK}(국내) / {GOLD}(금), 품목 '*'·거래소 '*'
 * 세션·채널은 기본 '*'. 세션/채널 한정 룰이 그 셀 계열에 매칭될 때만 해당 구체 셀을 추가한다.
 * 계좌가 개설한 상품군(openedGroups)만 전개 — pruning.
 */
public final class CellUniverse {

    private static final String ALL = "*";

    private CellUniverse() {}

    public static List<FeeKey> cellsFor(String accountId, Set<AssetClass> openedGroups,
                                        List<ProductModel> products, List<RuleModel> activeRules) {
        Set<FeeKey> cells = new LinkedHashSet<>();
        for (AssetClass ac : openedGroups) {
            for (FeeKey base : baseCells(ac, products)) {
                cells.add(base);
                for (String ch : channelsWanted(base, activeRules)) {
                    cells.add(new FeeKey(base.assetClass(), base.exchange(), base.lookupKey(), base.session(), ch, base.product()));
                }
                for (String se : sessionsWanted(base, activeRules)) {
                    cells.add(new FeeKey(base.assetClass(), base.exchange(), base.lookupKey(), se, base.channel(), base.product()));
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

    private static Set<String> channelsWanted(FeeKey cell, List<RuleModel> rules) {
        Set<String> out = new LinkedHashSet<>();
        for (RuleModel r : rules) {
            if (r.scope().channels() != null && matchesFamily(r.scope(), cell)) {
                out.addAll(r.scope().channels());
            }
        }
        return out;
    }

    private static Set<String> sessionsWanted(FeeKey cell, List<RuleModel> rules) {
        Set<String> out = new LinkedHashSet<>();
        for (RuleModel r : rules) {
            if (r.scope().sessions() != null && matchesFamily(r.scope(), cell)) {
                out.addAll(r.scope().sessions());
            }
        }
        return out;
    }

    /** 세션·채널을 무시한 셀 계열 매칭(자산군·조회구분·거래소·품목). */
    private static boolean matchesFamily(RuleScope s, FeeKey k) {
        if (s.assetClass() != k.assetClass()) return false;
        if (s.lookupKeys() != null && !s.lookupKeys().contains(k.lookupKey())) return false;
        if (s.exchanges() != null && !s.exchanges().contains(k.exchange())) return false;
        if (k.product() != null) {
            if (s.products() != null && !s.products().contains(k.product())) return false;
            if (s.excludeProducts().contains(k.product())) return false;
        }
        return true;
    }
}
