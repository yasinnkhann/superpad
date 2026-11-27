"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bookmark,
  Calendar,
  Columns2,
  Command,
  Download,
  Eye,
  FileCode2,
  FilePlus,
  FileText,
  History,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  PanelLeft,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Undo2,
  Upload,
  WrapText,
  Wrench,
  X,
} from "lucide-react";
import {
  AuthUser,
  DEFAULT_SETTINGS,
  EditorSettings,
  EncryptedNoteDTO,
  LANGUAGE_EXTENSIONS,
  LANGUAGE_LABELS,
  LanguageMode,
  NoteMetadata,
  NoteRecord,
  ScannerMatch,
  detectLanguageFromFilename,
  extractNoteMetadata,
  generateNoteId,
} from "@/types/vault";
import {
  clearCachedUserKey,
  decryptNoteDTO,
  deriveUserKeys,
  encryptNotePayload,
  generateSaltBase64,
  getCachedUserKey,
  getStoredSettings,
  saveCachedUserKey,
  saveStoredSettings,
} from "@/lib/crypto";
import {
  clearInMemoryKey,
  getInMemoryKey,
  setInMemoryKey,
} from "@/lib/memoryKey";
import {
  clearUserDrafts,
  deleteEncryptedDraft,
  loadEncryptedDrafts,
  saveEncryptedDraft,
} from "@/lib/drafts";
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
import FileSidebar, { NOTE_DRAG_MIME } from "@/components/FileSidebar";
import FindReplaceBar from "@/components/FindReplaceBar";
import ScannerModal from "@/components/ScannerModal";
import HistoryDrawer from "@/components/HistoryDrawer";
import SettingsModal from "@/components/SettingsModal";
import CommandPalette, { PaletteCommand } from "@/components/CommandPalette";
import MarkdownPreview from "@/components/MarkdownPreview";
import BackupModal from "@/components/BackupModal";
import { createPlaintextBackupJson, type BackupNoteEntry } from "@/lib/backup";

type WorkspacePhase = "checking" | "locked" | "ready";
type MarkdownPreviewMode = "edit" | "split" | "preview";

interface ConflictState {
  noteId: string;
  localVersion: number;
  remoteNote: NoteRecord;
}

interface ToastState {
  id: number;
  msg: string;
  type?: "info" | "success" | "error";
  actionLabel?: string;
  onAction?: () => void;
}

interface PersistedWorkspace {
  openTabIds: string[];
  activeNoteId: string | null;
  splitNoteId: string | null;
  collapsedFolders: string[];
}

function getWorkspaceStorageKey(username: string): string {
  return `superpad:v2:workspace:${username}`;
}

function getFoldersStorageKey(username: string): string {
  return `superpad:v2:folders:${username}`;
}

function serializeNoteForDiff(note: NoteRecord | undefined): string {
  if (!note) return "";
  return JSON.stringify({
    title: note.title,
    folder: note.folder,
    content: note.content,
    language: note.language,
    wordWrap: note.wordWrap,
    bookmarks: note.bookmarks,
    pinned: note.pinned,
  });
}

export default function VaultWorkspace() {
  const router = useRouter();

  // Auth & Encryption State
  const [phase, setPhase] = useState<WorkspacePhase>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [dbBackend, setDbBackend] = useState<string>("");
  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null);
  const [serializedKey, setSerializedKey] = useState<string>("");
  const [unlockPwd, setUnlockPwd] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [lockNotice, setLockNotice] = useState("");

  // Notes & Tabs State
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [trashedNotes, setTrashedNotes] = useState<NoteRecord[]>([]);
  const [savedSnapshots, setSavedSnapshots] = useState<Map<string, string>>(new Map());
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [splitNoteId, setSplitNoteId] = useState<string | null>(null);
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [syncingCloud, setSyncingCloud] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  // Editor & UI State
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [focusedPane, setFocusedPane] = useState<"primary" | "split">("primary");
  const [mdPreviewMode, setMdPreviewMode] = useState<MarkdownPreviewMode>("edit");
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [goToLineInput, setGoToLineInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [historyDepth, setHistoryDepth] = useState<{ canUndo: boolean; canRedo: boolean }>({
    canUndo: false,
    canRedo: false,
  });

  // Refs
  const primaryEditorRef = useRef<CodeEditorHandle | null>(null);
  const splitEditorRef = useRef<CodeEditorHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastSeqRef = useRef(0);
  const lastSyncAtRef = useRef<number>(0);
  const lastActivityAtRef = useRef<number>(Date.now());
  const notesRef = useRef<NoteRecord[]>(notes);
  notesRef.current = notes;
  const dirtyNoteIdsRef = useRef<Set<string>>(new Set());

  const showToast = useCallback(
    (
      msg: string,
      type: "info" | "success" | "error" = "info",
      action?: { label: string; onAction: () => void }
    ) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      const id = ++toastSeqRef.current;
      setToast({
        id,
        msg,
        type,
        actionLabel: action?.label,
        onAction: action?.onAction,
      });
      toastTimerRef.current = setTimeout(
        () => {
          setToast((cur) => (cur?.id === id ? null : cur));
        },
        action ? 5500 : 3000
      );
    },
    []
  );

  useEffect(() => {
    setSettings(getStoredSettings(DEFAULT_SETTINGS));
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, []);

  const handleUpdateSettings = useCallback(
    (next: EditorSettings) => {
      setSettings(next);
      saveStoredSettings(next);
      if (user && serializedKey) {
        saveCachedUserKey(user.id, serializedKey, next.sessionTtlMinutes);
      }
    },
    [user, serializedKey]
  );

  // Derived Dirty Set (true undo-aware diff per note!)
  const dirtyNoteIds = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) {
      const saved = savedSnapshots.get(n.id);
      if (!saved || saved !== serializeNoteForDiff(n)) {
        set.add(n.id);
      }
    }
    return set;
  }, [notes, savedSnapshots]);
  dirtyNoteIdsRef.current = dirtyNoteIds;

  const notesById = useMemo(() => {
    const map = new Map<string, NoteRecord>();
    for (const n of notes) map.set(n.id, n);
    return map;
  }, [notes]);

  const activeNote = activeNoteId ? notesById.get(activeNoteId) ?? null : null;
  const splitNote = splitNoteId ? notesById.get(splitNoteId) ?? null : null;
  const focusedNote = focusedPane === "split" && splitNote ? splitNote : activeNote;
  const getFocusedEditor = () =>
    focusedPane === "split" && splitNote ? splitEditorRef.current : primaryEditorRef.current;

  const activeStats = useMemo(
    () => computeTextStats(focusedNote?.content ?? ""),
    [focusedNote?.content]
  );

  const totalAccountBytes = useMemo(
    () => notes.reduce((sum, n) => sum + n.sizeBytes, 0),
    [notes]
  );

  // Load & decrypt all notes for an authenticated user + recover encrypted IndexedDB drafts + restore tabs
  const loadAccountNotes = useCallback(
    async (authUser: AuthUser, key: CryptoKey) => {
      const res = await fetch("/api/notes", { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/");
        return;
      }
      const data = (await res.json()) as {
        notes: EncryptedNoteDTO[];
        trashedNotes?: EncryptedNoteDTO[];
        backend?: string;
      };
      if (data.backend) setDbBackend(data.backend);
      lastSyncAtRef.current = Date.now();

      const [decrypted, decryptedTrash] = await Promise.all([
        Promise.all((data.notes || []).map((dto) => decryptNoteDTO(dto, key))),
        Promise.all((data.trashedNotes || []).map((dto) => decryptNoteDTO(dto, key))),
      ]);

      // Build clean saved snapshots map
      const snapMap = new Map<string, string>();
      for (const n of decrypted) {
        snapMap.set(n.id, serializeNoteForDiff(n));
      }

      // Hard refresh or page reload strictly reverts to the last saved cloud snapshot
      // Clean up any stale IndexedDB crash-recovery drafts so unsaved edits do not haunt reloads
      void clearUserDrafts(authUser.id);

      setNotes(decrypted);
      setTrashedNotes(decryptedTrash);
      setSavedSnapshots(snapMap);

      let restoredTabs: string[] = [];
      let restoredActive: string | null = null;
      let restoredSplit: string | null = null;

      if (typeof window !== "undefined") {
        try {
          const savedFolders = localStorage.getItem(getFoldersStorageKey(authUser.username));
          if (savedFolders) {
            const parsed = JSON.parse(savedFolders);
            if (Array.isArray(parsed)) {
              setExtraFolders(parsed);
            }
          }
        } catch {}

        try {
          const rawWs = localStorage.getItem(getWorkspaceStorageKey(authUser.username));
          if (rawWs) {
            const parsedWs = JSON.parse(rawWs) as Partial<PersistedWorkspace>;
            const validIds = new Set(decrypted.map((n) => n.id));
            if (Array.isArray(parsedWs.openTabIds)) {
              restoredTabs = parsedWs.openTabIds.filter(
                (id): id is string => typeof id === "string" && validIds.has(id)
              );
            }
            if (typeof parsedWs.activeNoteId === "string" && validIds.has(parsedWs.activeNoteId)) {
              restoredActive = parsedWs.activeNoteId;
              if (!restoredTabs.includes(restoredActive)) {
                restoredTabs = [...restoredTabs, restoredActive];
              }
            }
            if (typeof parsedWs.splitNoteId === "string" && validIds.has(parsedWs.splitNoteId)) {
              restoredSplit = parsedWs.splitNoteId;
            }
            if (Array.isArray(parsedWs.collapsedFolders)) {
              setCollapsedFolders(
                new Set(parsedWs.collapsedFolders.filter((f): f is string => typeof f === "string"))
              );
            }
          }
        } catch {}
      }

      if (restoredTabs.length > 0) {
        setOpenTabIds(restoredTabs);
        setActiveNoteId(restoredActive ?? restoredTabs[0]);
        setSplitNoteId(restoredSplit);
      } else if (decrypted.length > 0) {
        const first = decrypted[0];
        setOpenTabIds([first.id]);
        setActiveNoteId(first.id);
        setSplitNoteId(null);
      } else {
        setOpenTabIds([]);
        setActiveNoteId(null);
        setSplitNoteId(null);
      }
      setLockNotice("");
      lastActivityAtRef.current = Date.now();
      setPhase("ready");
    },
    [router]
  );

  // Persist open tabs, active tab, split tab, and collapsed folders across reloads
  useEffect(() => {
    if (phase !== "ready" || !user?.username || typeof window === "undefined") return;
    try {
      const stateToSave: PersistedWorkspace = {
        openTabIds,
        activeNoteId,
        splitNoteId,
        collapsedFolders: Array.from(collapsedFolders),
      };
      localStorage.setItem(getWorkspaceStorageKey(user.username), JSON.stringify(stateToSave));
    } catch {}
  }, [phase, user?.username, openTabIds, activeNoteId, splitNoteId, collapsedFolders]);

  // Multi-device cloud sync (pull updates without ever clobbering local unsaved changes)
  const syncWithCloud = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!user || !encryptionKey || syncingCloud) return;
      setSyncingCloud(true);
      try {
        const res = await fetch("/api/notes", { cache: "no-store" });
        if (res.status === 401) {
          router.replace("/");
          return;
        }
        if (!res.ok) throw new Error("Sync failed");
        const data = (await res.json()) as {
          notes: EncryptedNoteDTO[];
          trashedNotes?: EncryptedNoteDTO[];
          backend?: string;
        };
        if (data.backend) setDbBackend(data.backend);
        lastSyncAtRef.current = Date.now();

        const [remoteNotes, remoteTrash] = await Promise.all([
          Promise.all((data.notes || []).map((dto) => decryptNoteDTO(dto, encryptionKey))),
          Promise.all((data.trashedNotes || []).map((dto) => decryptNoteDTO(dto, encryptionKey))),
        ]);

        const localNotes = notesRef.current;
        const localById = new Map(localNotes.map((n) => [n.id, n]));
        const dirtySet = dirtyNoteIdsRef.current;

        let updatedCount = 0;
        let addedCount = 0;
        let detectedConflict: ConflictState | null = null;
        const merged: NoteRecord[] = [];
        const remoteIds = new Set<string>();

        for (const rNote of remoteNotes) {
          remoteIds.add(rNote.id);
          const local = localById.get(rNote.id);
          if (!local) {
            merged.push(rNote);
            addedCount++;
          } else if (dirtySet.has(rNote.id)) {
            // Preserve unsaved local edits; flag conflict if another device saved a newer version
            merged.push(local);
            if (rNote.version > local.version && !detectedConflict) {
              detectedConflict = {
                noteId: rNote.id,
                localVersion: local.version,
                remoteNote: rNote,
              };
            }
          } else if (rNote.version !== local.version || rNote.updatedAt !== local.updatedAt) {
            merged.push(rNote);
            updatedCount++;
          } else {
            merged.push(local);
          }
        }

        // Keep any locally-dirty note even if another device trashed it
        for (const lNote of localNotes) {
          if (!remoteIds.has(lNote.id) && dirtySet.has(lNote.id)) {
            merged.push(lNote);
          }
        }

        setNotes(merged);
        setTrashedNotes(remoteTrash);
        setSavedSnapshots((prev) => {
          const next = new Map(prev);
          for (const rNote of remoteNotes) {
            if (!dirtySet.has(rNote.id)) {
              next.set(rNote.id, serializeNoteForDiff(rNote));
            }
          }
          return next;
        });

        // Clean up tabs for notes deleted on another device
        const mergedIds = new Set(merged.map((n) => n.id));
        setOpenTabIds((prev) => prev.filter((id) => mergedIds.has(id)));
        setActiveNoteId((cur) => (cur && mergedIds.has(cur) ? cur : merged[0]?.id ?? null));
        setSplitNoteId((cur) => (cur && mergedIds.has(cur) ? cur : null));

        if (detectedConflict) {
          setConflict(detectedConflict);
          showToast(
            `Sync conflict on "${detectedConflict.remoteNote.title}" — edited on another device`,
            "error"
          );
        } else if (updatedCount > 0 || addedCount > 0) {
          const parts: string[] = [];
          if (addedCount > 0) parts.push(`${addedCount} new`);
          if (updatedCount > 0) parts.push(`${updatedCount} updated`);
          showToast(`Synced from cloud (${parts.join(", ")})`, "info");
        } else if (!opts?.silent) {
          showToast("Vault is up to date", "success");
        }
      } catch (err) {
        if (!opts?.silent) {
          showToast(err instanceof Error ? err.message : "Could not sync", "error");
        }
      } finally {
        setSyncingCloud(false);
      }
    },
    [user, encryptionKey, syncingCloud, router, showToast]
  );

  // Automatic multi-device sync when returning to the browser tab (throttled to 15s)
  useEffect(() => {
    if (phase !== "ready" || !user || !encryptionKey) return;
    const maybeSync = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastSyncAtRef.current < 15_000) return;
      void syncWithCloud({ silent: true });
    };
    window.addEventListener("focus", maybeSync);
    document.addEventListener("visibilitychange", maybeSync);
    return () => {
      window.removeEventListener("focus", maybeSync);
      document.removeEventListener("visibilitychange", maybeSync);
    };
  }, [phase, user, encryptionKey, syncWithCloud]);

  // Bootstrap: check HttpOnly session -> check in-memory / cached key -> zero-flicker unlock!
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setPhase("checking");
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = (await res.json()) as {
          authenticated: boolean;
          user: AuthUser | null;
          backend?: string;
        };
        if (cancelled) return;
        if (!data.authenticated || !data.user) {
          router.replace("/");
          return;
        }

        setUser(data.user);
        if (data.backend) setDbBackend(data.backend);

        // Try in-memory key first (SPA transition from `/`), then localStorage TTL cache
        const mem = getInMemoryKey(data.user.id);
        const cached = mem ?? (await getCachedUserKey(data.user.id));

        if (cached && !cancelled) {
          setEncryptionKey(cached.key);
          setSerializedKey(cached.serializedKey);
          setInMemoryKey(data.user.id, cached.key, cached.serializedKey);
          await loadAccountNotes(data.user, cached.key);
          return;
        }

        if (!cancelled) setPhase("locked");
      } catch {
        if (!cancelled) router.replace("/");
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, [router, loadAccountNotes]);

  // Warn before closing window with unsaved changes
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyNoteIds.size > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyNoteIds.size]);

  // Unlock when session cookie is valid but browser key cache expired
  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !unlockPwd) return;
    setUnlocking(true);
    setUnlockError("");

    try {
      const derived = await deriveUserKeys(unlockPwd, user.kdfSalt);
      // Verify password against server auth verifier
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username, authKey: derived.authKey }),
      });
      if (!res.ok) {
        throw new Error("Incorrect master password.");
      }

      setEncryptionKey(derived.encryptionKey);
      setSerializedKey(derived.serializedKey);
      setInMemoryKey(user.id, derived.encryptionKey, derived.serializedKey);
      saveCachedUserKey(user.id, derived.serializedKey, settings.sessionTtlMinutes);
      setUnlockPwd("");
      await loadAccountNotes(user, derived.encryptionKey);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : "Unlock failed.");
    } finally {
      setUnlocking(false);
    }
  };

  // Schedule encrypted IndexedDB crash-recovery draft for a note
  const scheduleDraftBackup = useCallback(
    (updated: NoteRecord) => {
      if (!user || !encryptionKey) return;
      const existingTimer = draftTimersRef.current.get(updated.id);
      if (existingTimer) clearTimeout(existingTimer);

      const savedSnap = savedSnapshots.get(updated.id);
      if (savedSnap && savedSnap === serializeNoteForDiff(updated)) {
        // User undid back to clean state — remove any stale crash-recovery draft!
        void deleteEncryptedDraft(updated.id);
        return;
      }

      const timer = setTimeout(() => {
        void saveEncryptedDraft(
          user.id,
          updated.id,
          extractNoteMetadata(updated),
          updated.content,
          updated.version,
          encryptionKey
        );
      }, 900);
      draftTimersRef.current.set(updated.id, timer);
    },
    [user, encryptionKey, savedSnapshots]
  );

  // Mutate a note locally in React state + trigger crash-recovery draft
  const updateLocalNote = useCallback(
    (noteId: string, updater: (note: NoteRecord) => NoteRecord) => {
      setNotes((prev) =>
        prev.map((n) => {
          if (n.id !== noteId) return n;
          const next = updater(n);
          scheduleDraftBackup(next);
          return next;
        })
      );
    },
    [scheduleDraftBackup]
  );

  // Save a single note to Turso with Optimistic Concurrency Conflict Detection
  const saveNoteById = useCallback(
    async (noteId: string, opts?: { force?: boolean; noteOverride?: NoteRecord }) => {
      if (!user || !encryptionKey) return false;
      const target = opts?.noteOverride ?? notesById.get(noteId);
      if (!target) return false;

      setSavingIds((prev) => new Set(prev).add(noteId));
      try {
        const payload = await encryptNotePayload(
          extractNoteMetadata(target),
          target.content,
          encryptionKey
        );
        const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            expectedVersion: target.version,
            force: Boolean(opts?.force),
          }),
        });

        const data = await res.json();

        // Handle multi-device conflict cleanly!
        if (res.status === 409 && data.conflict && data.remoteNote) {
          const remoteDecrypted = await decryptNoteDTO(data.remoteNote, encryptionKey);
          setConflict({
            noteId,
            localVersion: target.version,
            remoteNote: remoteDecrypted,
          });
          showToast("Conflict detected: note was updated on another device", "error");
          return false;
        }

        if (!res.ok || !data.note) {
          throw new Error(data.error || "Failed to save note");
        }

        const syncedNote: NoteRecord = {
          ...target,
          version: data.note.version,
          sizeBytes: data.note.sizeBytes,
          updatedAt: data.note.updatedAt,
        };

        setNotes((prev) => prev.map((n) => (n.id === noteId ? syncedNote : n)));
        setSavedSnapshots((prev) => {
          const next = new Map(prev);
          next.set(noteId, serializeNoteForDiff(syncedNote));
          return next;
        });
        setConflict((cur) => (cur?.noteId === noteId ? null : cur));
        void deleteEncryptedDraft(noteId);
        if (serializedKey) {
          saveCachedUserKey(user.id, serializedKey, settings.sessionTtlMinutes);
        }
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Save failed", "error");
        return false;
      } finally {
        setSavingIds((prev) => {
          const next = new Set(prev);
          next.delete(noteId);
          return next;
        });
      }
    },
    [user, encryptionKey, notesById, serializedKey, settings.sessionTtlMinutes, showToast]
  );

  // Create a brand new encrypted note directly in Turso
  const createNoteOnServer = useCallback(
    async (
      title?: string,
      content = "",
      folder = "",
      language?: LanguageMode
    ): Promise<NoteRecord | null> => {
      if (!encryptionKey) return null;
      const finalTitle = title?.trim() || `note-${notes.length + 1}.txt`;
      const meta: NoteMetadata = {
        title: finalTitle,
        folder: folder.trim(),
        language: language ?? detectLanguageFromFilename(finalTitle),
        wordWrap: true,
        bookmarks: [],
        pinned: false,
      };
      const id = generateNoteId();
      try {
        const encrypted = await encryptNotePayload(meta, content, encryptionKey);
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...encrypted }),
        });
        const data = await res.json();
        if (!res.ok || !data.note) {
          throw new Error(data.error || "Could not create note");
        }
        const created: NoteRecord = {
          id: data.note.id,
          ...meta,
          content,
          version: data.note.version,
          sizeBytes: data.note.sizeBytes,
          createdAt: data.note.createdAt,
          updatedAt: data.note.updatedAt,
        };
        setNotes((prev) => [created, ...prev]);
        setSavedSnapshots((prev) => {
          const next = new Map(prev);
          next.set(created.id, serializeNoteForDiff(created));
          return next;
        });
        setOpenTabIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
        setActiveNoteId(created.id);
        setFocusedPane("primary");
        return created;
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Create note failed", "error");
        return null;
      }
    },
    [encryptionKey, notes.length, showToast]
  );

  const handleRestoreNote = useCallback(
    async (noteId: string) => {
      if (!encryptionKey) return;
      try {
        const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to restore note");

        let restored: NoteRecord | null = null;
        if (data.note) {
          restored = await decryptNoteDTO(data.note, encryptionKey);
        } else {
          const fromTrash = trashedNotes.find((n) => n.id === noteId);
          if (fromTrash) restored = { ...fromTrash, deletedAt: null };
        }

        if (restored) {
          const safeNote = restored;
          setTrashedNotes((prev) => prev.filter((n) => n.id !== noteId));
          setNotes((prev) => [safeNote, ...prev.filter((n) => n.id !== noteId)]);
          setSavedSnapshots((prev) => {
            const next = new Map(prev);
            next.set(safeNote.id, serializeNoteForDiff(safeNote));
            return next;
          });
          setOpenTabIds((prev) => (prev.includes(safeNote.id) ? prev : [...prev, safeNote.id]));
          setActiveNoteId(safeNote.id);
          setFocusedPane("primary");
          showToast(`Restored "${safeNote.title}"`, "success");
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Restore failed", "error");
      }
    },
    [encryptionKey, trashedNotes, showToast]
  );

  const handleDeleteNote = async (noteId: string, forcePermanent = false) => {
    const target = notesById.get(noteId);
    if (!target) return;

    // Empty / untouched notes delete permanently and silently so they don't clutter Trash
    const isEmpty = !target.content || target.content.trim() === "";
    const permanent = forcePermanent || isEmpty;

    try {
      const url = permanent
        ? `/api/notes/${encodeURIComponent(noteId)}?permanent=1`
        : `/api/notes/${encodeURIComponent(noteId)}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete note");
      const data = await res.json().catch(() => ({}));
      void deleteEncryptedDraft(noteId);

      const remainingNotes = notes.filter((n) => n.id !== noteId);
      const remainingTabs = openTabIds.filter((id) => id !== noteId);
      setNotes(remainingNotes);
      setOpenTabIds(remainingTabs);
      setSavedSnapshots((prev) => {
        const next = new Map(prev);
        next.delete(noteId);
        return next;
      });
      if (activeNoteId === noteId) {
        setActiveNoteId(remainingTabs[0] ?? remainingNotes[0]?.id ?? null);
      }
      if (splitNoteId === noteId) {
        setSplitNoteId(null);
      }

      if (permanent) {
        showToast(`Deleted "${target.title}"`, "info");
      } else {
        const trashed: NoteRecord = {
          ...target,
          deletedAt: typeof data.deletedAt === "number" ? data.deletedAt : Date.now(),
        };
        setTrashedNotes((prev) => [trashed, ...prev.filter((n) => n.id !== noteId)]);
        showToast(`Moved "${target.title}" to Trash`, "info", {
          label: "Undo",
          onAction: () => void handleRestoreNote(noteId),
        });
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  };

  const handlePermanentDeleteNote = async (noteId: string) => {
    const target = trashedNotes.find((n) => n.id === noteId);
    if (!target) return;
    if (!window.confirm(`Permanently delete "${target.title}" and its backup history?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}?permanent=1`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete note");
      setTrashedNotes((prev) => prev.filter((n) => n.id !== noteId));
      showToast(`Permanently deleted "${target.title}"`, "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  };

  const handleEmptyTrash = async () => {
    if (trashedNotes.length === 0) return;
    if (
      !window.confirm(
        `Permanently delete all ${trashedNotes.length} note${
          trashedNotes.length === 1 ? "" : "s"
        } in Trash? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/notes?trash=all`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to empty trash");
      setTrashedNotes([]);
      showToast("Trash emptied", "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to empty trash", "error");
    }
  };

  const handleSelectNote = (noteId: string) => {
    setOpenTabIds((prev) => (prev.includes(noteId) ? prev : [...prev, noteId]));
    setActiveNoteId(noteId);
    setFocusedPane("primary");
  };

  const handleCloseTab = (noteId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const target = notesById.get(noteId);
    if (target && dirtyNoteIds.has(noteId)) {
      if (
        !window.confirm(
          `"${target.title}" has unsaved changes. Close tab? (Unsaved changes remain locally until reload.)`
        )
      ) {
        return;
      }
    }

    // If an untouched, empty note is closed, automatically clean it up so empty ghost notes don't linger
    const isUntouchedEmpty =
      target &&
      (!target.content || target.content.trim() === "") &&
      target.version === 1 &&
      !target.pinned &&
      target.folder === "" &&
      !dirtyNoteIds.has(noteId);

    if (isUntouchedEmpty) {
      void handleDeleteNote(noteId, true);
      return;
    }

    setOpenTabIds((prev) => {
      const idx = prev.indexOf(noteId);
      const remaining = prev.filter((id) => id !== noteId);
      if (activeNoteId === noteId) {
        setActiveNoteId(remaining[Math.max(0, idx - 1)] ?? null);
      }
      return remaining;
    });
    if (splitNoteId === noteId) setSplitNoteId(null);
  };

  // Optional 3s Debounced Auto-Save for focused note
  useEffect(() => {
    if (!settings.autoSave || phase !== "ready" || !focusedNote) return;
    if (!dirtyNoteIds.has(focusedNote.id) || savingIds.has(focusedNote.id)) return;
    if (conflict?.noteId === focusedNote.id) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const targetId = focusedNote.id;
    autoSaveTimerRef.current = setTimeout(() => {
      void saveNoteById(targetId).then((ok) => {
        if (ok) showToast("Auto-saved", "success");
      });
    }, 3000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [
    settings.autoSave,
    phase,
    focusedNote,
    dirtyNoteIds,
    savingIds,
    conflict,
    saveNoteById,
    showToast,
  ]);

  // Save Current or Save All
  const handleSaveActive = useCallback(async () => {
    if (!focusedNote || !dirtyNoteIds.has(focusedNote.id)) return;
    const ok = await saveNoteById(focusedNote.id);
    if (ok) showToast(`Saved "${focusedNote.title}"`, "success");
  }, [focusedNote, dirtyNoteIds, saveNoteById, showToast]);

  const handleSaveAll = useCallback(async () => {
    const dirtyList = Array.from(dirtyNoteIds);
    if (dirtyList.length === 0) return;
    const results = await Promise.all(dirtyList.map((id) => saveNoteById(id)));
    const savedCount = results.filter(Boolean).length;
    if (savedCount > 0) {
      showToast(`Encrypted & saved ${savedCount} note(s)`, "success");
    }
  }, [dirtyNoteIds, saveNoteById, showToast]);

  // Rename & Folder Move (persist immediately if note wasn't already dirty, or mark modified)
  const handleRenameNote = (noteId: string, newTitle: string) => {
    const target = notesById.get(noteId);
    if (!target || target.title === newTitle) return;
    const updated: NoteRecord = {
      ...target,
      title: newTitle,
      language: detectLanguageFromFilename(newTitle),
      updatedAt: Date.now(),
    };
    setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
    void saveNoteById(noteId, { noteOverride: updated }).then((ok) => {
      if (ok) showToast(`Renamed to "${newTitle}"`, "success");
    });
  };

  const handleMoveNoteToFolder = (noteId: string, folder: string) => {
    const target = notesById.get(noteId);
    if (!target || target.folder === folder) return;
    const updated: NoteRecord = { ...target, folder, updatedAt: Date.now() };
    setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
    void saveNoteById(noteId, { noteOverride: updated }).then((ok) => {
      if (ok) showToast(folder ? `Moved to "${folder}"` : "Moved to root", "success");
    });
  };

  const handleTogglePinNote = (noteId: string) => {
    const target = notesById.get(noteId);
    if (!target) return;
    const updated: NoteRecord = { ...target, pinned: !target.pinned, updatedAt: Date.now() };
    setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
    void saveNoteById(noteId, { noteOverride: updated });
  };

  const handleCreateFolder = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setExtraFolders((prev) => {
      const next = prev.includes(trimmed) ? prev : [...prev, trimmed];
      if (user?.username && typeof window !== "undefined") {
        try {
          localStorage.setItem(getFoldersStorageKey(user.username), JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  };

  const handleRenameFolder = (oldName: string, newName: string) => {
    const trimmed = newName.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmed || trimmed === oldName) return;

    const affected = notes.filter((n) => n.folder === oldName);
    for (const note of affected) {
      const updated: NoteRecord = { ...note, folder: trimmed, updatedAt: Date.now() };
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      void saveNoteById(note.id, { noteOverride: updated });
    }

    setExtraFolders((prev) => {
      const replaced = prev.map((f) => (f === oldName ? trimmed : f));
      const next = Array.from(new Set(replaced.includes(trimmed) ? replaced : [...replaced, trimmed]));
      if (user?.username && typeof window !== "undefined") {
        try {
          localStorage.setItem(getFoldersStorageKey(user.username), JSON.stringify(next));
        } catch {}
      }
      return next;
    });

    setCollapsedFolders((prev) => {
      if (!prev.has(oldName)) return prev;
      const next = new Set(prev);
      next.delete(oldName);
      next.add(trimmed);
      return next;
    });

    showToast(`Renamed folder "${oldName}" → "${trimmed}"`, "success");
  };

  const handleToggleFolder = (folderName: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) next.delete(folderName);
      else next.add(folderName);
      return next;
    });
  };

  const handleDeleteFolder = (folderName: string) => {
    const notesInFolder = notes.filter((n) => n.folder === folderName);
    if (notesInFolder.length > 0) {
      if (
        !window.confirm(
          `Delete folder "${folderName}"? ${notesInFolder.length} note${
            notesInFolder.length === 1 ? "" : "s"
          } inside will be moved to root.`
        )
      ) {
        return;
      }
      for (const note of notesInFolder) {
        const updated: NoteRecord = { ...note, folder: "", updatedAt: Date.now() };
        setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
        void saveNoteById(note.id, { noteOverride: updated });
      }
    }

    setExtraFolders((prev) => {
      const next = prev.filter((f) => f !== folderName);
      if (user?.username && typeof window !== "undefined") {
        try {
          localStorage.setItem(getFoldersStorageKey(user.username), JSON.stringify(next));
        } catch {}
      }
      return next;
    });

    showToast(`Deleted folder "${folderName}"`, "info");
  };

  const handleToggleMarkdownCheckbox = useCallback(
    (lineIndex: number) => {
      if (!activeNote) return;
      const lines = activeNote.content.split("\n");
      const currentLine = lines[lineIndex];
      if (currentLine === undefined) return;
      const toggled = currentLine.replace(/^(\s*[-*+]\s+\[)([ xX])(\])/, (_, pre, mark, post) => {
        return `${pre}${mark.toLowerCase() === "x" ? " " : "x"}${post}`;
      });
      if (toggled === currentLine) return;
      lines[lineIndex] = toggled;
      const nextContent = lines.join("\n");
      updateLocalNote(activeNote.id, (n) => ({
        ...n,
        content: nextContent,
        sizeBytes: new TextEncoder().encode(nextContent).length,
      }));
    },
    [activeNote, updateLocalNote]
  );

  const handleRestoreBackup = useCallback(
    async (entries: BackupNoteEntry[], folders: string[]): Promise<number> => {
      if (!encryptionKey) return 0;

      if (folders.length > 0) {
        setExtraFolders((prev) => {
          const next = Array.from(new Set([...prev, ...folders]));
          if (user?.username && typeof window !== "undefined") {
            try {
              localStorage.setItem(getFoldersStorageKey(user.username), JSON.stringify(next));
            } catch {}
          }
          return next;
        });
      }

      let importedCount = 0;
      let firstCreatedId: string | null = null;
      const createdList: NoteRecord[] = [];

      for (const entry of entries) {
        const meta: NoteMetadata = {
          title: entry.title,
          folder: entry.folder,
          language: entry.language,
          wordWrap: entry.wordWrap,
          bookmarks: entry.bookmarks,
          pinned: entry.pinned,
        };
        const id = generateNoteId();
        const encrypted = await encryptNotePayload(meta, entry.content, encryptionKey);
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...encrypted }),
        });
        const data = await res.json();
        if (res.ok && data.note) {
          const created: NoteRecord = {
            id: data.note.id,
            ...meta,
            content: entry.content,
            version: data.note.version,
            sizeBytes: data.note.sizeBytes,
            createdAt: data.note.createdAt,
            updatedAt: data.note.updatedAt,
            deletedAt: null,
          };
          createdList.push(created);
          if (!firstCreatedId) firstCreatedId = created.id;
          importedCount++;
        }
      }

      if (createdList.length > 0) {
        setNotes((prev) => [...createdList, ...prev]);
        setSavedSnapshots((prev) => {
          const next = new Map(prev);
          for (const c of createdList) {
            next.set(c.id, serializeNoteForDiff(c));
          }
          return next;
        });
        if (firstCreatedId) {
          setOpenTabIds((prev) =>
            prev.includes(firstCreatedId!) ? prev : [...prev, firstCreatedId!]
          );
          setActiveNoteId(firstCreatedId);
        }
        showToast(`Restored ${importedCount} note(s) from backup`, "success");
      }

      return importedCount;
    },
    [encryptionKey, user?.username, showToast]
  );

  // Drag & Drop / File Picker Import
  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    let imported = 0;
    for (const file of list) {
      const text = await file.text();
      const created = await createNoteOnServer(file.name, text);
      if (created) imported++;
    }
    if (imported > 0) {
      showToast(
        imported === 1 ? `Imported "${list[0].name}"` : `Imported ${imported} encrypted notes`,
        "success"
      );
    }
  };

  // Exports
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

  const handleExportCurrentNote = () => {
    if (!focusedNote) return;
    const ext = LANGUAGE_EXTENSIONS[focusedNote.language] || "txt";
    const filename = focusedNote.title.includes(".")
      ? focusedNote.title
      : `${focusedNote.title}.${ext}`;
    downloadFile(filename, focusedNote.content);
    showToast(`Downloaded ${filename}`, "success");
  };

  const handleExportAllBackup = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(
      `superpad-${user?.username ?? "backup"}-${stamp}.json`,
      createPlaintextBackupJson(notes, extraFolders),
      "application/json"
    );
    showToast("Downloaded full decrypted JSON backup", "success");
  };

  // Notepad++ Text Transforms
  const applyTextTransform = (
    name: string,
    fn: (text: string) => { result: string; note?: string } | { error: string }
  ) => {
    if (!focusedNote) return;
    const outcome = fn(focusedNote.content);
    if ("error" in outcome) {
      showToast(outcome.error, "error");
      return;
    }
    getFocusedEditor()?.replaceFullDocument(outcome.result);
    showToast(outcome.note ? `${name} (${outcome.note})` : name, "success");
    setToolsMenuOpen(false);
  };

  // Scanner Jump-to-Match (opens note tab if needed & highlights exact offset range)
  const handleJumpToScannerMatch = (match: ScannerMatch) => {
    setOpenTabIds((prev) => (prev.includes(match.noteId) ? prev : [...prev, match.noteId]));
    setActiveNoteId(match.noteId);
    setFocusedPane("primary");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        primaryEditorRef.current?.jumpToRange(match.startOffset, match.endOffset);
      });
    });
  };

  // Split Pane Toggle
  const handleToggleSplit = async () => {
    if (splitNoteId) {
      setSplitNoteId(null);
      setFocusedPane("primary");
      return;
    }
    const other = notes.find((n) => n.id !== activeNoteId);
    if (other) {
      setSplitNoteId(other.id);
      return;
    }
    const scratch = await createNoteOnServer("scratch.txt", "");
    if (scratch) {
      setSplitNoteId(scratch.id);
    }
  };

  // Account Actions: Sign Out, Lock, Change Master Password, Delete Account
  const handleSignOut = async () => {
    if (user) {
      clearCachedUserKey(user.id);
      void clearUserDrafts(user.id);
    }
    clearInMemoryKey();
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
  };

  const handleLockNow = useCallback(
    (reason?: string) => {
      // Flush any unsaved dirty notes to encrypted IndexedDB crash-recovery before wiping memory
      if (user && encryptionKey) {
        for (const n of notesRef.current) {
          if (dirtyNoteIdsRef.current.has(n.id)) {
            void saveEncryptedDraft(
              user.id,
              n.id,
              extractNoteMetadata(n),
              n.content,
              n.version,
              encryptionKey
            );
          }
        }
        clearCachedUserKey(user.id);
      }
      clearInMemoryKey();
      setEncryptionKey(null);
      setSerializedKey("");
      setNotes([]);
      setTrashedNotes([]);
      setOpenTabIds([]);
      setActiveNoteId(null);
      setSplitNoteId(null);
      setPaletteOpen(false);
      setSettingsOpen(false);
      setBackupOpen(false);
      setScannerOpen(false);
      setHistoryOpen(false);
      setLockNotice(reason || "");
      setPhase("locked");
    },
    [user, encryptionKey]
  );

  // Idle Auto-Lock monitor (locks vault after configured minutes of inactivity)
  useEffect(() => {
    const idleMins = settings.idleLockMinutes ?? 0;
    if (phase !== "ready" || idleMins <= 0) return;

    lastActivityAtRef.current = Date.now();
    let lastTouch = Date.now();
    const markActive = () => {
      const now = Date.now();
      if (now - lastTouch > 5000) {
        lastTouch = now;
        lastActivityAtRef.current = now;
      }
    };

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "keydown",
      "mousedown",
      "touchstart",
      "scroll",
    ];
    for (const ev of events) {
      window.addEventListener(ev, markActive, { passive: true });
    }

    const interval = setInterval(() => {
      if (Date.now() - lastActivityAtRef.current >= idleMins * 60 * 1000) {
        handleLockNow(`Vault auto-locked after ${idleMins} minutes of inactivity.`);
      }
    }, 15_000);

    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, markActive);
      }
      clearInterval(interval);
    };
  }, [phase, settings.idleLockMinutes, handleLockNow]);

  const handleChangeMasterPassword = async (currentPwd: string, newPwd: string) => {
    if (!user) throw new Error("Not signed in");
    const { authKey: currentAuthKey } = await deriveUserKeys(currentPwd, user.kdfSalt);
    const newKdfSalt = generateSaltBase64();
    const nextDerived = await deriveUserKeys(newPwd, newKdfSalt);

    // Re-encrypt BOTH active notes and trashed notes so Trash remains readable under the new key
    const allVaultNotes = [...notes, ...trashedNotes];
    const reencryptedNotes = await Promise.all(
      allVaultNotes.map(async (n) => {
        const enc = await encryptNotePayload(
          extractNoteMetadata(n),
          n.content,
          nextDerived.encryptionKey
        );
        return { id: n.id, ...enc };
      })
    );

    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentAuthKey,
        newKdfSalt,
        newAuthKey: nextDerived.authKey,
        notes: reencryptedNotes,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Password change failed.");
    }

    const updatedUser: AuthUser = { ...user, kdfSalt: newKdfSalt };
    setUser(updatedUser);
    setEncryptionKey(nextDerived.encryptionKey);
    setSerializedKey(nextDerived.serializedKey);
    setInMemoryKey(user.id, nextDerived.encryptionKey, nextDerived.serializedKey);
    saveCachedUserKey(user.id, nextDerived.serializedKey, settings.sessionTtlMinutes);

    // Bump versions locally and refresh clean snapshots
    const bumped = notes.map((n) => ({ ...n, version: n.version + 1 }));
    setNotes(bumped);
    setTrashedNotes((prev) => prev.map((n) => ({ ...n, version: n.version + 1 })));
    const snapMap = new Map<string, string>();
    for (const n of bumped) snapMap.set(n.id, serializeNoteForDiff(n));
    setSavedSnapshots(snapMap);
    void clearUserDrafts(user.id);
  };

  const handleDeleteAccount = async (pwd: string) => {
    if (!user) return;
    const { authKey } = await deriveUserKeys(pwd, user.kdfSalt);
    const res = await fetch("/api/auth/me", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authKey }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to delete account.");
    }
    clearCachedUserKey(user.id);
    clearInMemoryKey();
    void clearUserDrafts(user.id);
    router.replace("/");
  };

  const cycleMarkdownPreview = useCallback(() => {
    setMdPreviewMode((cur) => {
      if (cur === "edit") return "split";
      if (cur === "split") return "preview";
      return "edit";
    });
  }, []);

  // Global Keyboard Shortcuts
  useEffect(() => {
    if (phase !== "ready") return;

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        handleLockNow("Vault locked.");
        return;
      }
      if (e.altKey && !mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        void handleToggleSplit();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "m") {
        if (activeNote?.language === "markdown") {
          e.preventDefault();
          cycleMarkdownPreview();
        }
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveAll();
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveActive();
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(false);
        setScannerOpen(true);
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindShowReplace(false);
        setFindOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setFindShowReplace(true);
        setFindOpen(true);
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setGoToLineInput(String(cursorStats.line));
        setGoToLineOpen(true);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        getFocusedEditor()?.insertAtCursor(`${createDateStamp()}\n`);
        return;
      }
      if (e.key === "F2") {
        e.preventDefault();
        if (mod) {
          getFocusedEditor()?.toggleBookmarkAtCursor();
        } else {
          getFocusedEditor()?.jumpToNextBookmark();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    phase,
    handleSaveActive,
    handleSaveAll,
    handleLockNow,
    cycleMarkdownPreview,
    activeNote?.language,
    cursorStats.line,
  ]);

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [
      {
        id: "new-note",
        label: "New Note",
        hint: "Create encrypted note",
        icon: "new",
        run: () => void createNoteOnServer(),
      },
      {
        id: "sync-now",
        label: "Sync with Cloud",
        hint: "Pull updates from other devices",
        icon: "sync",
        run: () => void syncWithCloud({ silent: false }),
      },
      {
        id: "scanner",
        label: "Boolean Block Scanner",
        hint: "Search across all notes (AND / OR / NOT)",
        shortcut: "⌘⇧F",
        icon: "scanner",
        run: () => setScannerOpen(true),
      },
      {
        id: "undo",
        label: "Undo",
        hint: "Undo last edit or replace",
        shortcut: "⌘Z",
        icon: "history",
        run: () => {
          const ed = getFocusedEditor();
          if (ed) {
            const ok = ed.undo();
            if (ok) showToast("Undid last action", "info");
            else showToast("Nothing to undo", "info");
          }
        },
      },
      {
        id: "redo",
        label: "Redo",
        hint: "Redo last undone edit or replace",
        shortcut: "⌘Y / ⌘⇧Z",
        icon: "history",
        run: () => {
          const ed = getFocusedEditor();
          if (ed) {
            const ok = ed.redo();
            if (ok) showToast("Redid last action", "info");
            else showToast("Nothing to redo", "info");
          }
        },
      },
      {
        id: "split-view",
        label: splitNoteId ? "Close Split View" : "Toggle Dual Split View",
        shortcut: "Alt+V",
        icon: "split",
        run: () => void handleToggleSplit(),
      },
      {
        id: "toggle-sidebar",
        label: sidebarOpen ? "Hide Sidebar" : "Show Sidebar",
        shortcut: "⌘B",
        icon: "sidebar",
        run: () => setSidebarOpen((v) => !v),
      },
      {
        id: "history",
        label: "Time Machine (Revision History)",
        hint: "Last 10 encrypted saves",
        icon: "history",
        run: () => {
          if (focusedNote) setHistoryOpen(true);
        },
      },
      {
        id: "backup",
        label: "Backup & Restore Vault",
        hint: "Encrypted .enc.json export & restore",
        icon: "backup",
        run: () => setBackupOpen(true),
      },
      {
        id: "lock",
        label: "Lock Vault Now",
        hint: "Clear encryption key from memory",
        shortcut: "⌘⇧L",
        icon: "lock",
        run: () => handleLockNow("Vault locked."),
      },
      {
        id: "settings",
        label: "Settings & Security",
        hint: "Themes, font, auto-lock, password",
        icon: "settings",
        run: () => setSettingsOpen(true),
      },
    ];

    if (activeNote?.language === "markdown") {
      cmds.splice(2, 0, {
        id: "md-preview",
        label: "Cycle Markdown Preview (Edit / Split / Preview)",
        shortcut: "⌘⇧M",
        icon: "preview",
        run: cycleMarkdownPreview,
      });
    }

    return cmds;
  }, [
    createNoteOnServer,
    syncWithCloud,
    splitNoteId,
    sidebarOpen,
    focusedNote,
    handleLockNow,
    activeNote?.language,
    cycleMarkdownPreview,
  ]);

  useEffect(() => {
    if (!toolsMenuOpen) return;
    const close = () => setToolsMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [toolsMenuOpen]);

  const handleFindOptionsChange = useCallback(
    (opts: SearchOptions) => {
      const ed = getFocusedEditor();
      if (!ed) return;
      setFindSummary(ed.updateSearchHighlights(opts));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedPane, splitNoteId]
  );

  const handleFindClose = () => {
    setFindOpen(false);
    primaryEditorRef.current?.updateSearchHighlights(null);
    splitEditorRef.current?.updateSearchHighlights(null);
    getFocusedEditor()?.focus();
  };

  // ==========================================
  // Render: Checking / Locked Screen
  // ==========================================

  if (phase === "checking") {
    return (
      <div className="h-screen w-screen bg-[#0b0e14] flex flex-col items-center justify-center gap-3 text-[#8b949e]">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
        <p className="text-xs font-mono">Decrypting your workspace...</p>
      </div>
    );
  }

  if (phase === "locked" && user) {
    return (
      <div className="h-screen w-screen bg-[#0b0e14] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-[#131820] border border-[#2b323d] p-7 shadow-2xl shadow-black/60 space-y-5">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-xs text-white font-semibold">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span>SuperPad</span>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-[#1b222c] text-emerald-400 border border-emerald-500/20">
              @{user.username}
            </span>
          </div>

          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-white">Unlock Your Vault</h1>
            <p className="text-xs text-[#8b949e] leading-relaxed">
              {lockNotice ||
                "Your session is active, but your browser encryption key expired. Re-enter your master password to decrypt your notes locally."}
            </p>
          </div>

          <form onSubmit={handleUnlockSubmit} className="space-y-3">
            <input
              type="password"
              value={unlockPwd}
              onChange={(e) => setUnlockPwd(e.target.value)}
              placeholder="Master password"
              autoFocus
              required
              autoComplete="current-password"
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#0b0e14] border border-[#30363d] focus:border-emerald-500 text-sm text-white outline-none"
            />
            {unlockError ? (
              <p className="text-xs text-rose-400 bg-rose-950/30 border border-rose-500/30 rounded-lg px-3 py-2">
                {unlockError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={unlocking}
              className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#0b0e14] font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {unlocking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Decrypting...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Unlock Vault</span>
                </>
              )}
            </button>
          </form>

          <div className="pt-2 border-t border-[#1f2630] flex items-center justify-between text-[11px] text-[#6e7681]">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/80" />
              End-to-end encrypted
            </span>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="inline-flex items-center gap-1 text-[#8b949e] hover:text-white cursor-pointer"
            >
              <LogOut className="w-3 h-3" />
              <span>Sign out / Switch account</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const isFocusedDirty = focusedNote ? dirtyNoteIds.has(focusedNote.id) : false;
  const isAnySaving = savingIds.size > 0;
  const openTabs = openTabIds
    .map((id) => notesById.get(id))
    .filter((n): n is NoteRecord => Boolean(n));

  return (
    <div
      className="h-screen w-screen flex flex-col bg-[#0b0e14] text-[#e6edf3] overflow-hidden relative"
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes("Files") &&
          !e.dataTransfer.types.includes(NOTE_DRAG_MIME)
        ) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes(NOTE_DRAG_MIME)) return;
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
          <p className="text-base font-semibold text-white">Drop files to import into your encrypted account</p>
        </div>
      ) : null}

      {/* Top Command Toolbar */}
      <header className="h-11 px-3 bg-[#131820] border-b border-[#21262d] flex items-center justify-between gap-2 shrink-0">
        {/* Left: Sidebar toggle + Brand + Status */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            title="Toggle File Explorer Sidebar (Cmd/Ctrl+B)"
            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
              sidebarOpen
                ? "bg-[#1d2430] text-white"
                : "text-[#8b949e] hover:bg-[#1d2430] hover:text-white"
            }`}
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
              <Lock className="w-3.5 h-3.5 text-[#0b0e14] stroke-[2.5]" />
            </div>
            <span className="font-semibold text-xs text-white hidden sm:inline">SuperPad</span>
          </div>

          <button
            type="button"
            onClick={() => void syncWithCloud({ silent: false })}
            disabled={syncingCloud}
            title="Click to sync with cloud now (auto-syncs when returning to tab)"
            className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 inline-flex items-center gap-1 transition-colors cursor-pointer ${
              isAnySaving || syncingCloud
                ? "bg-sky-500/20 text-sky-300"
                : dirtyNoteIds.size > 0
                  ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                  : "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
            }`}
          >
            <RefreshCw className={`w-2.5 h-2.5 ${syncingCloud ? "animate-spin" : ""}`} />
            <span>
              {isAnySaving || syncingCloud
                ? "Syncing..."
                : dirtyNoteIds.size > 0
                  ? `${dirtyNoteIds.size} Unsaved`
                  : "Synced"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title="Quick Switcher & Command Palette (Cmd/Ctrl+K)"
            className="hidden md:inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#0e1218] hover:bg-[#1b222c] border border-[#262e3a] text-[11px] text-[#8b949e] hover:text-white transition-colors cursor-pointer"
          >
            <Command className="w-3 h-3" />
            <span>Quick jump</span>
            <kbd className="text-[10px] font-mono px-1 rounded bg-[#161b22] text-[#6e7681]">⌘K</kbd>
          </button>
        </div>

        {/* Right: Power Actions */}
        <div className="flex items-center gap-1">
          {activeNote?.language === "markdown" && !splitNote ? (
            <div
              className="inline-flex items-center rounded-md bg-[#0e1218] border border-[#262e3a] p-0.5 text-[11px]"
              title="Markdown View Mode (Cmd/Ctrl+Shift+M)"
            >
              {(["edit", "split", "preview"] as MarkdownPreviewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setMdPreviewMode(mode)}
                  className={`px-2 py-0.5 rounded capitalize transition-colors cursor-pointer inline-flex items-center gap-1 ${
                    mdPreviewMode === mode
                      ? "bg-sky-500/20 text-sky-300 font-medium"
                      : "text-[#8b949e] hover:text-white"
                  }`}
                >
                  {mode === "preview" ? <Eye className="w-3 h-3" /> : null}
                  <span>{mode}</span>
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setFindShowReplace(false);
              setFindOpen((v) => !v);
            }}
            disabled={!focusedNote}
            title="Find & Replace (Cmd/Ctrl+F or Cmd/Ctrl+H)"
            className={`px-2.5 py-1.5 rounded-md text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-30 ${
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
            title="Boolean Block Scanner across all notes (Cmd/Ctrl+Shift+F)"
            className="px-2.5 py-1.5 rounded-md text-xs inline-flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/25 transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Scanner</span>
          </button>

          <button
            type="button"
            onClick={() => void handleToggleSplit()}
            disabled={!activeNote}
            title="Toggle Dual Split Pane"
            className={`p-1.5 rounded-md transition-colors cursor-pointer disabled:opacity-30 ${
              splitNoteId
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                : "text-[#8b949e] hover:bg-[#1e2530] hover:text-white"
            }`}
          >
            <Columns2 className="w-4 h-4" />
          </button>

          {/* Tools Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setToolsMenuOpen((v) => !v);
              }}
              title="Notepad++ Text Tools, Bookmarks, Import & Export"
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
                  Edit History
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const ed = getFocusedEditor();
                    if (ed) {
                      const ok = ed.undo();
                      if (ok) showToast("Undid last edit", "info");
                      else showToast("Nothing to undo", "info");
                    }
                    setToolsMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] flex items-center justify-between cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Undo2 className="w-3.5 h-3.5 text-amber-400" />
                    Undo
                  </span>
                  <span className="text-[10px] font-mono text-[#6e7681]">⌘Z</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ed = getFocusedEditor();
                    if (ed) {
                      const ok = ed.redo();
                      if (ok) showToast("Redid last edit", "info");
                      else showToast("Nothing to redo", "info");
                    }
                    setToolsMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] flex items-center justify-between cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Redo2 className="w-3.5 h-3.5 text-sky-400" />
                    Redo
                  </span>
                  <span className="text-[10px] font-mono text-[#6e7681]">⌘Y</span>
                </button>
                <hr className="my-1 border-[#262e3a]" />
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
                  <span>Import File(s) into Account</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleExportCurrentNote();
                    setToolsMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Download Current Note</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBackupOpen(true);
                    setToolsMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] flex items-center gap-2 cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Backup &amp; Restore Vault...</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleExportAllBackup();
                    setToolsMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#21262d] text-[#e6edf3] flex items-center gap-2 cursor-pointer"
                >
                  <FilePlus className="w-3.5 h-3.5 text-violet-400" />
                  <span>Quick Export JSON (Plaintext)</span>
                </button>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            disabled={!focusedNote}
            title="Encrypted Revision History (Last 10 Saves of Active Note)"
            className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#1e2530] hover:text-violet-300 transition-colors cursor-pointer disabled:opacity-30"
          >
            <History className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Settings, Password & Account"
            className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#1e2530] hover:text-white transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>

          {dirtyNoteIds.size > 1 ? (
            <button
              type="button"
              onClick={() => void handleSaveAll()}
              disabled={isAnySaving}
              title="Save All Modified Notes (Cmd/Ctrl+Shift+S)"
              className="ml-0.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[#1e2632] hover:bg-[#2a3444] text-emerald-300 border border-emerald-500/30 cursor-pointer"
            >
              Save All ({dirtyNoteIds.size})
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => void handleSaveActive()}
            disabled={!isFocusedDirty || isAnySaving}
            title="Encrypt & Save Active Note (Cmd/Ctrl+S)"
            className={`ml-1 px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-all ${
              isFocusedDirty && !isAnySaving
                ? "bg-emerald-500 hover:bg-emerald-400 text-[#0b0e14] cursor-pointer shadow-md shadow-emerald-500/20"
                : "bg-[#1c222b] text-[#6e7681] cursor-not-allowed"
            }`}
          >
            {isAnySaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Save</span>
            <span className="hidden sm:inline opacity-60 text-[10px] font-mono">(⌘S)</span>
          </button>
        </div>
      </header>

      {/* Body: Collapsible File Sidebar + Tabbed Editor */}
      <div className="flex-1 flex min-h-0">
        <FileSidebar
          open={sidebarOpen}
          username={user.username}
          notes={notes}
          trashedNotes={trashedNotes}
          activeNoteId={activeNoteId}
          dirtyNoteIds={dirtyNoteIds}
          extraFolders={extraFolders}
          collapsedFolders={collapsedFolders}
          totalBytes={totalAccountBytes}
          onSelectNote={handleSelectNote}
          onCreateNote={(folder) => void createNoteOnServer(undefined, "", folder ?? "")}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onToggleFolder={handleToggleFolder}
          onRenameNote={handleRenameNote}
          onMoveNoteToFolder={handleMoveNoteToFolder}
          onTogglePinNote={handleTogglePinNote}
          onDeleteNote={(id) => void handleDeleteNote(id)}
          onRestoreNote={(id) => void handleRestoreNote(id)}
          onPermanentDeleteNote={(id) => void handlePermanentDeleteNote(id)}
          onEmptyTrash={() => void handleEmptyTrash()}
          onTriggerImport={() => fileInputRef.current?.click()}
          onCloseMobile={() => {
            if (typeof window !== "undefined" && window.innerWidth < 768) {
              setSidebarOpen(false);
            }
          }}
        />

        {/* Right Side: Tab Bar + Conflict Banner + Editor Panes */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Open Tabs Bar */}
          <div className="h-9 bg-[#0e1218] border-b border-[#21262d] flex items-center px-1.5 gap-1 overflow-x-auto shrink-0 select-none">
            {openTabs.map((tab) => {
              const isActive = tab.id === activeNoteId;
              const isSplit = tab.id === splitNoteId;
              const dirty = dirtyNoteIds.has(tab.id);
              const isRenaming = renamingTabId === tab.id;

              return (
                <div
                  key={tab.id}
                  onClick={() => {
                    setActiveNoteId(tab.id);
                    setFocusedPane("primary");
                  }}
                  onDoubleClick={() => {
                    setRenamingTabId(tab.id);
                    setRenameValue(tab.title);
                  }}
                  title="Double-click to rename"
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
                      onBlur={() => {
                        if (renameValue.trim()) handleRenameNote(tab.id, renameValue.trim());
                        setRenamingTabId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (renameValue.trim()) handleRenameNote(tab.id, renameValue.trim());
                          setRenamingTabId(null);
                        } else if (e.key === "Escape") {
                          setRenamingTabId(null);
                        }
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

                  <button
                    type="button"
                    onClick={(e) => handleCloseTab(tab.id, e)}
                    title="Close tab"
                    className="p-0.5 rounded text-[#6e7681] hover:text-white hover:bg-[#262e3a] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => void createNoteOnServer()}
              title="New Note Tab"
              className="h-7 w-7 rounded-md flex items-center justify-center text-[#8b949e] hover:text-white hover:bg-[#1b222c] transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Multi-Device Conflict Resolution Banner */}
          {conflict && (conflict.noteId === activeNoteId || conflict.noteId === splitNoteId) ? (
            <div className="px-4 py-2 bg-amber-950/60 border-b border-amber-500/40 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  <strong>Sync conflict:</strong> &quot;{conflict.remoteNote.title}&quot; was saved
                  on another device (Cloud v{conflict.remoteNote.version} vs your v
                  {conflict.localVersion}).
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const remote = conflict.remoteNote;
                    setNotes((prev) => prev.map((n) => (n.id === remote.id ? remote : n)));
                    setSavedSnapshots((prev) => {
                      const next = new Map(prev);
                      next.set(remote.id, serializeNoteForDiff(remote));
                      return next;
                    });
                    void deleteEncryptedDraft(remote.id);
                    setConflict(null);
                    showToast("Loaded latest cloud version", "info");
                  }}
                  className="px-2.5 py-1 rounded bg-[#161b22] hover:bg-[#21262d] text-white border border-[#30363d] inline-flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Load Cloud v{conflict.remoteNote.version}</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const copy = await createNoteOnServer(
                      `${conflict.remoteNote.title} (cloud-v${conflict.remoteNote.version})`,
                      conflict.remoteNote.content,
                      conflict.remoteNote.folder,
                      conflict.remoteNote.language
                    );
                    if (copy) setSplitNoteId(copy.id);
                  }}
                  className="px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 cursor-pointer"
                >
                  Compare in Split View
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void saveNoteById(conflict.noteId, { force: true }).then((ok) => {
                      if (ok) showToast("Overwrote cloud with your version", "success");
                    })
                  }
                  className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-[#0b0e14] font-semibold cursor-pointer"
                >
                  Force Save Mine
                </button>
              </div>
            </div>
          ) : null}

          {/* Main Editor Area */}
          <main className="flex-1 flex min-h-0 relative">
            <FindReplaceBar
              open={findOpen}
              initialShowReplace={findShowReplace}
              summary={findSummary}
              canUndo={historyDepth.canUndo}
              canRedo={historyDepth.canRedo}
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
                  showToast(`Replaced ${res.replaced} occurrence(s)`, "success", {
                    label: "Undo",
                    onAction: () => {
                      const activeEd = getFocusedEditor();
                      if (activeEd) {
                        const ok = activeEd.undo();
                        if (ok) {
                          setFindSummary(activeEd.updateSearchHighlights(opts));
                          showToast("Undid replacement", "info");
                        }
                      }
                    },
                  });
                }
              }}
              onUndo={(opts) => {
                const ed = getFocusedEditor();
                if (ed) {
                  const ok = ed.undo();
                  if (ok) {
                    setFindSummary(ed.updateSearchHighlights(opts));
                    showToast("Undid replacement", "info");
                  } else {
                    showToast("Nothing to undo", "info");
                  }
                }
              }}
              onRedo={(opts) => {
                const ed = getFocusedEditor();
                if (ed) {
                  const ok = ed.redo();
                  if (ok) {
                    setFindSummary(ed.updateSearchHighlights(opts));
                    showToast("Redid replacement", "info");
                  } else {
                    showToast("Nothing to redo", "info");
                  }
                }
              }}
              onClose={handleFindClose}
            />

            {!activeNote ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-[#6e7681] space-y-3">
                <FileCode2 className="w-10 h-10 opacity-25" />
                <p className="text-sm text-[#8b949e]">Select a note from the sidebar or create a new one.</p>
                <button
                  type="button"
                  onClick={() => void createNoteOnServer()}
                  className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#0b0e14] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>New Encrypted Note</span>
                </button>
              </div>
            ) : (
              <>
                {!(activeNote.language === "markdown" && !splitNote && mdPreviewMode === "preview") ? (
                  <div
                    className={`flex-1 flex flex-col min-w-0 h-full ${
                      splitNote || (activeNote.language === "markdown" && mdPreviewMode === "split")
                        ? "border-r border-[#262e3a]"
                        : ""
                    }`}
                  >
                    <CodeEditor
                      ref={primaryEditorRef}
                      tabId={activeNote.id}
                      content={activeNote.content}
                      language={activeNote.language}
                      wordWrap={activeNote.wordWrap}
                      bookmarks={activeNote.bookmarks}
                      theme={settings.theme}
                      fontSize={settings.fontSize}
                      tabSize={settings.tabSize}
                      showLineNumbers={settings.showLineNumbers}
                      onChange={(next) =>
                        updateLocalNote(activeNote.id, (n) => ({
                          ...n,
                          content: next,
                          sizeBytes: new TextEncoder().encode(next).length,
                        }))
                      }
                      onBookmarksChange={(nextBm) =>
                        updateLocalNote(activeNote.id, (n) => ({ ...n, bookmarks: nextBm }))
                      }
                      onCursorChange={(stats) => {
                        if (focusedPane === "primary") setCursorStats(stats);
                      }}
                      onHistoryChange={(hist) => {
                        if (focusedPane === "primary") setHistoryDepth(hist);
                      }}
                      onFocusPane={() => {
                        setFocusedPane("primary");
                        setHistoryDepth({
                          canUndo: primaryEditorRef.current?.canUndo() ?? false,
                          canRedo: primaryEditorRef.current?.canRedo() ?? false,
                        });
                      }}
                    />
                  </div>
                ) : null}

                {activeNote.language === "markdown" && !splitNote && mdPreviewMode !== "edit" ? (
                  <div className="flex-1 flex flex-col min-w-0 h-full">
                    <div className="h-8 px-3 bg-[#11161e] border-b border-[#21262d] flex items-center justify-between text-xs shrink-0">
                      <span className="text-[10px] uppercase tracking-wider text-sky-400 font-semibold inline-flex items-center gap-1.5">
                        <Eye className="w-3 h-3" />
                        Markdown Preview
                      </span>
                      <button
                        type="button"
                        onClick={() => setMdPreviewMode("edit")}
                        className="text-[11px] text-[#8b949e] hover:text-white cursor-pointer"
                      >
                        Close Preview
                      </button>
                    </div>
                    <div className="flex-1 min-h-0">
                      <MarkdownPreview
                        content={activeNote.content}
                        onToggleCheckbox={handleToggleMarkdownCheckbox}
                      />
                    </div>
                  </div>
                ) : null}

                {splitNote ? (
                  <div className="flex-1 flex flex-col min-w-0 h-full">
                    <div className="h-8 px-3 bg-[#11161e] border-b border-[#21262d] flex items-center justify-between gap-2 shrink-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">
                          Split View
                        </span>
                        <select
                          value={splitNote.id}
                          onChange={(e) => setSplitNoteId(e.target.value)}
                          className="bg-[#0b0e14] border border-[#2b323d] rounded px-2 py-0.5 text-xs font-mono text-white outline-none"
                        >
                          {notes.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.folder ? `${n.folder} / ` : ""}
                              {n.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSplitNoteId(null)}
                        title="Close split pane"
                        className="p-1 rounded text-[#8b949e] hover:bg-[#21262d] hover:text-white cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex-1 min-h-0">
                      <CodeEditor
                        ref={splitEditorRef}
                        tabId={splitNote.id}
                        content={splitNote.content}
                        language={splitNote.language}
                        wordWrap={splitNote.wordWrap}
                        bookmarks={splitNote.bookmarks}
                        theme={settings.theme}
                        fontSize={settings.fontSize}
                        tabSize={settings.tabSize}
                        showLineNumbers={settings.showLineNumbers}
                        onChange={(next) =>
                          updateLocalNote(splitNote.id, (n) => ({
                            ...n,
                            content: next,
                            sizeBytes: new TextEncoder().encode(next).length,
                          }))
                        }
                        onBookmarksChange={(nextBm) =>
                          updateLocalNote(splitNote.id, (n) => ({ ...n, bookmarks: nextBm }))
                        }
                        onCursorChange={(stats) => {
                          if (focusedPane === "split") setCursorStats(stats);
                        }}
                        onHistoryChange={(hist) => {
                          if (focusedPane === "split") setHistoryDepth(hist);
                        }}
                        onFocusPane={() => {
                          setFocusedPane("split");
                          setHistoryDepth({
                            canUndo: splitEditorRef.current?.canUndo() ?? false,
                            canRedo: splitEditorRef.current?.canRedo() ?? false,
                          });
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </main>
        </div>
      </div>

      {/* Bottom Notepad++ Status Bar */}
      <footer className="h-7 px-3 bg-[#131820] border-t border-[#21262d] flex items-center justify-between gap-3 text-[11px] font-mono text-[#8b949e] shrink-0 select-none overflow-x-auto">
        <div className="flex items-center gap-3 shrink-0">
          {focusedNote ? (
            <select
              value={focusedNote.language}
              onChange={(e) =>
                updateLocalNote(focusedNote.id, (n) => ({
                  ...n,
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

          {focusedNote ? (
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
          ) : null}

          {cursorStats.selChars > 0 ? (
            <span className="text-sky-400">
              Sel: {cursorStats.selChars.toLocaleString()} chars ({cursorStats.selLines} ln)
            </span>
          ) : null}

          {focusedNote && focusedNote.bookmarks.length > 0 ? (
            <button
              type="button"
              onClick={() => getFocusedEditor()?.jumpToNextBookmark()}
              title="Jump to next bookmark (F2)"
              className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 cursor-pointer"
            >
              <Bookmark className="w-3 h-3 fill-amber-400" />
              <span>{focusedNote.bookmarks.length}</span>
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {focusedNote ? (
            <>
              <span>
                {activeStats.lines.toLocaleString()} lines • {activeStats.words.toLocaleString()}{" "}
                words • {formatBytes(activeStats.bytes)}
              </span>
              <button
                type="button"
                onClick={() =>
                  updateLocalNote(focusedNote.id, (n) => ({ ...n, wordWrap: !n.wordWrap }))
                }
                title="Toggle Word Wrap"
                className={`inline-flex items-center gap-1 cursor-pointer ${
                  focusedNote.wordWrap ? "text-white" : "text-[#6e7681]"
                }`}
              >
                <WrapText className="w-3 h-3" />
                <span>{focusedNote.wordWrap ? "Wrap" : "NoWrap"}</span>
              </button>
              <span className="hidden sm:inline text-[#6e7681]">v{focusedNote.version}</span>
            </>
          ) : null}

          <span className="hidden md:inline text-[#6e7681]">
            {dbBackend === "turso" ? "Synced" : "Offline"}
          </span>
        </div>
      </footer>

      {/* Go To Line + Bookmarks Quick Modal */}
      {goToLineOpen && focusedNote ? (
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

            {focusedNote.bookmarks.length > 0 ? (
              <div className="pt-2 border-t border-[#262e3a] space-y-1.5">
                <div className="text-[11px] font-semibold text-amber-400 flex items-center gap-1">
                  <Bookmark className="w-3 h-3 fill-amber-400" />
                  Bookmarked Lines
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {focusedNote.bookmarks.map((ln) => {
                    const preview =
                      focusedNote.content.split("\n")[ln - 1]?.trim().slice(0, 50) || "(empty)";
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
        allNotes={notes}
        openNoteIds={openTabIds}
        activeNoteId={focusedNote?.id ?? null}
        onJumpToMatch={handleJumpToScannerMatch}
        onExportMatchesToNote={(title, content) => {
          void createNoteOnServer(title, content, "", "plain").then((created) => {
            if (created) showToast(`Created "${title}" with search results`, "success");
          });
        }}
        onClose={() => setScannerOpen(false)}
      />

      {/* Per-Note Revision History Drawer */}
      <HistoryDrawer
        open={historyOpen}
        noteId={focusedNote?.id ?? null}
        noteTitle={focusedNote?.title ?? ""}
        encryptionKey={encryptionKey}
        onRestoreIntoActive={(restoredContent) => {
          getFocusedEditor()?.replaceFullDocument(restoredContent);
          showToast("Restored revision into editor — press ⌘S to save", "info");
        }}
        onCreateCopyFromRevision={(meta, content, ver) => {
          void createNoteOnServer(
            `${meta.title} (v${ver})`,
            content,
            meta.folder,
            meta.language
          ).then((created) => {
            if (created) showToast(`Opened v${ver} as a new note`, "success");
          });
        }}
        onClose={() => setHistoryOpen(false)}
      />

      {/* Quick Switcher & Command Palette (Cmd/Ctrl+K) */}
      <CommandPalette
        open={paletteOpen}
        notes={notes}
        activeNoteId={activeNoteId}
        dirtyNoteIds={dirtyNoteIds}
        commands={paletteCommands}
        onSelectNote={handleSelectNote}
        onCreateNoteWithTitle={(title) => void createNoteOnServer(title, "")}
        onClose={() => setPaletteOpen(false)}
      />

      {/* Encrypted Backup & Restore Modal */}
      <BackupModal
        open={backupOpen}
        username={user.username}
        notes={notes}
        extraFolders={extraFolders}
        onRestoreBackup={handleRestoreBackup}
        onClose={() => setBackupOpen(false)}
      />

      {/* Settings & Security Modal */}
      <SettingsModal
        open={settingsOpen}
        username={user.username}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onChangePassword={handleChangeMasterPassword}
        onOpenBackup={() => setBackupOpen(true)}
        onLockNow={() => handleLockNow("Vault locked.")}
        onSignOut={handleSignOut}
        onDeleteAccount={handleDeleteAccount}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Toast Notification (supports Undo action) */}
      {toast ? (
        <div
          className={`fixed bottom-10 right-4 z-50 px-3.5 py-2 rounded-lg text-xs font-medium shadow-xl border backdrop-blur-md transition-all inline-flex items-center gap-3 ${
            toast.type === "error"
              ? "bg-rose-950/90 border-rose-500/50 text-rose-200"
              : toast.type === "success"
                ? "bg-emerald-950/90 border-emerald-500/50 text-emerald-200"
                : "bg-[#161b22]/95 border-[#30363d] text-[#e6edf3]"
          }`}
        >
          <span>{toast.msg}</span>
          {toast.actionLabel && toast.onAction ? (
            <button
              type="button"
              onClick={() => {
                const fn = toast.onAction;
                setToast(null);
                fn?.();
              }}
              className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-300 border border-emerald-500/40 font-semibold cursor-pointer"
            >
              {toast.actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
