"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Columns2,
  CornerDownLeft,
  Eye,
  FileCode2,
  FilePlus,
  FileText,
  Folder,
  History,
  Lock,
  PanelLeft,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Sparkles,
  Star,
} from "lucide-react";
import type { NoteRecord } from "@/types/vault";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon: "new" | "split" | "preview" | "scanner" | "history" | "sync" | "sidebar" | "backup" | "lock" | "settings";
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  notes: NoteRecord[];
  activeNoteId: string | null;
  dirtyNoteIds: Set<string>;
  commands: PaletteCommand[];
  onSelectNote: (noteId: string) => void;
  onCreateNoteWithTitle: (title: string) => void;
  onClose: () => void;
}

type PaletteEntry =
  | { kind: "note"; note: NoteRecord; score: number }
  | { kind: "command"; command: PaletteCommand; score: number }
  | { kind: "create"; title: string };

function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 1;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;
  const idx = t.indexOf(q);
  if (idx !== -1) return 250 - Math.min(idx, 100);

  // Subsequence match
  let qi = 0;
  let streak = 0;
  let score = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      qi++;
      streak++;
      score += 10 + streak * 4;
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : -1;
}

function CommandIcon({ type }: { type: PaletteCommand["icon"] }) {
  switch (type) {
    case "new":
      return <FilePlus className="w-3.5 h-3.5 text-emerald-400" />;
    case "split":
      return <Columns2 className="w-3.5 h-3.5 text-cyan-400" />;
    case "preview":
      return <Eye className="w-3.5 h-3.5 text-sky-400" />;
    case "scanner":
      return <Sparkles className="w-3.5 h-3.5 text-amber-400" />;
    case "history":
      return <History className="w-3.5 h-3.5 text-violet-400" />;
    case "sync":
      return <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />;
    case "sidebar":
      return <PanelLeft className="w-3.5 h-3.5 text-[#8b949e]" />;
    case "backup":
      return <Shield className="w-3.5 h-3.5 text-emerald-400" />;
    case "lock":
      return <Lock className="w-3.5 h-3.5 text-amber-400" />;
    case "settings":
      return <Settings className="w-3.5 h-3.5 text-[#8b949e]" />;
  }
}

export default function CommandPalette({
  open,
  notes,
  activeNoteId,
  dirtyNoteIds,
  commands,
  onSelectNote,
  onCreateNoteWithTitle,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const trimmed = query.trim();
    const isCommandOnly = trimmed.startsWith(">");
    const effectiveQuery = isCommandOnly ? trimmed.slice(1).trim() : trimmed;

    const noteEntries: PaletteEntry[] = [];
    if (!isCommandOnly) {
      for (const note of notes) {
        const pathLabel = note.folder ? `${note.folder}/${note.title}` : note.title;
        const score = Math.max(
          fuzzyScore(note.title, effectiveQuery),
          fuzzyScore(pathLabel, effectiveQuery)
        );
        if (score >= 0) {
          const boost = (note.pinned ? 20 : 0) + (note.id === activeNoteId ? 5 : 0);
          noteEntries.push({ kind: "note", note, score: score + boost });
        }
      }
      noteEntries.sort((a, b) => {
        if (a.kind === "note" && b.kind === "note") {
          if (b.score !== a.score) return b.score - a.score;
          return b.note.updatedAt - a.note.updatedAt;
        }
        return 0;
      });
    }

    const commandEntries: PaletteEntry[] = [];
    for (const cmd of commands) {
      const score = Math.max(
        fuzzyScore(cmd.label, effectiveQuery),
        cmd.hint ? fuzzyScore(cmd.hint, effectiveQuery) : -1
      );
      if (score >= 0) {
        commandEntries.push({ kind: "command", command: cmd, score });
      }
    }
    commandEntries.sort((a, b) => {
      if (a.kind === "command" && b.kind === "command") return b.score - a.score;
      return 0;
    });

    const combined: PaletteEntry[] = isCommandOnly
      ? commandEntries
      : [...noteEntries.slice(0, 12), ...commandEntries.slice(0, effectiveQuery ? 8 : 6)];

    if (
      !isCommandOnly &&
      effectiveQuery.length > 0 &&
      !notes.some((n) => n.title.toLowerCase() === effectiveQuery.toLowerCase())
    ) {
      combined.push({ kind: "create", title: effectiveQuery });
    }

    return combined;
  }, [query, notes, activeNoteId, commands]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const activeEl = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    if (activeEl && "scrollIntoView" in activeEl) {
      (activeEl as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!open) return null;

  const executeEntry = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    onClose();
    if (entry.kind === "note") {
      onSelectNote(entry.note.id);
    } else if (entry.kind === "command") {
      entry.command.run();
    } else {
      onCreateNoteWithTitle(entry.title);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-start justify-center pt-[12vh] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl bg-[#131820] border border-[#30363d] shadow-2xl shadow-black/70 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3.5 py-2.5 border-b border-[#21262d] flex items-center gap-2.5 bg-[#0e1218]">
          <Search className="w-4 h-4 text-emerald-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((i) => (entries.length ? (i + 1) % entries.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((i) =>
                  entries.length ? (i - 1 + entries.length) % entries.length : 0
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                executeEntry(entries[selectedIndex]);
              }
            }}
            placeholder='Jump to note or command... (prefix ">" for commands only)'
            className="flex-1 bg-transparent text-sm text-white placeholder-[#6e7681] outline-none"
          />
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1b222c] text-[#8b949e] border border-[#2b323d]">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-1.5 space-y-0.5">
          {entries.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#6e7681]">
              No matching notes or commands.
            </div>
          ) : (
            entries.map((entry, idx) => {
              const isSelected = idx === selectedIndex;

              if (entry.kind === "note") {
                const { note } = entry;
                const isDirty = dirtyNoteIds.has(note.id);
                return (
                  <button
                    key={`note-${note.id}`}
                    data-idx={idx}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => executeEntry(entry)}
                    className={`w-full px-3 py-2 rounded-lg flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                      isSelected ? "bg-[#1f2937] text-white" : "text-[#c9d1d9] hover:bg-[#19202b]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {note.language === "plain" ? (
                        <FileText className="w-3.5 h-3.5 text-[#6e7681] shrink-0" />
                      ) : (
                        <FileCode2 className="w-3.5 h-3.5 text-emerald-400/80 shrink-0" />
                      )}
                      <span className="text-xs font-mono truncate">{note.title}</span>
                      {note.folder ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#0b0e14] text-sky-300/90 border border-[#262e3a] shrink-0">
                          <Folder className="w-2.5 h-2.5" />
                          {note.folder}
                        </span>
                      ) : null}
                      {note.pinned ? (
                        <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />
                      ) : null}
                      {isDirty ? (
                        <span
                          title="Unsaved"
                          className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                        />
                      ) : null}
                    </div>
                    <span className="text-[10px] font-mono text-[#6e7681] shrink-0">
                      {note.id === activeNoteId ? "Current" : "Open"}
                    </span>
                  </button>
                );
              }

              if (entry.kind === "command") {
                const { command } = entry;
                return (
                  <button
                    key={`cmd-${command.id}`}
                    data-idx={idx}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => executeEntry(entry)}
                    className={`w-full px-3 py-2 rounded-lg flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                      isSelected ? "bg-[#1f2937] text-white" : "text-[#c9d1d9] hover:bg-[#19202b]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CommandIcon type={command.icon} />
                      <span className="text-xs truncate">{command.label}</span>
                      {command.hint ? (
                        <span className="text-[11px] text-[#6e7681] truncate hidden sm:inline">
                          {command.hint}
                        </span>
                      ) : null}
                    </div>
                    {command.shortcut ? (
                      <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#0b0e14] text-[#8b949e] border border-[#262e3a] shrink-0">
                        {command.shortcut}
                      </kbd>
                    ) : null}
                  </button>
                );
              }

              return (
                <button
                  key="create-new"
                  data-idx={idx}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => executeEntry(entry)}
                  className={`w-full px-3 py-2 rounded-lg flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/30"
                      : "text-emerald-300 hover:bg-emerald-500/10"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FilePlus className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-xs truncate">
                      Create new note <strong className="font-mono">&quot;{entry.title}&quot;</strong>
                    </span>
                  </div>
                  <CornerDownLeft className="w-3.5 h-3.5 opacity-60 shrink-0" />
                </button>
              );
            })
          )}
        </div>

        <div className="px-3.5 py-1.5 border-t border-[#21262d] bg-[#0e1218] flex items-center justify-between text-[10px] font-mono text-[#6e7681]">
          <span>↑↓ Navigate • ↵ Select</span>
          <span>⌘K Quick Switcher</span>
        </div>
      </div>
    </div>
  );
}
