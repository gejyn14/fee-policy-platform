import type { AssetClass, Channel, FeeKey, Product, Session } from './types';

export function isDerivative(a: AssetClass): boolean { return a === '국내파생' || a === '해외파생'; }

// feeKey를 차원 값에서 직접 조립한다. 주식형(파생 아님)은 품목 차원이 붕괴되므로 productCode를
// 넘겨도 product는 null이 된다 — 화면이 종목을 고르지 않고 거래소·세션·채널만으로 해석할 수 있게.
export function buildFeeKey(
  assetClass: AssetClass, exchange: string, session: Session, channel: Channel, productCode?: string | null,
): FeeKey {
  return {
    assetClass, exchange, session, channel,
    product: isDerivative(assetClass) ? (productCode ?? null) : null,
  };
}

export function deriveFeeKey(product: Product, session: Session, channel: Channel): FeeKey {
  return buildFeeKey(product.assetClass, product.exchange, session, channel, product.code);
}

export function feeKeyString(k: FeeKey): string {
  const base = `${k.assetClass}|${k.exchange}|${k.session}|${k.channel}`;
  return k.product ? `${base}|${k.product}` : base;
}
