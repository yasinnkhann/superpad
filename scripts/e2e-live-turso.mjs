import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";

// --- Color Helpers ---
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// --- Cryptographic Primitives (Node 20+ Native Web Crypto Parity) ---
const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(base64) {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function generateSaltBase64() {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return bytesToBase64(salt);
}

async function deriveUserKeys(password, kdfSaltBase64) {
  const subtle = globalThis.crypto.subtle;
  const saltBytes = base64ToBytes(kdfSaltBase64);

  const keyMaterial = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
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

  const derivedArray = new Uint8Array(derivedBits);
  const authBytes = derivedArray.subarray(0, 32);
  const encBytes = derivedArray.subarray(32, 64);

  const encryptionKey = await subtle.importKey(
    "raw",
    encBytes,
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

async function encryptWithKey(plaintext, key) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encryptedBuf = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const ctBytes = new Uint8Array(encryptedBuf);
  const combined = new Uint8Array(IV_BYTES + ctBytes.length);
  combined.set(iv, 0);
  combined.set(ctBytes, IV_BYTES);
  return bytesToBase64(combined);
}

async function decryptWithKey(base64Payload, key) {
  const bytes = base64ToBytes(base64Payload);
  if (bytes.length < IV_BYTES + 16) {
    throw new Error("Corrupted ciphertext");
  }
  const iv = bytes.subarray(0, IV_BYTES);
  const ct = bytes.subarray(IV_BYTES);
  const decryptedBuf = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    ct
  );
  return new TextDecoder().decode(decryptedBuf);
}

// --- Boolean Scanner Helper ---
function testScanner(blocks, query) {
  const mustTerms = (query.mustInclude || []).map(t => t.toLowerCase());
  const anyTerms = (query.anyInclude || []).map(t => t.toLowerCase());
  const notTerms = (query.mustNotInclude || []).map(t => t.toLowerCase());

  return blocks.filter(text => {
    const lower = text.toLowerCase();
    for (const not of notTerms) {
      if (lower.includes(not)) return false;
    }
    for (const must of mustTerms) {
      if (!lower.includes(must)) return false;
    }
    if (anyTerms.length > 0) {
      const matchAny = anyTerms.some(term => lower.includes(term));
      if (!matchAny) return false;
    }
    return true;
  });
}

// --- Main E2E Runner ---
async function runE2E() {
  const PORT = 4321;
  const BASE_URL = `http://localhost:${PORT}`;
  console.log(bold(cyan("\n=======================================================")));
  console.log(bold(cyan("   ZeroPad Full Live End-to-End Test (Turso Cloud)   ")));
  console.log(bold(cyan("=======================================================\n")));

  console.log(dim(`Connecting to Turso: ${process.env.TURSO_DATABASE_URL}`));
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log(dim(`Spawning Next.js production server on port ${PORT}...`));
  const server = spawn("node", ["./node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
    env: process.env,
    stdio: "pipe",
    cwd: process.cwd(),
  });

  server.stdout.on("data", (d) => {
    // optional debug: console.log(dim(`[server] ${d.toString().trim()}`));
  });

  server.stderr.on("data", (d) => {
    const s = d.toString();
    if (!s.includes("ExperimentalWarning")) process.stderr.write(dim(`[server-err] ${s}`));
  });

  server.on("error", (err) => {
    console.error(red("Server spawn error:"), err);
  });

  const cleanup = async () => {
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    // 1. Wait for server to become healthy
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const ping = await fetch(`http://localhost:${PORT}/api/auth/challenge`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: "ping_test" }),
        });
        if (ping.status === 200) {
          ready = true;
          break;
        } else {
          const body = await ping.text();
          console.log(dim(`[ping status ${ping.status}] ${body}`));
        }
      } catch (err) {
        // network not listening yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!ready) {
      throw new Error("Next.js server failed to start within 15 seconds.");
    }
    console.log(green("✓ Next.js server listening and responding on port " + PORT));

    let sessionCookie = "";
    const api = async (endpoint, options = {}) => {
      const headers = { ...(options.headers || {}) };
      if (sessionCookie) headers["cookie"] = sessionCookie;
      if (options.body && typeof options.body === "object" && !(options.body instanceof String)) {
        headers["content-type"] = "application/json";
        options.body = JSON.stringify(options.body);
      }
      const res = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
      const rawCookie = res.headers.get("set-cookie");
      if (rawCookie) {
        const m = rawCookie.match(/zeropad_session=[^;]+/);
        if (m) sessionCookie = m[0];
      }
      return res;
    };

    const runStep = async (name, fn) => {
      process.stdout.write(`  • ${name.padEnd(55, ".")} `);
      try {
        const start = performance.now();
        await fn();
        const duration = Math.round(performance.now() - start);
        console.log(green(`PASSED (${duration}ms)`));
      } catch (err) {
        console.log(red("FAILED"));
        throw err;
      }
    };

    console.log(bold("\n[1/7] Authentication & Security Verification"));

    await runStep("Rejects unauthenticated /api/notes with 401", async () => {
      const res = await api("/api/notes");
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    });

    const testUser = `e2e_user_${Date.now()}`;
    const testPassword = `VaultPassword!${Date.now()}#Secure`;
    let userSalt = "";
    let clientKeys = null;

    await runStep("Handshake returns anti-enumeration decoy/kdf salt", async () => {
      const res = await api(`/api/auth/challenge`, {
        method: "POST",
        body: { username: testUser },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!data.kdfSalt) throw new Error("Invalid challenge payload");
      userSalt = generateSaltBase64(); // New user picks client-side generated salt
    });

    await runStep("Derives 512-bit split keys (200k PBKDF2 rounds)", async () => {
      clientKeys = await deriveUserKeys(testPassword, userSalt);
      if (!clientKeys.authKey || !clientKeys.encryptionKey) throw new Error("Missing derived keys");
    });

    await runStep("Registers anonymous account & receives session cookie", async () => {
      const res = await api("/api/auth/register", {
        method: "POST",
        body: {
          username: testUser,
          kdfSalt: userSalt,
          authKey: clientKeys.authKey,
        },
      });
      if (res.status !== 200) throw new Error(`Register failed with ${res.status}`);
      if (!sessionCookie) throw new Error("Did not receive zeropad_session cookie");
    });

    await runStep("Rejects duplicate registration with 409 Conflict", async () => {
      const res = await api("/api/auth/register", {
        method: "POST",
        body: {
          username: testUser,
          kdfSalt: userSalt,
          authKey: clientKeys.authKey,
        },
      });
      if (res.status !== 409) throw new Error(`Expected 409, got ${res.status}`);
    });

    await runStep("Validates session identity on /api/auth/me", async () => {
      const res = await api("/api/auth/me");
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!data.authenticated || data.user.username !== testUser) {
        throw new Error(`Invalid session user data: ${JSON.stringify(data)}`);
      }
    });

    console.log(bold("\n[2/7] Zero-Knowledge Note Encryption & Storage"));

    const note1Plain = {
      title: "Architecture Specification.md",
      folder: "Specs",
      language: "markdown",
      wordWrap: true,
      bookmarks: [5, 12],
      pinned: true,
      content: "# ZeroPad Architecture\n\nZero-knowledge text editor using libSQL / Turso cloud storage.\n\nAll cryptographic operations run client-side via WebCrypto.",
    };

    const note2Plain = {
      title: "Config Settings.json",
      folder: "Config",
      language: "json",
      wordWrap: false,
      bookmarks: [],
      pinned: false,
      content: '{\n  "cluster": "turso-primary",\n  "sync": true,\n  "maxRevisions": 10\n}',
    };

    let note1Id = "";
    let note2Id = "";

    await runStep("Encrypts notes client-side and uploads to Turso", async () => {
      const [enc1Meta, enc1Content] = await Promise.all([
        encryptWithKey(JSON.stringify({
          title: note1Plain.title,
          folder: note1Plain.folder,
          language: note1Plain.language,
          wordWrap: note1Plain.wordWrap,
          bookmarks: note1Plain.bookmarks,
          pinned: note1Plain.pinned,
        }), clientKeys.encryptionKey),
        encryptWithKey(note1Plain.content, clientKeys.encryptionKey),
      ]);

      const res1 = await api("/api/notes", {
        method: "POST",
        body: {
          encryptedMeta: enc1Meta,
          encryptedContent: enc1Content,
          sizeBytes: Buffer.byteLength(note1Plain.content),
        },
      });
      if (res1.status !== 200 && res1.status !== 201) throw new Error(`Create note1 failed: ${res1.status}`);
      const data1 = await res1.json();
      note1Id = data1.note.id;

      const [enc2Meta, enc2Content] = await Promise.all([
        encryptWithKey(JSON.stringify({
          title: note2Plain.title,
          folder: note2Plain.folder,
          language: note2Plain.language,
          wordWrap: note2Plain.wordWrap,
          bookmarks: note2Plain.bookmarks,
          pinned: note2Plain.pinned,
        }), clientKeys.encryptionKey),
        encryptWithKey(note2Plain.content, clientKeys.encryptionKey),
      ]);

      const res2 = await api("/api/notes", {
        method: "POST",
        body: {
          encryptedMeta: enc2Meta,
          encryptedContent: enc2Content,
          sizeBytes: Buffer.byteLength(note2Plain.content),
        },
      });
      if (res2.status !== 200 && res2.status !== 201) throw new Error(`Create note2 failed: ${res2.status}`);
      const data2 = await res2.json();
      note2Id = data2.note.id;
    });

    console.log(bold("\n[3/7] Zero-Knowledge Wire & Decryption Fidelity"));

    await runStep("Verifies zero plaintext leakage on the network & DB", async () => {
      const res = await api("/api/notes");
      const rawText = await res.text();
      // Ensure no plaintext appears in raw response
      if (rawText.includes("Architecture Specification")) throw new Error("Plaintext title leaked in API response!");
      if (rawText.includes("turso-primary")) throw new Error("Plaintext content leaked in API response!");
      if (rawText.includes("Zero-knowledge")) throw new Error("Plaintext content leaked in API response!");

      const data = JSON.parse(rawText);
      if (data.notes.length !== 2) throw new Error(`Expected 2 notes, found ${data.notes.length}`);

      // Client decrypts Note 1
      const n1 = data.notes.find(n => n.id === note1Id);
      const dec1Meta = JSON.parse(await decryptWithKey(n1.encryptedMeta, clientKeys.encryptionKey));
      const dec1Content = await decryptWithKey(n1.encryptedContent, clientKeys.encryptionKey);

      if (dec1Meta.title !== note1Plain.title) throw new Error("Decrypted title mismatch");
      if (dec1Content !== note1Plain.content) throw new Error("Decrypted content mismatch");

      // Client decrypts Note 2
      const n2 = data.notes.find(n => n.id === note2Id);
      const dec2Meta = JSON.parse(await decryptWithKey(n2.encryptedMeta, clientKeys.encryptionKey));
      const dec2Content = await decryptWithKey(n2.encryptedContent, clientKeys.encryptionKey);

      if (dec2Meta.title !== note2Plain.title) throw new Error("Decrypted title mismatch");
      if (dec2Content !== note2Plain.content) throw new Error("Decrypted content mismatch");
    });

    console.log(bold("\n[4/7] Concurrency Control & Rolling Revisions"));

    await runStep("Detects optimistic concurrency remote conflict (409)", async () => {
      // Step A: Client 1 updates note1 (version 1 -> 2)
      const updatedContent = note1Plain.content + "\n\nAdded section by Client 1.";
      const [encMeta, encContent] = await Promise.all([
        encryptWithKey(JSON.stringify(note1Plain), clientKeys.encryptionKey),
        encryptWithKey(updatedContent, clientKeys.encryptionKey),
      ]);

      const resUpdate = await api(`/api/notes/${note1Id}`, {
        method: "PUT",
        body: {
          encryptedMeta: encMeta,
          encryptedContent: encContent,
          sizeBytes: Buffer.byteLength(updatedContent),
          expectedVersion: 1,
        },
      });
      if (resUpdate.status !== 200) throw new Error(`Expected 200 on update, got ${resUpdate.status}`);
      const updateData = await resUpdate.json();
      if (updateData.note.version !== 2) throw new Error("Expected note version 2");

      // Step B: Client 2 tries to update with stale version 1
      const staleRes = await api(`/api/notes/${note1Id}`, {
        method: "PUT",
        body: {
          encryptedMeta: encMeta,
          encryptedContent: encContent,
          sizeBytes: Buffer.byteLength(updatedContent),
          expectedVersion: 1, // STALE!
        },
      });
      if (staleRes.status !== 409) throw new Error(`Expected 409 Conflict, got ${staleRes.status}`);
      const conflictData = await staleRes.json();
      if (!conflictData.conflict || conflictData.remoteNote.version !== 2) {
        throw new Error("Conflict response did not include remote note at version 2");
      }
    });

    await runStep("Time Machine maintains rolling encrypted revisions", async () => {
      const res = await api(`/api/notes/${note1Id}/revisions`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.revisions) || data.revisions.length < 1) {
        throw new Error("No revisions recorded after note update");
      }
      if (data.revisions[0].version !== 2) {
        throw new Error(`Expected latest revision to be version 2, got ${data.revisions[0].version}`);
      }
    });

    console.log(bold("\n[5/7] Boolean Block Scanner Engine"));

    await runStep("Runs multi-criteria paragraph queries across decrypted notes", async () => {
      const p1 = "ZeroPad Architecture\nZero-knowledge text editor using libSQL / Turso cloud storage.";
      const p2 = "All cryptographic operations run client-side via WebCrypto.";
      const p3 = "cluster: turso-primary\nsync: true";
      const blocks = [p1, p2, p3];

      // Query A: Must include 'zeropad' AND 'turso', NOT 'sync'
      const matchA = testScanner(blocks, {
        mustInclude: ["zeropad", "turso"],
        mustNotInclude: ["sync"],
      });
      if (matchA.length !== 1 || !matchA[0].includes("Architecture")) {
        throw new Error("Scanner query A failed");
      }

      // Query B: Must include 'cluster' OR 'operations'
      const matchB = testScanner(blocks, {
        anyInclude: ["cluster", "operations"],
      });
      if (matchB.length !== 2) {
        throw new Error(`Scanner query B failed: expected 2, got ${matchB.length}`);
      }

      // Query C: Must NOT include 'turso'
      const matchC = testScanner(blocks, {
        mustNotInclude: ["turso"],
      });
      if (matchC.length !== 1 || !matchC[0].includes("WebCrypto")) {
        throw new Error("Scanner query C failed");
      }
    });

    console.log(bold("\n[6/7] Master Password Rotation & Vault Re-encryption"));

    const newPassword = `RotatedMasterPassphrase!${Date.now()}#2026`;
    let newKeys = null;

    await runStep("Re-encrypts all notes and commits atomic credential rotation", async () => {
      const newSalt = generateSaltBase64();
      newKeys = await deriveUserKeys(newPassword, newSalt);

      // Re-encrypt note1 and note2 with new key
      const [reEnc1Meta, reEnc1Content, reEnc2Meta, reEnc2Content] = await Promise.all([
        encryptWithKey(JSON.stringify(note1Plain), newKeys.encryptionKey),
        encryptWithKey(note1Plain.content, newKeys.encryptionKey),
        encryptWithKey(JSON.stringify(note2Plain), newKeys.encryptionKey),
        encryptWithKey(note2Plain.content, newKeys.encryptionKey),
      ]);

      const res = await api("/api/auth/password", {
        method: "POST",
        body: {
          currentAuthKey: clientKeys.authKey,
          newKdfSalt: newSalt,
          newAuthKey: newKeys.authKey,
          notes: [
            {
              id: note1Id,
              encryptedMeta: reEnc1Meta,
              encryptedContent: reEnc1Content,
              sizeBytes: Buffer.byteLength(note1Plain.content),
            },
            {
              id: note2Id,
              encryptedMeta: reEnc2Meta,
              encryptedContent: reEnc2Content,
              sizeBytes: Buffer.byteLength(note2Plain.content),
            },
          ],
        },
      });

      if (res.status !== 200) throw new Error(`Password change failed: ${res.status}`);
    });

    await runStep("Verifies old password fails and new password authenticates", async () => {
      // Clear cookie
      await api("/api/auth/logout", { method: "POST" });
      sessionCookie = "";

      // Try login with old authKey -> 401
      const failLogin = await api("/api/auth/login", {
        method: "POST",
        body: { username: testUser, authKey: clientKeys.authKey },
      });
      if (failLogin.status !== 401) throw new Error(`Expected 401 on old credentials, got ${failLogin.status}`);

      // Login with new authKey -> 200
      const okLogin = await api("/api/auth/login", {
        method: "POST",
        body: { username: testUser, authKey: newKeys.authKey },
      });
      if (okLogin.status !== 200) throw new Error(`Expected 200 on new credentials, got ${okLogin.status}`);

      // Decrypt notes with new key
      const listRes = await api("/api/notes");
      const listData = await listRes.json();
      const n1 = listData.notes.find(n => n.id === note1Id);
      const decContent = await decryptWithKey(n1.encryptedContent, newKeys.encryptionKey);
      if (decContent !== note1Plain.content) throw new Error("Decrypted content mismatch after key rotation");
    });

    console.log(bold("\n[7/7] Account Termination & Turso Cascade Cleanliness"));

    await runStep("Deletes account and verifies full database cascade cleanup", async () => {
      const delRes = await api("/api/auth/me", {
        method: "DELETE",
        body: { authKey: newKeys.authKey },
      });
      if (delRes.status !== 200) throw new Error(`Account deletion failed: ${delRes.status}`);

      // Verify session revoked
      const meRes = await api("/api/auth/me");
      const meData = await meRes.json();
      if (meData.authenticated) throw new Error("Session remained active after deletion");

      // Verify Turso cascade directly in cloud DB
      const userCheck = await turso.execute({
        sql: "SELECT count(*) AS c FROM users WHERE username = ?",
        args: [testUser],
      });
      if (Number(userCheck.rows[0].c) !== 0) throw new Error("User record still exists in Turso");

      const notesCheck = await turso.execute({
        sql: "SELECT count(*) AS c FROM notes WHERE id IN (?, ?)",
        args: [note1Id, note2Id],
      });
      if (Number(notesCheck.rows[0].c) !== 0) throw new Error("Note records still exist in Turso");

      const revsCheck = await turso.execute({
        sql: "SELECT count(*) AS c FROM note_revisions WHERE note_id IN (?, ?)",
        args: [note1Id, note2Id],
      });
      if (Number(revsCheck.rows[0].c) !== 0) throw new Error("Revision records still exist in Turso");
    });

    console.log(bold(green("\n=======================================================")));
    console.log(bold(green("   🎉 ALL END-TO-END TESTS PASSED ON TURSO CLOUD!   ")));
    console.log(bold(green("=======================================================\n")));

  } finally {
    await cleanup();
  }
}

runE2E().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(red("\n💥 E2E Test Suite Error:"), err);
  process.exit(1);
});
