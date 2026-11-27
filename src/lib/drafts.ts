import type { NoteMetadata } from "@/types/vault";
import { decryptWithKey, encryptWithKey } from "@/lib/crypto";
import { normalizeNoteMetadata } from "@/types/vault";

const DB_NAME = "zeropad_crash_recovery_v1";
const STORE_NAME = "drafts";

interface StoredEncryptedDraft {
  noteId: string;
  userId: string;
  encryptedMeta: string;
  encryptedContent: string;
  baseVersion: number;
  updatedAt: number;
}

export interface RecoveredDraft {
  noteId: string;
  meta: NoteMetadata;
  content: string;
  baseVersion: number;
  updatedAt: number;
}

function openDraftDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "noteId" });
          store.createIndex("by_user", "userId", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveEncryptedDraft(
  userId: string,
  noteId: string,
  meta: NoteMetadata,
  content: string,
  baseVersion: number,
  key: CryptoKey
): Promise<void> {
  const db = await openDraftDb();
  if (!db) return;

  try {
    const [encryptedMeta, encryptedContent] = await Promise.all([
      encryptWithKey(JSON.stringify(meta), key),
      encryptWithKey(content, key),
    ]);
    const record: StoredEncryptedDraft = {
      noteId,
      userId,
      encryptedMeta,
      encryptedContent,
      baseVersion,
      updatedAt: Date.now(),
    };

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function deleteEncryptedDraft(noteId: string): Promise<void> {
  const db = await openDraftDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(noteId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function loadEncryptedDrafts(
  userId: string,
  key: CryptoKey
): Promise<RecoveredDraft[]> {
  const db = await openDraftDb();
  if (!db) return [];
  try {
    const rows = await new Promise<StoredEncryptedDraft[]>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const index = tx.objectStore(STORE_NAME).index("by_user");
      const req = index.getAll(userId);
      req.onsuccess = () => resolve((req.result as StoredEncryptedDraft[]) || []);
      req.onerror = () => resolve([]);
    });

    const recovered: RecoveredDraft[] = [];
    for (const row of rows) {
      try {
        const [metaStr, content] = await Promise.all([
          decryptWithKey(row.encryptedMeta, key),
          decryptWithKey(row.encryptedContent, key),
        ]);
        recovered.push({
          noteId: row.noteId,
          meta: normalizeNoteMetadata(JSON.parse(metaStr)),
          content,
          baseVersion: row.baseVersion,
          updatedAt: row.updatedAt,
        });
      } catch {
        // Ignore stale drafts encrypted under an old password
      }
    }
    return recovered;
  } finally {
    db.close();
  }
}

export async function clearUserDrafts(userId: string): Promise<void> {
  const db = await openDraftDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("by_user");
      const req = index.getAllKeys(userId);
      req.onsuccess = () => {
        for (const key of req.result) {
          store.delete(key);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}
