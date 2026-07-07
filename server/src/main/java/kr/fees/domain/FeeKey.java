package kr.fees.domain;

/**
 * 조회키 — 배정판/랭킹이 다루는 셀 좌표. 파생만 product 차원을 가지며,
 * 주식형은 of() 팩토리에서 product 를 null 로 강제한다(v0.5 불변식: 주식은 종목 차원 없음).
 * exchange/session/channel 은 '*'(전체) 허용, product 는 파생일 때 품목코드 또는 '*'.
 */
public record FeeKey(
    AssetClass assetClass,
    String exchange,
    LookupKey lookupKey,
    String session,
    String channel,
    String product
) {
    public static FeeKey of(AssetClass assetClass, String exchange, LookupKey lookupKey,
                            String session, String channel, String productCode) {
        String product = assetClass.isDerivative() ? productCode : null;
        return new FeeKey(assetClass, exchange, lookupKey, session, channel, product);
    }
}
