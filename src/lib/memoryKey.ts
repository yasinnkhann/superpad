// Module-level in-memory encryption key store so SPA navigation from `/` -> `/workspace`
// stays unlocked even when the user sets localStorage cache TTL to "Never".

interface MemoryKeySlot {
  userId: string;
  key: CryptoKey;
  serializedKey: string;
}

let slot: MemoryKeySlot | null = null;

export function setInMemoryKey(userId: string, key: CryptoKey, serializedKey: string): void {
  slot = { userId, key, serializedKey };
}

export function getInMemoryKey(userId: string): { key: CryptoKey; serializedKey: string } | null {
  if (!slot || slot.userId !== userId) return null;
  return { key: slot.key, serializedKey: slot.serializedKey };
}

export function clearInMemoryKey(): void {
  slot = null;
}
