package kr.fees.domain;

public enum AssetClass {
    DOMESTIC_STOCK, OVERSEAS_STOCK, DOMESTIC_DERIV, OVERSEAS_DERIV, GOLD_SPOT;

    public boolean isDerivative() {
        return this == DOMESTIC_DERIV || this == OVERSEAS_DERIV;
    }
}
