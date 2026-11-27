"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Clock,
  FileCode2,
  History,
  Lock,
  Search,
  ShieldCheck,
  Shuffle,
  SplitSquareHorizontal,
  X,
} from "lucide-react";
import { getRecentRooms, removeRecentRoom } from "@/lib/crypto";

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

function generateRandomRoom(): string {
  const arr = new Uint32Array(3);
  crypto.getRandomValues(arr);
  const adj = ADJECTIVES[arr[0] % ADJECTIVES.length];
  const noun = NOUNS[arr[1] % NOUNS.length];
  const num = (arr[2] % 900) + 100;
  return `${adj}-${noun}-${num}`;
}

function sanitizeRoomInput(val: string): string {
  return val
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
}

export default function HomePage() {
  const router = useRouter();
  const [roomInput, setRoomInput] = useState("");
  const [recentRooms, setRecentRooms] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setRecentRooms(getRecentRooms());
  }, []);

  const handleOpenRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = sanitizeRoomInput(roomInput);
    if (!cleaned) {
      setError("Enter a vault name (letters, numbers, hyphens, or underscores).");
      return;
    }
    router.push(`/${encodeURIComponent(cleaned)}`);
  };

  const handleRandomRoom = () => {
    const slug = generateRandomRoom();
    router.push(`/${encodeURIComponent(slug)}`);
  };

  const handleRemoveRecent = (slug: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeRecentRoom(slug);
    setRecentRooms(getRecentRooms());
  };

  return (
    <div className="min-h-screen h-screen overflow-y-auto bg-[#0b0e14] text-[#e6edf3] flex flex-col">
      {/* Top Navbar */}
      <header className="w-full border-b border-[#1f2630] bg-[#0f131a]/80 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Lock className="w-3.5 h-3.5 text-[#0b0e14] stroke-[2.5]" />
            </div>
            <span className="font-semibold tracking-tight text-[15px] text-white">
              ZeroPad
            </span>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              v1.0
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#8b949e]">
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              AES-256-GCM Client-Side
            </span>
            <span className="hidden sm:inline text-[#30363d]">•</span>
            <span className="hidden sm:inline">No Accounts</span>
          </div>
        </div>
      </header>

      {/* Main Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#161b22] border border-[#2b323d] text-xs text-[#9ca3af]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Zero-knowledge cloud encryption • Notepad++ power tools
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white leading-[1.15]">
            The Next-Gen{" "}
            <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
              Notepad++
            </span>{" "}
            for the Web.
          </h1>

          <p className="text-[#8b949e] text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
            Pick any secret URL, choose a password, and unlock a full multi-tab code
            &amp; notes workspace. Your password and plaintext never leave your browser.
          </p>

          {/* Room Launcher Input */}
          <form onSubmit={handleOpenRoom} className="mt-8 space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2 rounded-xl bg-[#131820] border border-[#2b323d] focus-within:border-emerald-500/70 focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all shadow-2xl shadow-black/40">
              <div className="flex items-center flex-1 px-3 py-2 gap-1 font-mono text-sm">
                <span className="text-[#6e7681] select-none">zeropad /</span>
                <input
                  type="text"
                  value={roomInput}
                  onChange={(e) => {
                    setRoomInput(sanitizeRoomInput(e.target.value));
                    if (error) setError("");
                  }}
                  placeholder="your-secret-vault"
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  className="flex-1 bg-transparent text-white placeholder-[#484f58] outline-none min-w-0"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRandomRoom}
                  title="Generate a random anonymous vault URL"
                  className="px-3.5 py-2.5 rounded-lg bg-[#1d2430] hover:bg-[#262f3f] text-[#c9d1d9] text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  <span>Random</span>
                </button>
                <button
                  type="submit"
                  className="flex-1 sm:flex-initial px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#0b0e14] text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>Open Vault</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {error ? (
              <p className="text-xs text-rose-400 text-left px-2">{error}</p>
            ) : (
              <p className="text-xs text-[#6e7681]">
                If the vault does not exist yet, you will set a new password to create it.
              </p>
            )}
          </form>

          {/* Recent Vaults */}
          {recentRooms.length > 0 ? (
            <div className="pt-2">
              <div className="flex items-center justify-center gap-1.5 text-xs text-[#6e7681] mb-2.5">
                <Clock className="w-3.5 h-3.5" />
                <span>Recent vaults on this browser</span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {recentRooms.map((slug) => (
                  <div
                    key={slug}
                    onClick={() => router.push(`/${encodeURIComponent(slug)}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        router.push(`/${encodeURIComponent(slug)}`);
                      }
                    }}
                    className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#151b23] hover:bg-[#1c2430] border border-[#262e3a] hover:border-emerald-500/40 text-xs font-mono text-[#c9d1d9] cursor-pointer transition-all"
                  >
                    <Lock className="w-3 h-3 text-emerald-400/70" />
                    <span>/{slug}</span>
                    <button
                      type="button"
                      onClick={(e) => handleRemoveRecent(slug, e)}
                      title="Remove from recent list"
                      className="text-[#6e7681] hover:text-rose-400 p-0.5 rounded opacity-60 group-hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Feature Grid */}
        <div className="w-full max-w-4xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mt-14">
          <div className="p-4 rounded-xl bg-[#11161e] border border-[#1f2630] space-y-2">
            <FileCode2 className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Multi-Tab CodeMirror 6</h3>
            <p className="text-xs text-[#8b949e] leading-relaxed">
              Line numbers, folding, 11 languages, multi-cursor editing, bookmarks, and per-tab undo history.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#11161e] border border-[#1f2630] space-y-2">
            <Search className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">Boolean Block Scanner</h3>
            <p className="text-xs text-[#8b949e] leading-relaxed">
              Filter entries by AND / OR / NOT across one or all tabs, plus regex Find &amp; Replace.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#11161e] border border-[#1f2630] space-y-2">
            <SplitSquareHorizontal className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Split View &amp; Text Tools</h3>
            <p className="text-xs text-[#8b949e] leading-relaxed">
              View two tabs side-by-side, sort lines, deduplicate, format JSON, and drag-and-drop files.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#11161e] border border-[#1f2630] space-y-2">
            <History className="w-5 h-5 text-violet-400" />
            <h3 className="text-sm font-semibold text-white">Encrypted Time Machine</h3>
            <p className="text-xs text-[#8b949e] leading-relaxed">
              Automatic rolling backups of your last 10 encrypted cloud saves so you never lose work.
            </p>
          </div>
        </div>
      </main>

      <footer className="w-full py-4 text-center text-xs text-[#6e7681] border-t border-[#161b22]">
        Zero-knowledge architecture • PBKDF2-SHA-256 (200k rounds) + AES-256-GCM • Server never sees your key or room names
      </footer>
    </div>
  );
}
