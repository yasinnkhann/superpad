import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { del, get, list, put } from "@vercel/blob";
import type { RevisionSummary } from "@/types/vault";

const MAX_REVISIONS = 10;
const MAX_PAYLOAD_BYTES = 15 * 1024 * 1024; // 15 MB ciphertext cap
const ROOM_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const REVISION_ID_REGEX = /^\d{10,16}$/;

export interface VaultReadResult {
  exists: boolean;
  ciphertext: string;
  updatedAt: number | null;
  size: number;
  backend: "vercel-blob" | "local-fs";
}

export interface VaultWriteResult {
  updatedAt: number;
  size: number;
  revisionId: string;
  backend: "vercel-blob" | "local-fs";
}

export function validateRoomSlug(room: string): string {
  const normalized = room.trim().toLowerCase();
  if (!ROOM_REGEX.test(normalized)) {
    throw new Error(
      "Invalid room name. Use 1-64 letters, numbers, hyphens, or underscores."
    );
  }
  return normalized;
}

export function validateRevisionId(id: string): string {
  if (!REVISION_ID_REGEX.test(id)) {
    throw new Error("Invalid revision ID");
  }
  return id;
}

export function validateCiphertext(ciphertext: unknown): string {
  if (typeof ciphertext !== "string" || ciphertext.length < 32) {
    throw new Error("Invalid encrypted payload");
  }
  if (Buffer.byteLength(ciphertext, "utf-8") > MAX_PAYLOAD_BYTES) {
    throw new Error("Encrypted payload exceeds 15 MB limit");
  }
  // Strict base64 check
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) {
    throw new Error("Payload must be valid base64 ciphertext");
  }
  return ciphertext;
}

/**
 * Hashes the room slug with SHA-256 so even inspecting raw Blob paths
 * never reveals human-readable room names.
 */
function hashRoom(room: string): string {
  return crypto.createHash("sha256").update(`zeropad:room:${room}`).digest("hex");
}

function getBlobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.ZEROPAD_BLOB_READ_WRITE_TOKEN;
}

function getBlobAccess(): "public" | "private" {
  return process.env.BLOB_ACCESS === "private" ? "private" : "public";
}

function getLocalDataRoot(): string {
  return process.env.ZEROPAD_LOCAL_DATA_DIR || path.join(process.cwd(), ".zeropad-data");
}

async function readStreamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

// ==========================================
// Vercel Blob Backend
// ==========================================

async function readFromBlob(roomHash: string): Promise<VaultReadResult> {
  const token = getBlobToken();
  const access = getBlobAccess();
  const pathname = `vaults/${roomHash}/current.enc`;

  const res = await get(pathname, { access, token, useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) {
    return {
      exists: false,
      ciphertext: "",
      updatedAt: null,
      size: 0,
      backend: "vercel-blob",
    };
  }

  const ciphertext = await readStreamToString(res.stream);
  return {
    exists: true,
    ciphertext,
    updatedAt: res.blob.uploadedAt ? new Date(res.blob.uploadedAt).getTime() : Date.now(),
    size: res.blob.size ?? Buffer.byteLength(ciphertext, "utf-8"),
    backend: "vercel-blob",
  };
}

async function writeToBlob(roomHash: string, ciphertext: string): Promise<VaultWriteResult> {
  const token = getBlobToken();
  const access = getBlobAccess();
  const now = Date.now();
  const revisionId = String(now);

  const currentPath = `vaults/${roomHash}/current.enc`;
  const historyPath = `vaults/${roomHash}/history/${revisionId}.enc`;

  await Promise.all([
    put(currentPath, ciphertext, {
      access,
      token,
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "text/plain",
      cacheControlMaxAge: 0,
    }),
    put(historyPath, ciphertext, {
      access,
      token,
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "text/plain",
      cacheControlMaxAge: 0,
    }),
  ]);

  // Prune revisions beyond MAX_REVISIONS
  const { blobs } = await list({
    prefix: `vaults/${roomHash}/history/`,
    token,
  });
  if (blobs.length > MAX_REVISIONS) {
    const sorted = [...blobs].sort((a, b) => b.pathname.localeCompare(a.pathname));
    const toDelete = sorted.slice(MAX_REVISIONS).map((b) => b.url);
    if (toDelete.length > 0) {
      await del(toDelete, { token });
    }
  }

  return {
    updatedAt: now,
    size: Buffer.byteLength(ciphertext, "utf-8"),
    revisionId,
    backend: "vercel-blob",
  };
}

async function listBlobHistory(roomHash: string): Promise<RevisionSummary[]> {
  const token = getBlobToken();
  const prefix = `vaults/${roomHash}/history/`;
  const { blobs } = await list({ prefix, token });

  return blobs
    .map((blob) => {
      const filename = blob.pathname.slice(prefix.length);
      const id = filename.replace(/\.enc$/, "");
      const timestamp = Number(id) || new Date(blob.uploadedAt).getTime();
      return {
        id,
        timestamp,
        size: blob.size,
      };
    })
    .filter((item) => REVISION_ID_REGEX.test(item.id))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_REVISIONS);
}

async function readBlobRevision(
  roomHash: string,
  revisionId: string
): Promise<{ exists: boolean; ciphertext: string; timestamp: number }> {
  const token = getBlobToken();
  const access = getBlobAccess();
  const pathname = `vaults/${roomHash}/history/${revisionId}.enc`;
  const res = await get(pathname, { access, token, useCache: false });

  if (!res || res.statusCode !== 200 || !res.stream) {
    return { exists: false, ciphertext: "", timestamp: Number(revisionId) };
  }
  const ciphertext = await readStreamToString(res.stream);
  return { exists: true, ciphertext, timestamp: Number(revisionId) };
}

async function deleteBlobRoom(roomHash: string): Promise<void> {
  const token = getBlobToken();
  const { blobs } = await list({ prefix: `vaults/${roomHash}/`, token });
  if (blobs.length > 0) {
    await del(
      blobs.map((b) => b.url),
      { token }
    );
  }
}

// ==========================================
// Local Filesystem Backend (Local Dev / Self-Host)
// ==========================================

function getLocalRoomDir(roomHash: string): string {
  return path.join(getLocalDataRoot(), "vaults", roomHash);
}

async function readFromLocal(roomHash: string): Promise<VaultReadResult> {
  const filePath = path.join(getLocalRoomDir(roomHash), "current.enc");
  try {
    const [ciphertext, stat] = await Promise.all([
      fs.readFile(filePath, "utf-8"),
      fs.stat(filePath),
    ]);
    return {
      exists: true,
      ciphertext,
      updatedAt: Math.round(stat.mtimeMs),
      size: stat.size,
      backend: "local-fs",
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {
        exists: false,
        ciphertext: "",
        updatedAt: null,
        size: 0,
        backend: "local-fs",
      };
    }
    throw err;
  }
}

async function writeToLocal(roomHash: string, ciphertext: string): Promise<VaultWriteResult> {
  const roomDir = getLocalRoomDir(roomHash);
  const historyDir = path.join(roomDir, "history");
  await fs.mkdir(historyDir, { recursive: true });

  const now = Date.now();
  const revisionId = String(now);
  const currentPath = path.join(roomDir, "current.enc");
  const historyPath = path.join(historyDir, `${revisionId}.enc`);

  await Promise.all([
    fs.writeFile(currentPath, ciphertext, "utf-8"),
    fs.writeFile(historyPath, ciphertext, "utf-8"),
  ]);

  // Prune old revisions beyond MAX_REVISIONS
  const files = (await fs.readdir(historyDir))
    .filter((f) => f.endsWith(".enc"))
    .sort((a, b) => b.localeCompare(a));

  if (files.length > MAX_REVISIONS) {
    await Promise.all(
      files.slice(MAX_REVISIONS).map((f) => fs.rm(path.join(historyDir, f), { force: true }))
    );
  }

  return {
    updatedAt: now,
    size: Buffer.byteLength(ciphertext, "utf-8"),
    revisionId,
    backend: "local-fs",
  };
}

async function listLocalHistory(roomHash: string): Promise<RevisionSummary[]> {
  const historyDir = path.join(getLocalRoomDir(roomHash), "history");
  try {
    const files = await fs.readdir(historyDir);
    const summaries = await Promise.all(
      files
        .filter((f) => f.endsWith(".enc"))
        .map(async (f) => {
          const id = f.replace(/\.enc$/, "");
          const stat = await fs.stat(path.join(historyDir, f));
          return {
            id,
            timestamp: Number(id) || Math.round(stat.mtimeMs),
            size: stat.size,
          };
        })
    );
    return summaries
      .filter((s) => REVISION_ID_REGEX.test(s.id))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_REVISIONS);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
}

async function readLocalRevision(
  roomHash: string,
  revisionId: string
): Promise<{ exists: boolean; ciphertext: string; timestamp: number }> {
  const filePath = path.join(getLocalRoomDir(roomHash), "history", `${revisionId}.enc`);
  try {
    const ciphertext = await fs.readFile(filePath, "utf-8");
    return { exists: true, ciphertext, timestamp: Number(revisionId) };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { exists: false, ciphertext: "", timestamp: Number(revisionId) };
    }
    throw err;
  }
}

async function deleteLocalRoom(roomHash: string): Promise<void> {
  await fs.rm(getLocalRoomDir(roomHash), { recursive: true, force: true });
}

// ==========================================
// Public Storage API
// ==========================================

export function getActiveBackend(): "vercel-blob" | "local-fs" {
  return getBlobToken() ? "vercel-blob" : "local-fs";
}

export async function readVault(room: string): Promise<VaultReadResult> {
  const validRoom = validateRoomSlug(room);
  const roomHash = hashRoom(validRoom);
  return getBlobToken() ? readFromBlob(roomHash) : readFromLocal(roomHash);
}

export async function writeVault(room: string, ciphertext: string): Promise<VaultWriteResult> {
  const validRoom = validateRoomSlug(room);
  const validPayload = validateCiphertext(ciphertext);
  const roomHash = hashRoom(validRoom);
  return getBlobToken()
    ? writeToBlob(roomHash, validPayload)
    : writeToLocal(roomHash, validPayload);
}

export async function listVaultHistory(room: string): Promise<RevisionSummary[]> {
  const validRoom = validateRoomSlug(room);
  const roomHash = hashRoom(validRoom);
  return getBlobToken() ? listBlobHistory(roomHash) : listLocalHistory(roomHash);
}

export async function readVaultRevision(
  room: string,
  revisionId: string
): Promise<{ exists: boolean; ciphertext: string; timestamp: number }> {
  const validRoom = validateRoomSlug(room);
  const validId = validateRevisionId(revisionId);
  const roomHash = hashRoom(validRoom);
  return getBlobToken()
    ? readBlobRevision(roomHash, validId)
    : readLocalRevision(roomHash, validId);
}

export async function deleteVault(room: string): Promise<void> {
  const validRoom = validateRoomSlug(room);
  const roomHash = hashRoom(validRoom);
  return getBlobToken() ? deleteBlobRoom(roomHash) : deleteLocalRoom(roomHash);
}
