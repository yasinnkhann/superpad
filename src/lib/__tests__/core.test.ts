import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decryptText,
  decryptVault,
  encryptText,
  encryptVault,
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
  deleteVault,
  listVaultHistory,
  readVault,
  readVaultRevision,
  validateCiphertext,
  validateRoomSlug,
  writeVault,
} from "@/lib/storage";
import { createDefaultVault, createNewTab } from "@/types/vault";

describe("ZeroPad Crypto Engine", () => {
  it("encrypts and decrypts a multi-tab vault round-trip", async () => {
    const vault = createDefaultVault("introspects.txt", "Line 1\n\nLine 2");
    vault.tabs.push(createNewTab("script.py", "print('hello')", "python"));

    const ciphertext = await encryptVault(vault, "s3cr3t-p@ss");
    expect(ciphertext).not.toContain("introspects");
    expect(ciphertext).not.toContain("print");

    const restored = await decryptVault(ciphertext, "s3cr3t-p@ss");
    expect(restored.tabs).toHaveLength(2);
    expect(restored.tabs[0].title).toBe("introspects.txt");
    expect(restored.tabs[0].content).toBe("Line 1\n\nLine 2");
    expect(restored.tabs[1].language).toBe("python");
  });

  it("rejects wrong passwords cleanly", async () => {
    const ciphertext = await encryptText("top secret payload", "correct-horse");
    await expect(decryptText(ciphertext, "wrong-password")).rejects.toThrow();
  });

  it("handles large payloads (>500KB) without call-stack overflow", async () => {
    const largeText = "ZeroPad encrypted line entry https://example.com\n".repeat(12_000);
    expect(largeText.length).toBeGreaterThan(500_000);

    const vault = createDefaultVault("big.txt", largeText);
    const ciphertext = await encryptVault(vault, "large-vault-pass");
    const restored = await decryptVault(ciphertext, "large-vault-pass");
    expect(restored.tabs[0].content).toBe(largeText);
  });

  it("decrypts legacy raw plain-text blobs (100k PBKDF2 rounds, no magic header)", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const keyMat = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("legacy-pass"),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
      keyMat,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    );
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode("Legacy note body line 1\nLine 2")
      )
    );
    const combined = new Uint8Array(16 + 12 + ct.length);
    combined.set(salt, 0);
    combined.set(iv, 16);
    combined.set(ct, 28);
    const b64 = Buffer.from(combined).toString("base64");

    const vault = await decryptVault(b64, "legacy-pass");
    expect(vault.tabs).toHaveLength(1);
    expect(vault.tabs[0].content).toBe("Legacy note body line 1\nLine 2");
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

  it("tracks accurate offsets and 1-based line numbers for blocks", () => {
    const blocks = extractParagraphBlocks(sampleA);
    expect(blocks).toHaveLength(4);
    expect(blocks[0].lineNumber).toBe(1);
    expect(blocks[1].lineNumber).toBe(3);
    expect(blocks[2].lineNumber).toBe(6);
    expect(blocks[3].lineNumber).toBe(8);
    expect(sampleA.slice(blocks[1].startOffset, blocks[1].endOffset)).toBe(blocks[1].content);
  });

  it("matches AND, OR, and NOT criteria across single and all tabs", () => {
    const tab1 = createNewTab("notes.txt", sampleA);
    const tab2 = createNewTab("second.txt", "Alpha Beta Delta\n\nUnrelated block");

    const res1 = runBooleanScanner([tab1, tab2], tab1.id, {
      all: "alpha, beta",
      any: "",
      exclude: "draft",
      scope: "current",
    });
    expect(res1.matches).toHaveLength(2);
    expect(res1.matches[0].lineNumber).toBe(1);
    expect(res1.matches[1].lineNumber).toBe(3);

    const resAll = runBooleanScanner([tab1, tab2], tab1.id, {
      all: "alpha, beta",
      any: "delta, multi-line",
      exclude: "",
      scope: "all",
    });
    expect(resAll.matches).toHaveLength(2);
    expect(resAll.matches.map((m) => m.tabTitle)).toEqual(["notes.txt", "second.txt"]);
  });

  it("runs Notepad++ line & JSON text transformations cleanly", () => {
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

describe("Encrypted Vault Storage (Local Backend)", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zeropad-test-"));
    process.env.ZEROPAD_LOCAL_DATA_DIR = tmpDir;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.ZEROPAD_BLOB_READ_WRITE_TOKEN;
  });

  afterAll(async () => {
    delete process.env.ZEROPAD_LOCAL_DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("validates room slugs and base64 ciphertext", () => {
    expect(validateRoomSlug("My-Vault_01")).toBe("my-vault_01");
    expect(() => validateRoomSlug("../etc/passwd")).toThrow();
    expect(() => validateCiphertext("not valid base64!!")).toThrow();
  });

  it("writes, hashes room paths, keeps last 10 rolling backups, and deletes cleanly", async () => {
    const room = "secret-test-room";
    const empty = await readVault(room);
    expect(empty.exists).toBe(false);

    // Perform 12 saves and ensure only the latest 10 revisions remain
    let lastCipher = "";
    for (let i = 0; i < 12; i++) {
      lastCipher = Buffer.from(`encrypted-blob-payload-number-${i}-padding-1234567890`).toString(
        "base64"
      );
      await writeVault(room, lastCipher);
      // Small delay so timestamp revision IDs are distinct
      await new Promise((r) => setTimeout(r, 5));
    }

    // Raw room name must not appear as a directory name on disk
    const vaultDirs = await fs.readdir(path.join(tmpDir, "vaults"));
    expect(vaultDirs.some((d) => d.includes("secret-test-room"))).toBe(false);

    const current = await readVault(room);
    expect(current.exists).toBe(true);
    expect(current.ciphertext).toBe(lastCipher);

    const history = await listVaultHistory(room);
    expect(history).toHaveLength(10);

    const oldestKept = await readVaultRevision(room, history[history.length - 1].id);
    expect(oldestKept.exists).toBe(true);

    await deleteVault(room);
    const afterDelete = await readVault(room);
    expect(afterDelete.exists).toBe(false);
  });
});
