"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Database,
  FileCode2,
  History,
  KeyRound,
  Loader2,
  Lock,
  Search,
  ShieldCheck,
  Shuffle,
  UserPlus,
} from "lucide-react";
import {
  DEFAULT_SETTINGS,
  generateNoteId,
} from "@/types/vault";
import {
  deriveUserKeys,
  encryptNotePayload,
  generateSaltBase64,
  getStoredSettings,
  saveCachedUserKey,
} from "@/lib/crypto";
import { setInMemoryKey } from "@/lib/memoryKey";

const ADJECTIVES = [
  "amber", "arctic", "cobalt", "crimson", "cyber", "emerald", "indigo",
  "lunar", "midnight", "neon", "obsidian", "onyx", "phantom", "quartz",
  "shadow", "silent", "silver", "solar", "velvet", "zenith",
];

const NOUNS = [
  "anchor", "atlas", "beacon", "cipher", "compass", "echo", "falcon",
  "forge", "glacier", "harbor", "horizon", "ledger", "matrix", "nebula",
  "nexus", "orbit", "prism", "pulse", "quill", "vault",
];

function generateRandomHandle(): string {
  const arr = new Uint32Array(3);
  crypto.getRandomValues(arr);
  const adj = ADJECTIVES[arr[0] % ADJECTIVES.length];
  const noun = NOUNS[arr[1] % NOUNS.length];
  const num = (arr[2] % 900) + 100;
  return `${adj}-${noun}-${num}`;
}

function sanitizeUsername(val: string): string {
  return val
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
}

const WELCOME_CONTENT = `# Welcome to SuperPad

Your account and every note inside it are end-to-end encrypted in your browser
with AES-256-GCM before syncing to Turso.

## Quick Keyboard Shortcuts
- Cmd/Ctrl + S         Save active note (creates an encrypted revision snapshot)
- Cmd/Ctrl + B         Toggle file-tree sidebar
- Cmd/Ctrl + F / H     Notepad++ Find & Replace (with Regex, Case, Whole Word)
- Cmd/Ctrl + Shift + F Boolean Block Scanner (AND / OR / NOT across all notes!)
- Cmd/Ctrl + G         Go to Line & Bookmarks
- Cmd/Ctrl + F2 / F2   Toggle Bookmark / Jump to Next Bookmark
- Cmd/Ctrl + Shift + D Insert Date Header Stamp

Tip: Drag and drop any .txt, .md, or code file directly onto this window to import it!
`;

export default function HomePage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // If already logged in via HttpOnly session cookie, go directly to /workspace
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.authenticated) {
          router.replace("/workspace");
        } else {
          setCheckingSession(false);
        }
      })
      .catch(() => {
        if (!cancelled) setCheckingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const cleanedUser = sanitizeUsername(username);
    if (cleanedUser.length < 3) {
      setError("Username must be at least 3 characters (letters, numbers, -, _).");
      return;
    }
    if (password.length < 6) {
      setError("Master password must be at least 6 characters.");
      return;
    }
    if (mode === "register" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const settings = getStoredSettings(DEFAULT_SETTINGS);

      if (mode === "register") {
        const kdfSalt = generateSaltBase64();
        const { authKey, encryptionKey, serializedKey } = await deriveUserKeys(
          password,
          kdfSalt
        );

        // Encrypt starter note locally before creating account
        const starterPayload = await encryptNotePayload(
          {
            title: "welcome.md",
            folder: "",
            language: "markdown",
            wordWrap: true,
            bookmarks: [],
            pinned: true,
          },
          WELCOME_CONTENT,
          encryptionKey
        );

        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: cleanedUser,
            kdfSalt,
            authKey,
            initialNote: {
              id: generateNoteId(),
              ...starterPayload,
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Could not create account.");
        }

        setInMemoryKey(data.user.id, encryptionKey, serializedKey);
        saveCachedUserKey(data.user.id, serializedKey, settings.sessionTtlMinutes);
        router.push("/workspace");
      } else {
        // 1. Fetch per-user KDF salt (returns decoy salt for unknown users)
        const chRes = await fetch("/api/auth/challenge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: cleanedUser }),
        });
        const chData = await chRes.json();
        if (!chRes.ok || !chData.kdfSalt) {
          throw new Error(chData.error || "Could not initiate login.");
        }

        // 2. Derive split authKey + local encryptionKey in browser
        const { authKey, encryptionKey, serializedKey } = await deriveUserKeys(
          password,
          chData.kdfSalt
        );

        // 3. Authenticate with server using authKey only (encryptionKey never leaves browser)
        const loginRes = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: cleanedUser, authKey }),
        });
        const loginData = await loginRes.json();
        if (!loginRes.ok) {
          throw new Error(loginData.error || "Invalid username or password.");
        }

        setInMemoryKey(loginData.user.id, encryptionKey, serializedKey);
        saveCachedUserKey(
          loginData.user.id,
          serializedKey,
          settings.sessionTtlMinutes
        );
        router.push("/workspace");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
      setSubmitting(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="h-screen w-screen bg-[#0b0e14] flex flex-col items-center justify-center gap-3 text-[#8b949e]">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
        <p className="text-xs font-mono">Loading SuperPad...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen h-screen overflow-y-auto bg-[#0b0e14] text-[#e6edf3] flex flex-col">
      {/* Header */}
      <header className="w-full border-b border-[#1f2630] bg-[#0f131a]/80 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Lock className="w-3.5 h-3.5 text-[#0b0e14] stroke-[2.5]" />
            </div>
            <span className="font-semibold tracking-tight text-[15px] text-white">
              SuperPad
            </span>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              v2 • Turso
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#8b949e]">
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Zero-Knowledge AES-256-GCM
            </span>
            <span className="hidden sm:inline text-[#30363d]">•</span>
            <span className="hidden sm:inline">No Email Required</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Left Pitch */}
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#161b22] border border-[#2b323d] text-xs text-[#9ca3af]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Anonymous accounts • Zero email • Client-side encrypted
            </div>

            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white leading-[1.12]">
              The Next-Gen{" "}
              <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
                Notepad++
              </span>{" "}
              for the Web.
            </h1>

            <p className="text-[#8b949e] text-base leading-relaxed max-w-xl">
              Sign in with an anonymous handle and master password to access all your
              encrypted notes, folders, and tabs across every device. Powered by Turso
              SQLite and split-key AES-256-GCM encryption.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="p-3.5 rounded-xl bg-[#11161e] border border-[#1f2630] flex items-start gap-3">
                <FileCode2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xs font-semibold text-white">File Tree + Multi-Tabs</h3>
                  <p className="text-[11px] text-[#8b949e] mt-0.5 leading-relaxed">
                    Folders, pinned notes, split view, bookmarks, 11 languages, and per-tab undo stacks.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#11161e] border border-[#1f2630] flex items-start gap-3">
                <Search className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xs font-semibold text-white">Boolean Scanner &amp; Regex</h3>
                  <p className="text-[11px] text-[#8b949e] mt-0.5 leading-relaxed">
                    Filter paragraph blocks by AND / OR / NOT across every note in your account.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#11161e] border border-[#1f2630] flex items-start gap-3">
                <Database className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xs font-semibold text-white">Multi-Device Sync &amp; Recovery</h3>
                  <p className="text-[11px] text-[#8b949e] mt-0.5 leading-relaxed">
                    Conflict detection prevents overwrites, plus encrypted IndexedDB crash recovery.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#11161e] border border-[#1f2630] flex items-start gap-3">
                <History className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xs font-semibold text-white">Per-Note Time Machine</h3>
                  <p className="text-[11px] text-[#8b949e] mt-0.5 leading-relaxed">
                    Last 10 encrypted snapshots saved per note with one-click decrypt &amp; restore.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Auth Card */}
          <div className="lg:col-span-5">
            <div className="rounded-2xl bg-[#131820] border border-[#2b323d] p-6 shadow-2xl shadow-black/60 space-y-5">
              {/* Mode Switcher */}
              <div className="grid grid-cols-2 p-1 rounded-xl bg-[#0b0e14] border border-[#21262d]">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError("");
                  }}
                  className={`py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    mode === "login"
                      ? "bg-[#1e2632] text-white shadow"
                      : "text-[#8b949e] hover:text-white"
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    setError("");
                  }}
                  className={`py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    mode === "register"
                      ? "bg-[#1e2632] text-white shadow"
                      : "text-[#8b949e] hover:text-white"
                  }`}
                >
                  Create Account
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-[#c9d1d9]">
                      Anonymous Handle
                    </label>
                    {mode === "register" ? (
                      <button
                        type="button"
                        onClick={() => setUsername(generateRandomHandle())}
                        className="text-[11px] text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Shuffle className="w-3 h-3" />
                        <span>Random</span>
                      </button>
                    ) : null}
                  </div>
                  <div className="flex items-center px-3 py-2.5 rounded-lg bg-[#0b0e14] border border-[#30363d] focus-within:border-emerald-500">
                    <span className="text-xs font-mono text-[#6e7681] mr-1">@</span>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(sanitizeUsername(e.target.value))}
                      placeholder="your-handle"
                      autoFocus
                      required
                      autoComplete="username"
                      spellCheck={false}
                      className="flex-1 bg-transparent text-sm font-mono text-white placeholder-[#484f58] outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#c9d1d9] mb-1">
                    Master Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "register" ? "At least 6 characters" : "Enter master password"}
                    required
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#0b0e14] border border-[#30363d] focus:border-emerald-500 text-sm text-white placeholder-[#484f58] outline-none"
                  />
                </div>

                {mode === "register" ? (
                  <div>
                    <label className="block text-xs font-medium text-[#c9d1d9] mb-1">
                      Confirm Master Password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter master password"
                      required
                      autoComplete="new-password"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-[#0b0e14] border border-[#30363d] focus:border-emerald-500 text-sm text-white placeholder-[#484f58] outline-none"
                    />
                  </div>
                ) : null}

                {error ? (
                  <p className="text-xs text-rose-400 bg-rose-950/30 border border-rose-500/30 rounded-lg px-3 py-2">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#0b0e14] font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>
                        {mode === "register" ? "Deriving keys & creating..." : "Deriving keys & signing in..."}
                      </span>
                    </>
                  ) : mode === "register" ? (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <span>Create Anonymous Vault</span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" />
                      <span>Unlock &amp; Sign In</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              <p className="text-[11px] text-[#6e7681] leading-relaxed border-t border-[#1f2630] pt-3">
                <strong className="text-[#8b949e]">Zero-knowledge notice:</strong> Your master
                password never leaves your browser. Because we cannot see or recover it, make
                sure you remember it or save it in your password manager.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full py-4 text-center text-xs text-[#6e7681] border-t border-[#161b22]">
        Split-Key PBKDF2-SHA-256 (200k rounds) + AES-256-GCM • Backed by Turso (libSQL)
      </footer>
    </div>
  );
}
