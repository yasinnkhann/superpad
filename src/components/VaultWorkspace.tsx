"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  Calendar,
  Check,
  Columns2,
  Copy,
  Download,
  FileCode2,
  FilePlus,
  FileText,
  History,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  WrapText,
  Wrench,
  X,
} from "lucide-react";
import {
  DEFAULT_SETTINGS,
  EditorSettings,
  LANGUAGE_EXTENSIONS,
  LANGUAGE_LABELS,
  LanguageMode,
  NoteTab,
  ScannerMatch,
  VaultData,
  createDefaultVault,
  createNewTab,
  detectLanguageFromFilename,
  generateTabId,
} from "@/types/vault";
import {
  clearRoomPassword,
  decryptVault,
  encryptVault,
  getSavedRoomPassword,
  getStoredSettings,
  recordRecentRoom,
  saveRoomPassword,
  saveStoredSettings,
} from "@/lib/crypto";
import {
  computeTextStats,
  createDateStamp,
  deduplicateLines,
  formatBytes,
  formatJsonText,
  removeEmptyLines,
  sortLines,
  trimTrailingWhitespace,
} from "@/lib/scanner";
import CodeEditor, {
  CodeEditorHandle,
  CursorStats,
  SearchMatchSummary,
  SearchOptions,
} from "@/components/CodeEditor";
import FindReplaceBar from "@/components/FindReplaceBar";
import ScannerModal from "@/components/ScannerModal";
import HistoryDrawer from "@/components/HistoryDrawer";
import SettingsModal from "@/components/SettingsModal";

type AuthPhase = "checking" | "create" | "unlock" | "ready";

function serializeVaultForDiff(vault: VaultData | null): string {
  if (!vault) return "";
  return JSON.stringify(
    vault.tabs.map((t) => ({
      id: t.id,
      title: t.title,
      content: t.content,
      language: t.language,
      wordWrap: t.wordWrap,
      bookmarks: t.bookmarks,
    }))
  );
}

function serializeTabForDiff(tab: NoteTab | undefined): string {
  if (!tab) return "";
  return JSON.stringify({
    title: tab.title,
    content: tab.content,
    language: tab.language,
    wordWrap: tab.wordWrap,
    bookmarks: tab.bookmarks,
  });
}

export default function VaultWorkspace({ room }: { room: string }) {
  const router = useRouter();
  const normalizedRoom = room.trim().toLowerCase();

  // Auth & Vault Lifecycle
  const [phase, setPhase] = useState<AuthPhase>("checking");
  const [serverCiphertext, setServerCiphertext] = useState("");
  const [storageBackend, setStorageBackend] = useState<string>("");
  const [activePassword, setActivePassword] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [confirmPasswordInput, setConfirmPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [authWorking, setAuthWorking] = useState(false);

  // Vault State
  const [vault, setVault] = useState<VaultData | null>(null);
  const [savedVaultSnapshot, setSavedVaultSnapshot] = useState<VaultData | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Editor Settings & UI State
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
  const [focusedPane, setFocusedPane] = useState<"primary" | "split">("primary");
  const [cursorStats, setCursorStats] = useState<CursorStats>({
    line: 1,
    col: 1,
    selChars: 0,
    selLines: 0,
  });

  // Inline Tab Rename
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Modals / Drawers / Menus
  const [findOpen, setFindOpen] = useState(false);
  const [findShowReplace, setFindShowReplace] = useState(false);
  const [findSummary, setFindSummary] = useState<SearchMatchSummary>({
    total: 0,
    currentIndex: 0,
  });
  const [scannerOpen, setScannerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [goToLineInput, setGoToLineInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type?: "info" | "success" | "error" } | null>(
    null
  );
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Refs
  const primaryEditorRef = useRef<CodeEditorHandle | null>(null);
  const splitEditorRef = useRef<CodeEditorHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (msg: string, type: "info" | "success" | "error" = "info") => {
      setToast({ msg, type });
      setTimeout(() => {
        setToast((cur) => (cur?.msg === msg ? null : cur));
      }, 2800);
    },
    []
  );

  // Load saved UI settings once on mount
  useEffect(() => {
    setSettings(getStoredSettings(DEFAULT_SETTINGS));
  }, []);

  const handleUpdateSettings = useCallback(
    (next: EditorSettings) => {
      setSettings(next);
      saveStoredSettings(next);
      if (activePassword) {
        saveRoomPassword(normalizedRoom, activePassword, next.sessionTtlMinutes);
      }
    },
    [activePassword, normalizedRoom]
  );

  // Compute exact undo-aware dirty status (for whole vault & per tab!)
  const isVaultDirty = useMemo(() => {
    if (!vault || !savedVaultSnapshot) return false;
    return serializeVaultForDiff(vault) !== serializeVaultForDiff(savedVaultSnapshot);
  }, [vault, savedVaultSnapshot]);

  const savedTabMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!savedVaultSnapshot) return map;
    for (const t of savedVaultSnapshot.tabs) {
      map.set(t.id, serializeTabForDiff(t));
    }
    return map;
  }, [savedVaultSnapshot]);

  const isTabDirty = useCallback(
    (tab: NoteTab) => {
      const saved = savedTabMap.get(tab.id);
      if (!saved) return true;
      return saved !== serializeTabForDiff(tab);
    },
    [savedTabMap]
  );

  const activeTab = useMemo(() => {
    if (!vault) return null;
    return vault.tabs.find((t) => t.id === vault.activeTabId) ?? vault.tabs[0] ?? null;
  }, [vault]);

  const splitTab = useMemo(() => {
    if (!vault || !vault.splitTabId) return null;
    return vault.tabs.find((t) => t.id === vault.splitTabId) ?? null;
  }, [vault]);

  const focusedTab = focusedPane === "split" && splitTab ? splitTab : activeTab;
  const getFocusedEditor = () =>
    focusedPane === "split" && splitTab ? splitEditorRef.current : primaryEditorRef.current;

  const activeStats = useMemo(
    () => computeTextStats(focusedTab?.content ?? ""),
    [focusedTab?.content]
  );

  // Initial fetch + zero-flicker auto-unlock
  useEffect(() => {
    let cancelled = false;

    async function bootstrapRoom() {
      setPhase("checking");
      setAuthError("");

      try {
        const res = await fetch(`/api/vault/${encodeURIComponent(normalizedRoom)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Invalid room name");
        }
        if (cancelled) return;

        setStorageBackend(data.storage || "");
        if (data.updatedAt) setLastSavedAt(data.updatedAt);

        if (!data.exists || !data.ciphertext) {
          setServerCiphertext("");
          setPhase("create");
          return;
        }

        setServerCiphertext(data.ciphertext);

        // Check URL hash (#password) or remembered browser session
        const hashPwd = window.location.hash.length > 1
          ? decodeURIComponent(window.location.hash.slice(1))
          : "";
        const cachedPwd = getSavedRoomPassword(normalizedRoom);
        const autoPwd = hashPwd || cachedPwd;

        if (autoPwd) {
          try {
            const decrypted = await decryptVault(data.ciphertext, autoPwd);
            if (cancelled) return;
            const currentSettings = getStoredSettings(DEFAULT_SETTINGS);
            setActivePassword(autoPwd);
            setVault(decrypted);
            setSavedVaultSnapshot(structuredClone(decrypted));
            saveRoomPassword(normalizedRoom, autoPwd, currentSettings.sessionTtlMinutes);
            recordRecentRoom(normalizedRoom);
            setPhase("ready");
            return;
          } catch {
            clearRoomPassword(normalizedRoom);
          }
        }

        setPhase("unlock");
      } catch (err) {
        if (!cancelled) {
          setAuthError(err instanceof Error ? err.message : "Failed to load vault");
          setPhase("unlock");
        }
      }
    }

    bootstrapRoom();
    return () => {
      cancelled = true;
    };
  }, [normalizedRoom]);

  // Warn before closing tab with unsaved changes
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isVaultDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isVaultDirty]);

  // Save Vault (Encrypt & Upload to Blob / Local FS)
  const saveVaultNow = useCallback(
    async (vaultOverride?: VaultData, passwordOverride?: string) => {
      const targetVault = vaultOverride ?? vault;
      const targetPwd = passwordOverride ?? activePassword;
      if (!targetVault || !targetPwd || saving) return;

      setSaving(true);
      try {
        const ciphertext = await encryptVault(targetVault, targetPwd);
        const res = await fetch(`/api/vault/${encodeURIComponent(normalizedRoom)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ciphertext }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Save failed");
        }
        setServerCiphertext(ciphertext);
        setSavedVaultSnapshot(structuredClone(targetVault));
        setLastSavedAt(data.updatedAt || Date.now());
        saveRoomPassword(normalizedRoom, targetPwd, settings.sessionTtlMinutes);
        recordRecentRoom(normalizedRoom);
        showToast("Encrypted & saved to vault", "success");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Save failed", "error");
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [vault, activePassword, saving, normalizedRoom, settings.sessionTtlMinutes, showToast]
  );

  // Optional 3s Debounced Auto-Save
  useEffect(() => {
    if (!settings.autoSave || !isVaultDirty || phase !== "ready" || saving) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      void saveVaultNow();
    }, 3000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [settings.autoSave, isVaultDirty, phase, saving, saveVaultNow]);

  // Unlock Existing Vault
  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput) return;
    setAuthWorking(true);
    setAuthError("");
    try {
      const decrypted = await decryptVault(serverCiphertext, passwordInput);
      setActivePassword(passwordInput);
      setVault(decrypted);
      setSavedVaultSnapshot(structuredClone(decrypted));
      saveRoomPassword(normalizedRoom, passwordInput, settings.sessionTtlMinutes);
      recordRecentRoom(normalizedRoom);
      setPasswordInput("");
      setPhase("ready");
    } catch {
      setAuthError("Incorrect password. Decryption failed.");
    } finally {
      setAuthWorking(false);
    }
  };

  // Create New Vault
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput.length < 4) {
      setAuthError("Use at least 4 characters for your vault password.");
      return;
    }
    if (passwordInput !== confirmPasswordInput) {
      setAuthError("Passwords do not match.");
      return;
    }
    setAuthWorking(true);
    setAuthError("");
    try {
      const initial = createDefaultVault("notes.txt", "");
      const ciphertext = await encryptVault(initial, passwordInput);
      const res = await fetch(`/api/vault/${encodeURIComponent(normalizedRoom)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ciphertext }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not create vault");
      }
      setServerCiphertext(ciphertext);
      setActivePassword(passwordInput);
      setVault(initial);
      setSavedVaultSnapshot(structuredClone(initial));
      setLastSavedAt(data.updatedAt || Date.now());
      saveRoomPassword(normalizedRoom, passwordInput, settings.sessionTtlMinutes);
      recordRecentRoom(normalizedRoom);
      setPasswordInput("");
      setConfirmPasswordInput("");
      setPhase("ready");
      showToast(`Created encrypted vault /${normalizedRoom}`, "success");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setAuthWorking(false);
    }
  };

  // Tab Operations
  const updateTabById = useCallback((tabId: string, updater: (t: NoteTab) => NoteTab) => {
    setVault((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tabs: prev.tabs.map((t) => (t.id === tabId ? updater(t) : t)),
      };
    });
  }, []);

  const handleAddTab = (title?: string, content = "", language?: LanguageMode) => {
    setVault((prev) => {
      if (!prev) return prev;
      const nextNum = prev.tabs.length + 1;
      const tab = createNewTab(title || `note-${nextNum}.txt`, content, language);
      return {
        ...prev,
        activeTabId: tab.id,
        tabs: [...prev.tabs, tab],
      };
    });
    setFocusedPane("primary");
  };

  const handleCloseTab = (tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!vault) return;
    if (vault.tabs.length <= 1) {
      showToast("You need at least one open tab.", "info");
      return;
    }
    const target = vault.tabs.find((t) => t.id === tabId);
    if (target && isTabDirty(target)) {
      if (!window.confirm(`"${target.title}" has unsaved changes. Close this tab?`)) {
        return;
      }
    }
    setVault((prev) => {
      if (!prev || prev.tabs.length <= 1) return prev;
      const idx = prev.tabs.findIndex((t) => t.id === tabId);
      const remaining = prev.tabs.filter((t) => t.id !== tabId);
      const nextActive =
        prev.activeTabId === tabId
          ? remaining[Math.max(0, idx - 1)].id
          : prev.activeTabId;
      const nextSplit = prev.splitTabId === tabId ? null : prev.splitTabId;
      return {
        ...prev,
        activeTabId: nextActive,
        splitTabId: nextSplit === nextActive ? null : nextSplit,
        tabs: remaining,
      };
    });
  };

  const startRenameTab = (tab: NoteTab) => {
    setRenamingTabId(tab.id);
    setRenameValue(tab.title);
  };

  const commitRenameTab = () => {
    if (!renamingTabId) return;
    const cleaned = renameValue.trim();
    if (cleaned) {
      updateTabById(renamingTabId, (t) => ({
        ...t,
        title: cleaned,
        language: detectLanguageFromFilename(cleaned),
        updatedAt: Date.now(),
      }));
    }
    setRenamingTabId(null);
  };

  const handleToggleSplit = () => {
    setVault((prev) => {
      if (!prev) return prev;
      if (prev.splitTabId) {
        setFocusedPane("primary");
        return { ...prev, splitTabId: null };
      }
      const other = prev.tabs.find((t) => t.id !== prev.activeTabId);
      if (other) {
        return { ...prev, splitTabId: other.id };
      }
      // If only 1 tab exists, spin up a scratch tab on the right pane!
      const scratch = createNewTab("scratch.txt", "");
      return {
        ...prev,
        tabs: [...prev.tabs, scratch],
        splitTabId: scratch.id,
      };
    });
  };

  // File Import (File Picker or Drag & Drop)
  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const created: NoteTab[] = [];
    for (const file of list) {
      const text = await file.text();
      created.push(createNewTab(file.name, text));
    }

    setVault((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        activeTabId: created[0].id,
        tabs: [...prev.tabs, ...created],
      };
    });
    showToast(
      created.length === 1
        ? `Imported "${created[0].title}" into a new tab`
        : `Imported ${created.length} files into new tabs`,
      "success"
    );
  };

  // Export Downloads
  const downloadFile = (filename: string, content: string, mime = "text/plain;charset=utf-8") => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportCurrentTab = () => {
    if (!focusedTab) return;
    const ext = LANGUAGE_EXTENSIONS[focusedTab.language] || "txt";
    const filename = focusedTab.title.includes(".")
      ? focusedTab.title
      : `${focusedTab.title}.${ext}`;
    downloadFile(filename, focusedTab.content);
    showToast(`Downloaded ${filename}`, "success");
  };

  const handleExportFullBackup = () => {
    if (!vault) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(
      `zeropad-${normalizedRoom}-${stamp}.json`,
      JSON.stringify(vault, null, 2),
      "application/json"
    );
    showToast("Downloaded decrypted vault backup (.json)", "success");
  };

  // Notepad++ Text Transformations (dispatched through CodeMirror so Cmd+Z undoes them!)
  const applyTextTransform = (
    name: string,
    fn: (text: string) => { result: string; note?: string } | { error: string }
  ) => {
    if (!focusedTab) return;
    const outcome = fn(focusedTab.content);
    if ("error" in outcome) {
      showToast(outcome.error, "error");
      return;
    }
    getFocusedEditor()?.replaceFullDocument(outcome.result);
    showToast(outcome.note ? `${name} (${outcome.note})` : name, "success");
    setToolsMenuOpen(false);
  };

  // Scanner Jump-to-Match
  const handleJumpToScannerMatch = (match: ScannerMatch) => {
    setVault((prev) => {
      if (!prev) return prev;
      return { ...prev, activeTabId: match.tabId };
    });
    setFocusedPane("primary");
    // Wait one animation frame for CodeMirror tab switch to settle
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        primaryEditorRef.current?.jumpToRange(match.startOffset, match.endOffset);
      });
    });
  };

  // Global Keyboard Shortcuts (Notepad++ & Modern IDE standard)
  useEffect(() => {
    if (phase !== "ready") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + S → Save
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (isVaultDirty && !saving) {
          void saveVaultNow();
        }
        return;
      }

      // Cmd/Ctrl + Shift + F → Boolean Block Scanner
      if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(false);
        setScannerOpen(true);
        return;
      }

      // Cmd/Ctrl + F → Find Bar
      if (mod && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindShowReplace(false);
        setFindOpen(true);
        return;
      }

      // Cmd/Ctrl + H → Find & Replace Bar
      if (mod && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setFindShowReplace(true);
        setFindOpen(true);
        return;
      }

      // Cmd/Ctrl + G → Go to Line
      if (mod && !e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setGoToLineInput(String(cursorStats.line));
        setGoToLineOpen(true);
        return;
      }

      // Cmd/Ctrl + Shift + D → Insert Date Header Stamp
      if (mod && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        getFocusedEditor()?.insertAtCursor(`${createDateStamp()}\n`);
        return;
      }

      // Cmd/Ctrl + F2 → Toggle Bookmark | F2 → Jump Next Bookmark
      if (e.key === "F2") {
        e.preventDefault();
        if (mod) {
          getFocusedEditor()?.toggleBookmarkAtCursor();
        } else {
          getFocusedEditor()?.jumpToNextBookmark();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, isVaultDirty, saving, saveVaultNow, cursorStats.line]);

  // Close menus on outside click
  useEffect(() => {
    if (!toolsMenuOpen) return;
    const close = () => setToolsMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [toolsMenuOpen]);

  // Find & Replace wiring
  const handleFindOptionsChange = useCallback(
    (opts: SearchOptions) => {
      const ed = getFocusedEditor();
      if (!ed) return;
      setFindSummary(ed.updateSearchHighlights(opts));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedPane, splitTab?.id]
  );

  const handleFindClose = () => {
    setFindOpen(false);
    primaryEditorRef.current?.updateSearchHighlights(null);
    splitEditorRef.current?.updateSearchHighlights(null);
    getFocusedEditor()?.focus();
  };

  // ==========================================
  // Render: Checking / Unlock / Create Screens
  // ==========================================

  if (phase === "checking") {
    return (
      <div className="h-screen w-screen bg-[#0b0e14] flex flex-col items-center justify-center gap-3 text-[#8b949e]">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
        <p className="text-xs font-mono">Connecting to encrypted vault /{normalizedRoom}...</p>
      </div>
    );
  }

  if (phase === "unlock" || phase === "create") {
    const isCreate = phase === "create";
    return (
      <div className="h-screen w-screen bg-[#0b0e14] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-[#131820] border border-[#2b323d] p-7 shadow-2xl shadow-black/60 space-y-5">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs text-[#8b949e] hover:text-white transition-colors"
            >
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-white">ZeroPad</span>
            </Link>
            <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-[#1b222c] text-emerald-400 border border-emerald-500/20">
              /{normalizedRoom}
            </span>
          </div>

          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-white">
              {isCreate ? "Create New Encrypted Vault" : "Unlock Vault"}
            </h1>
            <p className="text-xs text-[#8b949e] leading-relaxed">
              {isCreate
                ? "This room does not exist yet. Set a password to encrypt your multi-tab workspace locally before saving."
                : "Enter your password to decrypt this vault in your browser. ZeroPad never sends your password to the server."}
            </p>
          </div>

          <form
            onSubmit={isCreate ? handleCreateSubmit : handleUnlockSubmit}
            className="space-y-3"
          >
            <div>
              <label className="block text-xs text-[#c9d1d9] mb-1">Password</label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter vault password"
                autoFocus
                required
                autoComplete={isCreate ? "new-password" : "current-password"}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0b0e14] border border-[#30363d] focus:border-emerald-500 text-sm text-white outline-none"
              />
            </div>

            {isCreate ? (
              <div>
                <label className="block text-xs text-[#c9d1d9] mb-1">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPasswordInput}
                  onChange={(e) => setConfirmPasswordInput(e.target.value)}
                  placeholder="Re-enter vault password"
                  required
                  autoComplete="new-password"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0b0e14] border border-[#30363d] focus:border-emerald-500 text-sm text-white outline-none"
                />
              </div>
            ) : null}

            {authError ? (
              <p className="text-xs text-rose-400 bg-rose-950/30 border border-rose-500/30 rounded-lg px-3 py-2">
                {authError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={authWorking}
              className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#0b0e14] font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {authWorking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isCreate ? "Encrypting & creating..." : "Decrypting..."}</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>{isCreate ? "Create Encrypted Vault" : "Unlock Vault"}</span>
                </>
              )}
            </button>
          </form>

          <div className="pt-2 border-t border-[#1f2630] flex items-center justify-between text-[11px] text-[#6e7681]">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/80" />
              AES-256-GCM • 200k PBKDF2
            </span>
            <span>Session cached {settings.sessionTtlMinutes}m</span>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // Render: Main Notepad++ Workspace
  // ==========================================

  if (!vault || !activeTab) return null;

  return (
    <div
      className="h-screen w-screen flex flex-col bg-[#0b0e14] text-[#e6edf3] overflow-hidden relative"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) {
          void importFiles(e.dataTransfer.files);
        }
      }}
    >
      {/* Hidden File Picker */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            void importFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />

      {/* Drag & Drop Overlay */}
      {dragOver ? (
        <div className="fixed inset-0 z-50 bg-emerald-950/70 backdrop-blur-sm border-2 border-dashed border-emerald-400 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <Upload className="w-10 h-10 text-emerald-300" />
          <p className="text-base font-semibold text-white">Drop files to import into new tabs</p>
        </div>
      ) : null}

      {/* Top Command Toolbar */}
      <header className="h-11 px-3 bg-[#131820] border-b border-[#21262d] flex items-center justify-between gap-2 shrink-0">
        {/* Left: Brand + Room Slug + Status */}
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/"
            title="Switch Vault"
            className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[#1d2430] transition-colors shrink-0"
          >
            <div className="w-5 h-5 rounded bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
              <Lock className="w-3 h-3 text-[#0b0e14] stroke-[2.5]" />
            </div>
            <span className="font-semibold text-xs text-white hidden sm:inline">ZeroPad</span>
          </Link>

          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.origin + "/" + normalizedRoom);
                setCopiedUrl(true);
                setTimeout(() => setCopiedUrl(false), 1500);
              } catch {
                // Ignore
              }
            }}
            title="Copy vault URL"
            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#0b0e14] border border-[#262e3a] hover:border-[#3c485a] text-xs font-mono text-[#c9d1d9] truncate max-w-[160px] cursor-pointer"
          >
            <span className="truncate">/{normalizedRoom}</span>
            {copiedUrl ? (
              <Check className="w-3 h-3 text-emerald-400 shrink-0" />
            ) : (
              <Copy className="w-3 h-3 text-[#6e7681] shrink-0" />
            )}
          </button>

          <span
            className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ${
              saving
                ? "bg-sky-500/20 text-sky-300"
                : isVaultDirty
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-emerald-500/15 text-emerald-400"
            }`}
          >
            {saving ? "Encrypting..." : isVaultDirty ? "Modified" : "Synced"}
          </span>
        </div>

        {/* Right: Power Actions */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setFindShowReplace(false);
              setFindOpen((v) => !v);
            }}
            title="Find & Replace (Cmd/Ctrl+F or Cmd/Ctrl+H)"
            className={`px-2.5 py-1.5 rounded-md text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              findOpen
                ? "bg-[#1f6feb]/25 text-sky-300 border border-[#1f6feb]/40"
                : "text-[#c9d1d9] hover:bg-[#1e2530]"
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Find</span>
          </button>

          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            title="Boolean Block Scanner (Cmd/Ctrl+Shift+F)"
            className="px-2.5 py-1.5 rounded-md text-xs inline-flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/25 transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Scanner</span>
          </button>

          <button
            type="button"
            onClick={handleToggleSplit}
            title="Toggle Dual Split Pane"
            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
              vault.splitTabId
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                : "text-[#8b949e] hover:bg-[#1e2530] hover:text-white"
            }`}
          >
            <Columns2 className="w-4 h-4" />
          </button>

          {/* Notepad++ Tools Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setToolsMenuOpen((v) => !v);
              }}
              title="Text Tools, Bookmarks, Import & Export"
              className={`px-2 py-1.5 rounded-md text-xs inline-flex items-center gap-1 transition-colors cursor-pointer ${
                toolsMenuOpen
                  ? "bg-[#21262d] text-white"
                  : "text-[#c9d1d9] hover:bg-[#1e2530]"
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Tools</span>
            </button>

            {toolsMenuOpen ? (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 mt-1.5 w-60 rounded-xl bg-[#161b22] border border-[#30363d] shadow-2xl shadow-black/70 py-1.5 z-40 text-xs"
              >
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">
                  Line Operations
                </div>
                <button
                  type="button"
                  onClick={() =>
                    applyTextTransform("Sorted lines A → Z", (txt) => ({
                      result: sortLines(txt, "asc"),
                    }))
                  }
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] cursor-pointer"
                >
                  Sort Lines Ascending (A → Z)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyTextTransform("Sorted lines Z → A", (txt) => ({
                      result: sortLines(txt, "desc"),
                    }))
                  }
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] cursor-pointer"
                >
                  Sort Lines Descending (Z → A)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyTextTransform("Removed duplicate lines", (txt) => {
                      const out = deduplicateLines(txt);
                      return { result: out.result, note: `${out.removed} removed` };
                    })
                  }
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] cursor-pointer"
                >
                  Remove Duplicate Lines
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyTextTransform("Removed empty lines", (txt) => {
                      const out = removeEmptyLines(txt);
                      return { result: out.result, note: `${out.removed} removed` };
                    })
                  }
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] cursor-pointer"
                >
                  Remove Empty Lines
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyTextTransform("Trimmed trailing spaces", (txt) => ({
                      result: trimTrailingWhitespace(txt),
                    }))
                  }
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] cursor-pointer"
                >
                  Trim Trailing Whitespace
                </button>

                <hr className="my-1 border-[#262e3a]" />
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">
                  Format &amp; Insert
                </div>
                <button
                  type="button"
                  onClick={() =>
                    applyTextTransform("Formatted JSON", (txt) => {
                      const out = formatJsonText(txt, false);
                      return out.ok ? { result: out.result } : { error: out.error };
                    })
                  }
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] cursor-pointer"
                >
                  Pretty-Print JSON
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyTextTransform("Minified JSON", (txt) => {
                      const out = formatJsonText(txt, true);
                      return out.ok ? { result: out.result } : { error: out.error };
                    })
                  }
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] cursor-pointer"
                >
                  Minify JSON
                </button>
                <button
                  type="button"
                  onClick={() => {
                    getFocusedEditor()?.insertAtCursor(`${createDateStamp()}\n`);
                    setToolsMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] flex items-center justify-between cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                    Insert Date Header
                  </span>
                  <span className="text-[10px] font-mono text-[#6e7681]">⌘⇧D</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    getFocusedEditor()?.toggleBookmarkAtCursor();
                    setToolsMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] flex items-center justify-between cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Bookmark className="w-3.5 h-3.5 text-amber-400" />
                    Toggle Bookmark
                  </span>
                  <span className="text-[10px] font-mono text-[#6e7681]">⌘F2</span>
                </button>

                <hr className="my-1 border-[#262e3a]" />
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">
                  Import &amp; Export
                </div>
                <button
                  type="button"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setToolsMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] flex items-center gap-2 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-sky-400" />
                  <span>Import File(s) into New Tab</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleExportCurrentTab();
                    setToolsMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Download Current Tab</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleExportFullBackup();
                    setToolsMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] flex items-center gap-2 cursor-pointer"
                >
                  <FilePlus className="w-3.5 h-3.5 text-violet-400" />
                  <span>Export All Tabs (.json)</span>
                </button>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            title="Encrypted Revision History (Last 10 Saves)"
            className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#1e2530] hover:text-violet-300 transition-colors cursor-pointer"
          >
            <History className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Workspace Settings & Security"
            className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#1e2530] hover:text-white transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => void saveVaultNow()}
            disabled={!isVaultDirty || saving}
            title="Encrypt & Save Vault (Cmd/Ctrl+S)"
            className={`ml-1 px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-all ${
              isVaultDirty && !saving
                ? "bg-emerald-500 hover:bg-emerald-400 text-[#0b0e14] cursor-pointer shadow-md shadow-emerald-500/20"
                : "bg-[#1c222b] text-[#6e7681] cursor-not-allowed"
            }`}
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Save</span>
            <span className="hidden sm:inline opacity-60 text-[10px] font-mono">(⌘S)</span>
          </button>
        </div>
      </header>

      {/* Multi-Tab Bar (Notepad++ Style) */}
      <div className="h-9 bg-[#0e1218] border-b border-[#21262d] flex items-center px-1.5 gap-1 overflow-x-auto shrink-0 select-none">
        {vault.tabs.map((tab) => {
          const isActive = tab.id === activeTab.id;
          const isSplit = tab.id === splitTab?.id;
          const dirty = isTabDirty(tab);
          const isRenaming = renamingTabId === tab.id;

          return (
            <div
              key={tab.id}
              onClick={() => {
                setVault((prev) => (prev ? { ...prev, activeTabId: tab.id } : prev));
                setFocusedPane("primary");
              }}
              onDoubleClick={() => startRenameTab(tab)}
              title="Double-click to rename tab"
              className={`group h-7 px-2.5 rounded-t-md flex items-center gap-2 text-xs font-mono border-t border-x transition-colors cursor-pointer shrink-0 max-w-[200px] ${
                isActive
                  ? "bg-[#0d1117] border-[#30363d] text-white"
                  : isSplit
                    ? "bg-[#131a24] border-cyan-500/30 text-cyan-200"
                    : "bg-transparent border-transparent text-[#8b949e] hover:bg-[#161b22] hover:text-[#c9d1d9]"
              }`}
            >
              {tab.language === "plain" ? (
                <FileText className="w-3 h-3 text-[#6e7681] shrink-0" />
              ) : (
                <FileCode2 className="w-3 h-3 text-emerald-400/80 shrink-0" />
              )}

              {isRenaming ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRenameTab}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRenameTab();
                    if (e.key === "Escape") setRenamingTabId(null);
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  className="w-24 bg-[#161b22] border border-emerald-500 rounded px-1 text-xs text-white outline-none"
                />
              ) : (
                <span className="truncate">{tab.title}</span>
              )}

              {dirty ? (
                <span
                  title="Unsaved changes"
                  className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                />
              ) : null}

              {vault.tabs.length > 1 ? (
                <button
                  type="button"
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  title="Close tab"
                  className="p-0.5 rounded text-[#6e7681] hover:text-white hover:bg-[#262e3a] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              ) : null}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => handleAddTab()}
          title="New Tab"
          className="h-7 w-7 rounded-md flex items-center justify-center text-[#8b949e] hover:text-white hover:bg-[#1b222c] transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Main Editor Area (Single or Split Pane) */}
      <main className="flex-1 flex min-h-0 relative">
        {/* Docked Find & Replace Bar */}
        <FindReplaceBar
          open={findOpen}
          initialShowReplace={findShowReplace}
          summary={findSummary}
          onOptionsChange={handleFindOptionsChange}
          onStep={(opts, dir) => {
            const ed = getFocusedEditor();
            if (ed) setFindSummary(ed.findStep(opts, dir));
          }}
          onReplaceOne={(opts) => {
            const ed = getFocusedEditor();
            if (ed) setFindSummary(ed.replaceCurrent(opts));
          }}
          onReplaceAll={(opts) => {
            const ed = getFocusedEditor();
            if (!ed) return;
            const res = ed.replaceAllMatches(opts);
            if (res.error) {
              showToast(res.error, "error");
            } else {
              setFindSummary({ total: 0, currentIndex: 0 });
              showToast(`Replaced ${res.replaced} occurrence(s) (⌘Z to undo)`, "success");
            }
          }}
          onClose={handleFindClose}
        />

        {/* Primary Editor Pane */}
        <div
          className={`flex-1 flex flex-col min-w-0 h-full ${
            splitTab ? "border-r border-[#262e3a]" : ""
          }`}
        >
          <CodeEditor
            ref={primaryEditorRef}
            tabId={activeTab.id}
            content={activeTab.content}
            language={activeTab.language}
            wordWrap={activeTab.wordWrap}
            bookmarks={activeTab.bookmarks}
            theme={settings.theme}
            fontSize={settings.fontSize}
            tabSize={settings.tabSize}
            showLineNumbers={settings.showLineNumbers}
            onChange={(next) =>
              updateTabById(activeTab.id, (t) => ({
                ...t,
                content: next,
                updatedAt: Date.now(),
              }))
            }
            onBookmarksChange={(nextBm) =>
              updateTabById(activeTab.id, (t) => ({ ...t, bookmarks: nextBm }))
            }
            onCursorChange={(stats) => {
              if (focusedPane === "primary") setCursorStats(stats);
            }}
            onFocusPane={() => setFocusedPane("primary")}
          />
        </div>

        {/* Optional Split Pane (Dual View) */}
        {splitTab ? (
          <div className="flex-1 flex flex-col min-w-0 h-full">
            <div className="h-8 px-3 bg-[#11161e] border-b border-[#21262d] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">
                  Split View
                </span>
                <select
                  value={splitTab.id}
                  onChange={(e) =>
                    setVault((prev) =>
                      prev ? { ...prev, splitTabId: e.target.value } : prev
                    )
                  }
                  className="bg-[#0b0e14] border border-[#2b323d] rounded px-2 py-0.5 text-xs font-mono text-white outline-none"
                >
                  {vault.tabs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() =>
                  setVault((prev) => (prev ? { ...prev, splitTabId: null } : prev))
                }
                title="Close split pane"
                className="p-1 rounded text-[#8b949e] hover:bg-[#21262d] hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <CodeEditor
                ref={splitEditorRef}
                tabId={splitTab.id}
                content={splitTab.content}
                language={splitTab.language}
                wordWrap={splitTab.wordWrap}
                bookmarks={splitTab.bookmarks}
                theme={settings.theme}
                fontSize={settings.fontSize}
                tabSize={settings.tabSize}
                showLineNumbers={settings.showLineNumbers}
                onChange={(next) =>
                  updateTabById(splitTab.id, (t) => ({
                    ...t,
                    content: next,
                    updatedAt: Date.now(),
                  }))
                }
                onBookmarksChange={(nextBm) =>
                  updateTabById(splitTab.id, (t) => ({ ...t, bookmarks: nextBm }))
                }
                onCursorChange={(stats) => {
                  if (focusedPane === "split") setCursorStats(stats);
                }}
                onFocusPane={() => setFocusedPane("split")}
              />
            </div>
          </div>
        ) : null}
      </main>

      {/* Bottom Notepad++ Status Bar */}
      <footer className="h-7 px-3 bg-[#131820] border-t border-[#21262d] flex items-center justify-between gap-3 text-[11px] font-mono text-[#8b949e] shrink-0 select-none overflow-x-auto">
        <div className="flex items-center gap-3 shrink-0">
          {/* Language Selector */}
          {focusedTab ? (
            <select
              value={focusedTab.language}
              onChange={(e) =>
                updateTabById(focusedTab.id, (t) => ({
                  ...t,
                  language: e.target.value as LanguageMode,
                }))
              }
              title="Syntax Language Mode"
              className="bg-transparent hover:text-white text-emerald-400 outline-none cursor-pointer"
            >
              {(Object.keys(LANGUAGE_LABELS) as LanguageMode[]).map((lang) => (
                <option key={lang} value={lang} className="bg-[#161b22] text-white">
                  {LANGUAGE_LABELS[lang]}
                </option>
              ))}
            </select>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setGoToLineInput(String(cursorStats.line));
              setGoToLineOpen(true);
            }}
            title="Go to Line / Bookmarks (Cmd/Ctrl+G)"
            className="hover:text-white cursor-pointer"
          >
            Ln {cursorStats.line.toLocaleString()}, Col {cursorStats.col}
          </button>

          {cursorStats.selChars > 0 ? (
            <span className="text-sky-400">
              Sel: {cursorStats.selChars.toLocaleString()} chars ({cursorStats.selLines} ln)
            </span>
          ) : null}

          {focusedTab && focusedTab.bookmarks.length > 0 ? (
            <button
              type="button"
              onClick={() => getFocusedEditor()?.jumpToNextBookmark()}
              title="Jump to next bookmark (F2)"
              className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 cursor-pointer"
            >
              <Bookmark className="w-3 h-3 fill-amber-400" />
              <span>{focusedTab.bookmarks.length}</span>
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span>
            {activeStats.lines.toLocaleString()} lines • {activeStats.words.toLocaleString()} words •{" "}
            {formatBytes(activeStats.bytes)}
          </span>

          {focusedTab ? (
            <button
              type="button"
              onClick={() =>
                updateTabById(focusedTab.id, (t) => ({ ...t, wordWrap: !t.wordWrap }))
              }
              title="Toggle Word Wrap"
              className={`inline-flex items-center gap-1 cursor-pointer ${
                focusedTab.wordWrap ? "text-white" : "text-[#6e7681]"
              }`}
            >
              <WrapText className="w-3 h-3" />
              <span>{focusedTab.wordWrap ? "Wrap" : "NoWrap"}</span>
            </button>
          ) : null}

          <span className="hidden md:inline text-[#6e7681]">
            AES-256-GCM {storageBackend === "local-fs" ? "• Local" : "• Blob"}
          </span>

          {lastSavedAt ? (
            <span className="hidden sm:inline text-[#6e7681]">
              Saved {new Date(lastSavedAt).toLocaleTimeString()}
            </span>
          ) : null}
        </div>
      </footer>

      {/* Go To Line + Bookmarks Quick Modal */}
      {goToLineOpen && focusedTab ? (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-start justify-center pt-24 p-4"
          onClick={() => setGoToLineOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-[#161b22] border border-[#30363d] shadow-2xl p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const ln = Number(goToLineInput);
                if (Number.isFinite(ln) && ln >= 1) {
                  getFocusedEditor()?.jumpToLine(ln);
                }
                setGoToLineOpen(false);
              }}
              className="space-y-2"
            >
              <label className="block text-xs font-semibold text-white">
                Go to Line (1 – {activeStats.lines.toLocaleString()})
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  max={activeStats.lines}
                  value={goToLineInput}
                  onChange={(e) => setGoToLineInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setGoToLineOpen(false);
                  }}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-[#0d1117] border border-[#30363d] focus:border-emerald-500 text-sm font-mono text-white outline-none"
                />
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#0b0e14] text-xs font-semibold cursor-pointer"
                >
                  Jump
                </button>
              </div>
            </form>

            {focusedTab.bookmarks.length > 0 ? (
              <div className="pt-2 border-t border-[#262e3a] space-y-1.5">
                <div className="text-[11px] font-semibold text-amber-400 flex items-center gap-1">
                  <Bookmark className="w-3 h-3 fill-amber-400" />
                  Bookmarked Lines
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {focusedTab.bookmarks.map((ln) => {
                    const preview =
                      focusedTab.content.split("\n")[ln - 1]?.trim().slice(0, 50) || "(empty)";
                    return (
                      <button
                        key={ln}
                        type="button"
                        onClick={() => {
                          getFocusedEditor()?.jumpToLine(ln);
                          setGoToLineOpen(false);
                        }}
                        className="w-full text-left px-2 py-1 rounded hover:bg-[#21262d] text-xs font-mono text-[#c9d1d9] truncate cursor-pointer"
                      >
                        <span className="text-amber-400 mr-2">Ln {ln}:</span>
                        {preview}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Boolean Block Scanner Modal */}
      <ScannerModal
        open={scannerOpen}
        tabs={vault.tabs}
        activeTabId={activeTab.id}
        onJumpToMatch={handleJumpToScannerMatch}
        onExportMatchesToTab={(title, content) => {
          handleAddTab(title, content, "plain");
          showToast(`Opened matching results in "${title}"`, "success");
        }}
        onClose={() => setScannerOpen(false)}
      />

      {/* Revision History Drawer */}
      <HistoryDrawer
        open={historyOpen}
        room={normalizedRoom}
        password={activePassword}
        onRestoreVault={(restored) => {
          setVault(restored);
          showToast("Restored backup into workspace — press ⌘S to save", "info");
        }}
        onImportTab={(tab) => {
          const copy: NoteTab = {
            ...tab,
            id: generateTabId(),
            title: `${tab.title} (restored)`,
            updatedAt: Date.now(),
          };
          setVault((prev) =>
            prev ? { ...prev, activeTabId: copy.id, tabs: [...prev.tabs, copy] } : prev
          );
          showToast(`Opened "${copy.title}"`, "success");
        }}
        onClose={() => setHistoryOpen(false)}
      />

      {/* Settings & Security Modal */}
      <SettingsModal
        open={settingsOpen}
        room={normalizedRoom}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onChangePassword={async (nextPwd) => {
          if (!vault) return;
          await saveVaultNow(vault, nextPwd);
          setActivePassword(nextPwd);
          saveRoomPassword(normalizedRoom, nextPwd, settings.sessionTtlMinutes);
        }}
        onLockNow={() => {
          clearRoomPassword(normalizedRoom);
          setActivePassword("");
          setVault(null);
          setSavedVaultSnapshot(null);
          setPhase("unlock");
        }}
        onDeleteRoom={async () => {
          const res = await fetch(`/api/vault/${encodeURIComponent(normalizedRoom)}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            showToast("Failed to delete vault", "error");
            return;
          }
          clearRoomPassword(normalizedRoom);
          router.push("/");
        }}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Toast Notification */}
      {toast ? (
        <div
          className={`fixed bottom-10 right-4 z-50 px-3.5 py-2 rounded-lg text-xs font-medium shadow-xl border backdrop-blur-md transition-all ${
            toast.type === "error"
              ? "bg-rose-950/90 border-rose-500/50 text-rose-200"
              : toast.type === "success"
                ? "bg-emerald-950/90 border-emerald-500/50 text-emerald-200"
                : "bg-[#161b22]/95 border-[#30363d] text-[#e6edf3]"
          }`}
        >
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}
