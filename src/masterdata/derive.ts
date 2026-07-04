import type { Product } from '../domain/types';
import type { Instrument } from './instruments';

export function deriveProducts(instruments: Instrument[]): Product[] {
  const out: Product[] = [];
  for (const i of instruments) {
    if (i.status === '상장폐지') continue;
    const p: Product = { assetClass: i.assetClass, exchange: i.exchange, code: i.code,
      name: i.name, currency: i.currency, sessions: i.sessions };
    out.push(p);
    if (i.assetClass === '국내주식' && i.nxtTradable) out.push({ ...p, exchange: 'NXT' });
  }
  return out;
}
