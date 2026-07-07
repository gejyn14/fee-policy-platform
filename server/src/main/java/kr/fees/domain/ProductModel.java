package kr.fees.domain;

import java.util.List;

public record ProductModel(
    AssetClass assetClass,
    String exchange,
    String code,
    String name,
    String currency,
    List<String> sessions
) {}
