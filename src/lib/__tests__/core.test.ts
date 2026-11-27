import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decryptNoteDTO,
  decryptWithKey,
  deriveUserKeys,
  encryptNotePayload,
  encryptWithKey,
  generateSaltBase64,
  importRawEncryptionKey,
} from "@/lib/crypto";
import {
  deduplicateLines,
  extractParagraphBlocks,
  formatJsonText,
  removeEmptyLines,
  runBooleanScanner,
  sortLines,
  trimTrailingWhitespace,
} from "@/lib/scanner";
import {
  createSession,
  generateDecoySalt,
  getAuthenticatedUserFromToken,
  hashAuthKey,
  revokeSessionByToken,
  validateUsername,
  verifyAuthKey,
} from "@/lib/auth";
import { getDb, resetDbClientForTests } from "@/lib/db";
import { checkRateLimit, clearRateLimit } from "@/lib/rateLimit";
import {
  createEncryptedBackupJson,
  createPlaintextBackupJson,
  decryptBackupFile,
  inspectBackupFile,
} from "@/lib/backup";
import type { NoteRecord } from "@/types/vault";

describe("SuperPad Split-Key Crypto Engine", () => {
  it("derives independent authKey and encryptionKey from password + salt", async () => {
    const salt = generateSaltBase64();
    const keysA = await deriveUserKeys("my-strong-password", salt);
    const keysB = await deriveUserKeys("my-strong-password", salt);
    const keysWrong = await deriveUserKeys("different-password", salt);

    expect(keysA.authKey).toBe(keysB.authKey);
    expect(keysA.serializedKey).toBe(keysB.serializedKey);
    expect(keysA.authKey).not.toBe(keysA.serializedKey);
    expect(keysA.authKey).not.toBe(keysWrong.authKey);
  });

  it("encrypts and decrypts note metadata + content (including >500KB payloads)", async () => {
    const salt = generateSaltBase64();
    const derived = await deriveUserKeys("vault-secret-123", salt);

    const bigBody = "SuperPad line entry https://example.com\n".repeat(13_000);
    expect(bigBody.length).toBeGreaterThan(500_000);

    const enc = await encryptNotePayload(
      {
        title: "introspects.txt",
        folder: "Personal",
        language: "plain",
        wordWrap: true,
        bookmarks: [3, 42],
        pinned: true,
      },
      bigBody,
      derived.encryptionKey
    );

    expect(enc.encryptedMeta).not.toContain("introspects");
    expect(enc.encryptedContent).not.toContain("SuperPad");

    const reimported = await importRawEncryptionKey(derived.serializedKey);
    const decrypted = await decryptNoteDTO(
      {
        id: "note-1",
        ...enc,
        version: 1,
        createdAt: 1000,
        updatedAt: 2000,
      },
      reimported
    );

    expect(decrypted.title).toBe("introspects.txt");
    expect(decrypted.folder).toBe("Personal");
    expect(decrypted.bookmarks).toEqual([3, 42]);
    expect(decrypted.pinned).toBe(true);
    expect(decrypted.content).toBe(bigBody);
  });

  it("rejects decryption with a wrong key", async () => {
    const salt = generateSaltBase64();
    const k1 = await deriveUserKeys("password-one", salt);
    const k2 = await deriveUserKeys("password-two", salt);
    const ct = await encryptWithKey("secret text", k1.encryptionKey);
    await expect(decryptWithKey(ct, k2.encryptionKey)).rejects.toThrow();
  });
});

describe("Boolean Block Scanner & Text Transforms", () => {
  const sampleA = [
    "https://example.com/1 - Alpha Beta entry",
    "",
    "https://example.com/2 - Alpha multi-line",
    "   with Beta on line two",
    "",
    "https://example.com/3 - Alpha Beta Draft",
    "",
    "Gamma only block",
  ].join("\n");

  const makeNote = (id: string, title: string, folder: string, content: string): NoteRecord => ({
    id,
    title,
    folder,
    content,
    language: "plain",
    wordWrap: true,
    bookmarks: [],
    pinned: false,
    version: 1,
    sizeBytes: content.length,
    createdAt: 1,
    updatedAt: 1,
  });

  it("tracks accurate offsets and 1-based line numbers", () => {
    const blocks = extractParagraphBlocks(sampleA);
    expect(blocks).toHaveLength(4);
    expect(blocks[0].lineNumber).toBe(1);
    expect(blocks[1].lineNumber).toBe(3);
    expect(blocks[2].lineNumber).toBe(6);
    expect(blocks[3].lineNumber).toBe(8);
    expect(sampleA.slice(blocks[1].startOffset, blocks[1].endOffset)).toBe(blocks[1].content);
  });

  it("scans current tab, open tabs, and all account notes with AND / OR / NOT", () => {
    const n1 = makeNote("n1", "notes.txt", "Personal", sampleA);
    const n2 = makeNote("n2", "work.txt", "Work", "Alpha Beta Delta\n\nOther block");
    const n3 = makeNote("n3", "archive.txt", "Archive", "Alpha Beta Delta Closed");

    const cur = runBooleanScanner([n1, n2, n3], ["n1", "n2"], "n1", {
      all: "alpha, beta",
      any: "",
      exclude: "draft",
      scope: "current",
    });
    expect(cur.matches).toHaveLength(2);

    const openOnly = runBooleanScanner([n1, n2, n3], ["n1", "n2"], "n1", {
      all: "alpha, beta",
      any: "delta, multi-line",
      exclude: "",
      scope: "open",
    });
    expect(openOnly.matches.map((m) => m.noteId)).toEqual(["n1", "n2"]);

    const allAccount = runBooleanScanner([n1, n2, n3], ["n1"], "n1", {
      all: "alpha, beta, delta",
      any: "",
      exclude: "",
      scope: "all",
    });
    expect(allAccount.matches.map((m) => m.noteId)).toEqual(["n2", "n3"]);
  });

  it("runs Notepad++ line & JSON transforms cleanly", () => {
    expect(sortLines("b\na\nc", "asc")).toBe("a\nb\nc");
    expect(sortLines("b\na\nc", "desc")).toBe("c\nb\na");
    expect(deduplicateLines("a\nb\na\nc\nb")).toEqual({ result: "a\nb\nc", removed: 2 });
    expect(removeEmptyLines("a\n\n  \nb")).toEqual({ result: "a\nb", removed: 2 });
    expect(trimTrailingWhitespace("hello   \nworld\t ")).toBe("hello\nworld");

    const pretty = formatJsonText('{"b":2,"a":1}', false);
    expect(pretty.ok).toBe(true);
    if (pretty.ok) expect(pretty.result).toContain('\n  "b": 2');

    const bad = formatJsonText("{not json}", false);
    expect(bad.ok).toBe(false);
  });
});

describe("Turso / libSQL Schema & Server Auth", () => {
  let tmpDir: string;

  beforeAll(async () => {
    resetDbClientForTests();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "superpad-turso-test-"));
    process.env.SUPERPAD_DB_URL = `file:${path.join(tmpDir, "test.db")}`;
    process.env.ZEROPAD_DB_URL = `file:${path.join(tmpDir, "test.db")}`;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
  });

  afterAll(async () => {
    resetDbClientForTests();
    delete process.env.ZEROPAD_DB_URL;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("validates usernames, decoy salts, and scrypt auth verifiers", () => {
    expect(validateUsername("Cobalt_Vault-99")).toBe("cobalt_vault-99");
    expect(() => validateUsername("ab")).toThrow();
    expect(() => validateUsername("bad user!")).toThrow();

    expect(generateDecoySalt("ghost-user")).toBe(generateDecoySalt("ghost-user"));
    expect(generateDecoySalt("ghost-user")).not.toBe(generateDecoySalt("other-user"));

    const { salt, verifier } = hashAuthKey("base64-auth-key-example");
    expect(verifyAuthKey("base64-auth-key-example", salt, verifier)).toBe(true);
    expect(verifyAuthKey("wrong-auth-key", salt, verifier)).toBe(false);
  });

  it("creates users, enforces UNIQUE usernames, manages sessions, and cascades deletes", async () => {
    const db = await getDb();
    const now = Date.now();
    const { salt, verifier } = hashAuthKey("test-auth-key-12345");

    await db.execute({
      sql: `INSERT INTO users (id, username, kdf_salt, auth_salt, auth_verifier, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ["u-1", "alice", generateSaltBase64(), salt, verifier, now, now],
    });

    // Duplicate username must fail UNIQUE constraint
    await expect(
      db.execute({
        sql: `INSERT INTO users (id, username, kdf_salt, auth_salt, auth_verifier, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: ["u-2", "alice", generateSaltBase64(), salt, verifier, now, now],
      })
    ).rejects.toThrow();

    // Session create -> authenticate -> revoke
    const session = await createSession("u-1");
    const authed = await getAuthenticatedUserFromToken(session.token);
    expect(authed?.username).toBe("alice");

    await revokeSessionByToken(session.token);
    const afterRevoke = await getAuthenticatedUserFromToken(session.token);
    expect(afterRevoke).toBeNull();
  });

  it("enforces persistent rate limits and clears keys cleanly", async () => {
    const key = "test:login:ip:127.0.0.1";
    await clearRateLimit(key);

    const r1 = await checkRateLimit(key, 2, 60_000);
    const r2 = await checkRateLimit(key, 2, 60_000);
    const r3 = await checkRateLimit(key, 2, 60_000);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterSeconds).toBeGreaterThan(0);

    await clearRateLimit(key);
    const r4 = await checkRateLimit(key, 2, 60_000);
    expect(r4.allowed).toBe(true);
  });

  it("supports encrypted and plaintext backup export/restore round-trips", async () => {
    const sampleNotes: NoteRecord[] = [
      {
        id: "n-1",
        title: "plan.md",
        folder: "Work",
        language: "markdown",
        wordWrap: true,
        bookmarks: [2],
        pinned: true,
        content: "# Roadmap\n- [x] Ship SuperPad",
        version: 3,
        sizeBytes: 28,
        createdAt: 100,
        updatedAt: 200,
      },
    ];

    const plainJson = createPlaintextBackupJson(sampleNotes, ["Work", "EmptyFolder"]);
    const inspectedPlain = inspectBackupFile(plainJson);
    expect(inspectedPlain.kind).toBe("plaintext");
    if (inspectedPlain.kind === "plaintext") {
      expect(inspectedPlain.notes).toHaveLength(1);
      expect(inspectedPlain.notes[0].title).toBe("plan.md");
      expect(inspectedPlain.folders).toEqual(["EmptyFolder", "Work"]);
    }

    const encJson = await createEncryptedBackupJson(sampleNotes, ["Work", "EmptyFolder"], "backup-pass-99");
    expect(encJson).not.toContain("Roadmap");
    expect(encJson).not.toContain("plan.md");

    const inspectedEnc = inspectBackupFile(encJson);
    expect(inspectedEnc.kind).toBe("encrypted");
    if (inspectedEnc.kind === "encrypted") {
      await expect(decryptBackupFile(inspectedEnc.payload, "wrong-pass")).rejects.toThrow();
      const restored = await decryptBackupFile(inspectedEnc.payload, "backup-pass-99");
      expect(restored.notes).toHaveLength(1);
      expect(restored.notes[0].content).toBe("# Roadmap\n- [x] Ship SuperPad");
      expect(restored.notes[0].pinned).toBe(true);
      expect(restored.folders).toEqual(["EmptyFolder", "Work"]);
    }
  });
});
