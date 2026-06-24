import type { EmailValidationCache } from "./types.js";

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

export class MemoryValidationCache implements EmailValidationCache {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #maxEntries: number;

  constructor(maxEntries = 256) {
    this.#maxEntries = maxEntries;
  }

  get<T>(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs = 300_000): void {
    if (this.#entries.has(key)) {
      this.#entries.delete(key);
    }
    this.#entries.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#entries.delete(oldest);
    }
  }
}
