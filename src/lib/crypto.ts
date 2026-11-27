import {
  EncryptedNoteDTO,
  NoteMetadata,
  NoteRecord,
  normalizeNoteMetadata,
} from "@/types/vault";

// Split-key PBKDF2 derivation:
// 200,000 PBKDF2-SHA-256 rounds → 512 bits (64 bytes):
//   bytes [0..31]  -> authKey (sent to server for login verification only)
//   bytes [32..63] -> encryptionKey (AES-256-GCM key, NEVER sent to server)
const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...chunk));
  }
  return btoa(parts.join(""));
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function generateSaltBase64(): string {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return bytesToBase64(salt);
}

export interface DerivedUserKeys {
  authKey: string;
  encryptionKey: CryptoKey;
  serializedKey: string;
}

/**
 * Derives two cryptographically independent 256-bit keys from (password, kdfSalt).
 * Even if the server's authKey database is completely compromised, encryptionKey
 * cannot be derived from authKey.
 */
export async function deriveUserKeys(
  password: string,
  kdfSaltBase64: string
): Promise<DerivedUserKeys> {
  const subtle = globalThis.crypto.subtle;
  const saltBytes = new Uint8Array(base64ToBytes(kdfSaltBase64));

  const keyMaterial = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    512
  );

  const allBytes = new Uint8Array(derivedBits);
  const authBytes = allBytes.slice(0, 32);
  const encBytes = allBytes.slice(32, 64);

  const encryptionKey = await subtle.importKey(
    "raw",
    new Uint8Array(encBytes),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  return {
    authKey: bytesToBase64(authBytes),
    encryptionKey,
    serializedKey: bytesToBase64(encBytes),
  };
}

export async function importRawEncryptionKey(serializedKey: string): Promise<CryptoKey> {
  const rawBytes = new Uint8Array(base64ToBytes(serializedKey));
  if (rawBytes.length !== 32) {
    throw new Error("Invalid cached encryption key length");
  }
  return globalThis.crypto.subtle.importKey(
    "raw",
    rawBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Fast AES-256-GCM encryption using an already-derived CryptoKey.
 * Format: IV(12B) + CIPHERTEXT_WITH_GCM_TAG, base64 encoded.
 */
export async function encryptWithKey(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encryptedBuf = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    new TextEncoder().encode(plaintext)
  );
  const ctBytes = new Uint8Array(encryptedBuf);
  const combined = new Uint8Array(IV_BYTES + ctBytes.length);
  combined.set(iv, 0);
  combined.set(ctBytes, IV_BYTES);
  return bytesToBase64(combined);
}

export async function decryptWithKey(base64Payload: string, key: CryptoKey): Promise<string> {
  const bytes = base64ToBytes(base64Payload);
  if (bytes.length < IV_BYTES + 16) {
    throw new Error("Corrupted ciphertext");
  }
  const iv = bytes.slice(0, IV_BYTES);
  const ct = bytes.slice(IV_BYTES);
  const decryptedBuf = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    new Uint8Array(ct)
  );
  return new TextDecoder().decode(decryptedBuf);
}

export async function encryptNotePayload(
  meta: NoteMetadata,
  content: string,
  key: CryptoKey
): Promise<{ encryptedMeta: string; encryptedContent: string; sizeBytes: number }> {
  const [encryptedMeta, encryptedContent] = await Promise.all([
    encryptWithKey(JSON.stringify(meta), key),
    encryptWithKey(content, key),
  ]);
  const sizeBytes = new TextEncoder().encode(content).length;
  return { encryptedMeta, encryptedContent, sizeBytes };
}

export async function decryptNoteDTO(
  dto: EncryptedNoteDTO,
  key: CryptoKey
): Promise<NoteRecord> {
  const [metaJson, content] = await Promise.all([
    decryptWithKey(dto.encryptedMeta, key),
    decryptWithKey(dto.encryptedContent, key),
  ]);
  let parsedMeta: unknown = null;
  try {
    parsedMeta = JSON.parse(metaJson);
  } catch {
    parsedMeta = null;
  }
  const meta = normalizeNoteMetadata(parsedMeta);
  return {
    id: dto.id,
    ...meta,
    content,
    version: dto.version,
    sizeBytes: dto.sizeBytes,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    deletedAt: dto.deletedAt ?? null,
  };
}

// ==========================================
// Versioned Local Key Cache & UI Settings
// ==========================================

const KEY_CACHE_PREFIX = "superpad:v2:key:";
const SETTINGS_KEY = "superpad:v2:settings";

interface CachedKeyPayload {
  serializedKey: string;
  expiresAt: number;
}

export async function getCachedUserKey(userId: string): Promise<{
  key: CryptoKey;
  serializedKey: string;
} | null> {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${KEY_CACHE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedKeyPayload;
    if (!parsed.serializedKey || typeof parsed.expiresAt !== "number") {
      window.localStorage.removeItem(`${KEY_CACHE_PREFIX}${userId}`);
      return null;
    }
    if (Date.now() > parsed.expiresAt) {
      window.localStorage.removeItem(`${KEY_CACHE_PREFIX}${userId}`);
      return null;
    }
    const key = await importRawEncryptionKey(parsed.serializedKey);
    return { key, serializedKey: parsed.serializedKey };
  } catch {
    return null;
  }
}

export function saveCachedUserKey(
  userId: string,
  serializedKey: string,
  ttlMinutes: number
): void {
  if (typeof window === "undefined") return;
  try {
    if (ttlMinutes <= 0) {
      window.localStorage.removeItem(`${KEY_CACHE_PREFIX}${userId}`);
      return;
    }
    const payload: CachedKeyPayload = {
      serializedKey,
      expiresAt: Date.now() + ttlMinutes * 60 * 1000,
    };
    window.localStorage.setItem(`${KEY_CACHE_PREFIX}${userId}`, JSON.stringify(payload));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function clearCachedUserKey(userId?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (userId) {
      window.localStorage.removeItem(`${KEY_CACHE_PREFIX}${userId}`);
      return;
    }
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(KEY_CACHE_PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // Ignore
  }
}

export function getStoredSettings<T>(fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export function saveStoredSettings<T>(settings: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore
  }
}
