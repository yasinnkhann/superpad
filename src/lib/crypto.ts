import { VaultData, normalizeVaultData } from "@/types/vault";

// Magic 4-byte header identifying ZeroPad v2 (200,000 PBKDF2-SHA-256 rounds)
const MAGIC_V2 = new Uint8Array([0x5a, 0x50, 0x30, 0x32]); // "ZP02"
const PBKDF2_ITERATIONS_V2 = 200_000;
const PBKDF2_ITERATIONS_LEGACY = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function bytesToBase64(bytes: Uint8Array): string {
  // Chunk conversion to prevent call-stack overflow on large files (>100KB)
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...chunk));
  }
  return btoa(parts.join(""));
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hasMagicV2(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC_V2.length + SALT_BYTES + IV_BYTES + 16) {
    return false;
  }
  for (let i = 0; i < MAGIC_V2.length; i++) {
    if (bytes[i] !== MAGIC_V2[i]) return false;
  }
  return true;
}

async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const keyMaterial = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  // Copy into a plain ArrayBuffer-backed Uint8Array for strict BufferSource typing
  const saltBuffer = new Uint8Array(salt);
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts UTF-8 plaintext into a base64 AES-256-GCM envelope.
 * Format: MAGIC("ZP02", 4B) + SALT(16B) + IV(12B) + CIPHERTEXT_WITH_GCM_TAG
 */
export async function encryptText(plaintext: string, password: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS_V2);

  const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    new TextEncoder().encode(plaintext)
  );

  const cipherBytes = new Uint8Array(encryptedBuffer);
  const combined = new Uint8Array(
    MAGIC_V2.length + SALT_BYTES + IV_BYTES + cipherBytes.length
  );
  combined.set(MAGIC_V2, 0);
  combined.set(salt, MAGIC_V2.length);
  combined.set(iv, MAGIC_V2.length + SALT_BYTES);
  combined.set(cipherBytes, MAGIC_V2.length + SALT_BYTES + IV_BYTES);

  return bytesToBase64(combined);
}

/**
 * Decrypts a ZeroPad v2 envelope or legacy raw (salt + iv + ct, 100k rounds) payload.
 */
export async function decryptText(base64Payload: string, password: string): Promise<string> {
  const bytes = base64ToBytes(base64Payload);

  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  let iterations: number;

  if (hasMagicV2(bytes)) {
    const offset = MAGIC_V2.length;
    salt = bytes.slice(offset, offset + SALT_BYTES);
    iv = bytes.slice(offset + SALT_BYTES, offset + SALT_BYTES + IV_BYTES);
    ciphertext = bytes.slice(offset + SALT_BYTES + IV_BYTES);
    iterations = PBKDF2_ITERATIONS_V2;
  } else {
    if (bytes.length < SALT_BYTES + IV_BYTES + 16) {
      throw new Error("Invalid encrypted payload");
    }
    salt = bytes.slice(0, SALT_BYTES);
    iv = bytes.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
    ciphertext = bytes.slice(SALT_BYTES + IV_BYTES);
    iterations = PBKDF2_ITERATIONS_LEGACY;
  }

  const key = await deriveAesKey(password, salt, iterations);
  const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    new Uint8Array(ciphertext)
  );

  return new TextDecoder().decode(decryptedBuffer);
}

export async function encryptVault(vault: VaultData, password: string): Promise<string> {
  const payload: VaultData = {
    ...vault,
    version: 1,
    updatedAt: Date.now(),
  };
  return encryptText(JSON.stringify(payload), password);
}

export async function decryptVault(base64Payload: string, password: string): Promise<VaultData> {
  const plaintext = await decryptText(base64Payload, password);
  try {
    const parsed = JSON.parse(plaintext);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.tabs)) {
      return normalizeVaultData(parsed);
    }
  } catch {
    // Plain-text legacy note (e.g., imported from private-notepad)
  }
  return normalizeVaultData(plaintext);
}

// Versioned browser session cache (per room)
const SESSION_PREFIX = "zeropad:v1:session:";
const SETTINGS_KEY = "zeropad:v1:settings";
const RECENT_ROOMS_KEY = "zeropad:v1:recent_rooms";

interface StoredSession {
  password: string;
  expiresAt: number;
}

export function getSavedRoomPassword(room: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${SESSION_PREFIX}${room}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.password || typeof parsed.expiresAt !== "number") {
      window.localStorage.removeItem(`${SESSION_PREFIX}${room}`);
      return null;
    }
    if (Date.now() > parsed.expiresAt) {
      window.localStorage.removeItem(`${SESSION_PREFIX}${room}`);
      return null;
    }
    return parsed.password;
  } catch {
    return null;
  }
}

export function saveRoomPassword(room: string, password: string, ttlMinutes: number): void {
  if (typeof window === "undefined") return;
  try {
    if (ttlMinutes <= 0) {
      window.localStorage.removeItem(`${SESSION_PREFIX}${room}`);
      return;
    }
    const payload: StoredSession = {
      password,
      expiresAt: Date.now() + ttlMinutes * 60 * 1000,
    };
    window.localStorage.setItem(`${SESSION_PREFIX}${room}`, JSON.stringify(payload));
  } catch {
    // Ignore quota / privacy mode errors
  }
}

export function clearRoomPassword(room: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${SESSION_PREFIX}${room}`);
  } catch {
    // Ignore storage errors
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
    // Ignore storage errors
  }
}

export function getRecentRooms(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_ROOMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

export function recordRecentRoom(room: string): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getRecentRooms().filter((r) => r !== room);
    const updated = [room, ...existing].slice(0, 8);
    window.localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}

export function removeRecentRoom(room: string): void {
  if (typeof window === "undefined") return;
  try {
    const updated = getRecentRooms().filter((r) => r !== room);
    window.localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}
