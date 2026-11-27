import {
  decryptWithKey,
  deriveUserKeys,
  encryptWithKey,
  generateSaltBase64,
} from "@/lib/crypto";
import {
  NoteMetadata,
  NoteRecord,
  extractNoteMetadata,
  normalizeNoteMetadata,
} from "@/types/vault";

export interface BackupNoteEntry extends NoteMetadata {
  content: string;
}

export interface PlaintextBackupPayload {
  format: "superpad-backup";
  version: 1;
  exportedAt: string;
  folders: string[];
  notes: BackupNoteEntry[];
}

export interface EncryptedBackupPayload {
  format: "superpad-encrypted-backup";
  version: 1;
  exportedAt: string;
  salt: string;
  ciphertext: string;
}

export type BackupInspection =
  | { kind: "encrypted"; exportedAt?: string; payload: EncryptedBackupPayload }
  | { kind: "plaintext"; exportedAt?: string; notes: BackupNoteEntry[]; folders: string[] }
  | { kind: "invalid"; error: string };

function buildPlaintextPayload(
  notes: NoteRecord[],
  extraFolders: string[]
): PlaintextBackupPayload {
  const entries: BackupNoteEntry[] = notes.map((n) => ({
    ...extractNoteMetadata(n),
    content: n.content,
  }));
  const folders = Array.from(
    new Set([...extraFolders, ...notes.map((n) => n.folder)].filter(Boolean))
  ).sort();

  return {
    format: "superpad-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    folders,
    notes: entries,
  };
}

export function createPlaintextBackupJson(
  notes: NoteRecord[],
  extraFolders: string[]
): string {
  return JSON.stringify(buildPlaintextPayload(notes, extraFolders), null, 2);
}

export async function createEncryptedBackupJson(
  notes: NoteRecord[],
  extraFolders: string[],
  password: string
): Promise<string> {
  if (!password || password.length < 4) {
    throw new Error("Backup password must be at least 4 characters.");
  }
  const plain = buildPlaintextPayload(notes, extraFolders);
  const salt = generateSaltBase64();
  const { encryptionKey } = await deriveUserKeys(password, salt);
  const ciphertext = await encryptWithKey(JSON.stringify(plain), encryptionKey);

  const envelope: EncryptedBackupPayload = {
    format: "superpad-encrypted-backup",
    version: 1,
    exportedAt: plain.exportedAt,
    salt,
    ciphertext,
  };
  return JSON.stringify(envelope, null, 2);
}

function normalizeBackupEntries(raw: unknown): {
  notes: BackupNoteEntry[];
  folders: string[];
  exportedAt?: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.notes)) return null;

  const notes: BackupNoteEntry[] = [];
  for (const item of obj.notes) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const meta = normalizeNoteMetadata(rec, "restored-note.txt");
    const content = typeof rec.content === "string" ? rec.content : "";
    notes.push({ ...meta, content });
  }

  const folders = Array.isArray(obj.folders)
    ? obj.folders.filter((f): f is string => typeof f === "string" && f.trim().length > 0)
    : [];
  const exportedAt = typeof obj.exportedAt === "string" ? obj.exportedAt : undefined;

  return { notes, folders, exportedAt };
}

export function inspectBackupFile(rawText: string): BackupInspection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { kind: "invalid", error: "File is not valid JSON." };
  }

  if (!parsed || typeof parsed !== "object") {
    return { kind: "invalid", error: "Unrecognized backup format." };
  }

  const obj = parsed as Record<string, unknown>;
  if (
    obj.format === "superpad-encrypted-backup" &&
    typeof obj.salt === "string" &&
    typeof obj.ciphertext === "string"
  ) {
    return {
      kind: "encrypted",
      exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : undefined,
      payload: {
        format: "superpad-encrypted-backup",
        version: 1,
        exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : "",
        salt: obj.salt,
        ciphertext: obj.ciphertext,
      },
    };
  }

  const plain = normalizeBackupEntries(obj);
  if (plain) {
    return {
      kind: "plaintext",
      exportedAt: plain.exportedAt,
      notes: plain.notes,
      folders: plain.folders,
    };
  }

  return { kind: "invalid", error: "Not a valid SuperPad backup file." };
}

export async function decryptBackupFile(
  payload: EncryptedBackupPayload,
  password: string
): Promise<{ notes: BackupNoteEntry[]; folders: string[]; exportedAt?: string }> {
  const { encryptionKey } = await deriveUserKeys(password, payload.salt);
  let decryptedJson: string;
  try {
    decryptedJson = await decryptWithKey(payload.ciphertext, encryptionKey);
  } catch {
    throw new Error("Incorrect backup password or corrupted backup file.");
  }

  const parsed = JSON.parse(decryptedJson);
  const normalized = normalizeBackupEntries(parsed);
  if (!normalized) {
    throw new Error("Decrypted backup payload is malformed.");
  }
  return normalized;
}
