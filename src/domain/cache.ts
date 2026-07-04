import type { FeeKey } from './types';
import { feeKeyString } from './feeKey';

export interface CacheEntry { scheduleId: string; sourceRuleId: string | null }
export interface CacheStat { hits: number; misses: number; size: number }

interface Slot { accountId: string; key: FeeKey; value: CacheEntry }

export class ResolveCache {
  private map = new Map<string, Slot>();
  private hits = 0;
  private misses = 0;

  private k(accountId: string, key: FeeKey): string { return `${accountId}|${feeKeyString(key)}`; }

  get(accountId: string, key: FeeKey): CacheEntry | null {
    const slot = this.map.get(this.k(accountId, key));
    if (slot) { this.hits++; return slot.value; }
    this.misses++; return null;
  }
  set(accountId: string, key: FeeKey, value: CacheEntry): void {
    this.map.set(this.k(accountId, key), { accountId, key, value });
  }
  invalidateAccount(accountId: string): number {
    let n = 0;
    for (const [mk, slot] of this.map) if (slot.accountId === accountId) { this.map.delete(mk); n++; }
    return n;
  }
  invalidateByScope(pred: (k: FeeKey) => boolean): number {
    let n = 0;
    for (const [mk, slot] of this.map) if (pred(slot.key)) { this.map.delete(mk); n++; }
    return n;
  }
  stat(): CacheStat { return { hits: this.hits, misses: this.misses, size: this.map.size }; }
  clear(): void { this.map.clear(); this.hits = 0; this.misses = 0; }
}
