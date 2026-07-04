import type { AssetClass, Channel, FeeKey, Product, Session } from './types';

export function isDerivative(a: AssetClass): boolean { return a === '국내파생' || a === '해외파생'; }

export function deriveFeeKey(product: Product, session: Session, channel: Channel): FeeKey {
  return {
    assetClass: product.assetClass, exchange: product.exchange, session, channel,
    product: isDerivative(product.assetClass) ? product.code : null,
  };
}

export function feeKeyString(k: FeeKey): string {
  const base = `${k.assetClass}|${k.exchange}|${k.session}|${k.channel}`;
  return k.product ? `${base}|${k.product}` : base;
}
