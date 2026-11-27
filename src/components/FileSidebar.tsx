"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePlus,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Pencil,
  Search,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import type { NoteRecord } from "@/types/vault";
import { formatBytes } from "@/lib/scanner";

interface FileSidebarProps {
  open: boolean;
  username: string;
  notes: NoteRecord[];
  activeNoteId: string | null;
  dirtyNoteIds: Set<string>;
  extraFolders: string[];
  totalBytes: number;
  onSelectNote: (noteId: string) => void;
  onCreateNote: (folder?: string) => void;
  onCreateFolder: (folderName: string) => void;
  onRenameNote: (noteId: string, newTitle: string) => void;
  onMoveNoteToFolder: (noteId: string, folder: string) => void;
  onTogglePinNote: (noteId: string) => void;
  onDeleteNote: (noteId: string) => void;
  onTriggerImport: () => void;
}

export default function FileSidebar({
  open,
  username,
  notes,
  activeNoteId,
  dirtyNoteIds,
  extraFolders,
  totalBytes,
  onSelectNote,
  onCreateNote,
  onCreateFolder,
  onRenameNote,
  onMoveNoteToFolder,
  onTogglePinNote,
  onDeleteNote,
  onTriggerImport,
}: FileSidebarProps) {
  const [filter, setFilter] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveFolderText, setMoveFolderText] = useState("");

  const filteredNotes = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.folder.toLowerCase().includes(q)
    );
  }, [notes, filter]);

  const { pinnedNotes, folderGroups, rootNotes, allFolderNames } = useMemo(() => {
    const pinned: NoteRecord[] = [];
    const byFolder = new Map<string, NoteRecord[]>();
    const root: NoteRecord[] = [];

    for (const f of extraFolders) {
      if (f.trim()) byFolder.set(f.trim(), []);
    }

    for (const note of filteredNotes) {
      if (note.pinned) {
        pinned.push(note);
      }
      if (note.folder) {
        const list = byFolder.get(note.folder) ?? [];
        list.push(note);
        byFolder.set(note.folder, list);
      } else {
        root.push(note);
      }
    }

    const sortedFolders = Array.from(byFolder.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );

    const names = Array.from(
      new Set([
        ...extraFolders,
        ...notes.map((n) => n.folder).filter(Boolean),
      ])
    ).sort();

    return {
      pinnedNotes: pinned,
      folderGroups: sortedFolders,
      rootNotes: root,
      allFolderNames: names,
    };
  }, [filteredNotes, extraFolders, notes]);

  if (!open) return null;

  const toggleFolder = (folder: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const renderNoteItem = (note: NoteRecord, indent = false) => {
    const isActive = note.id === activeNoteId;
    const isDirty = dirtyNoteIds.has(note.id);
    const isRenaming = renamingId === note.id;
    const isMoving = movingId === note.id;

    return (
      <div key={`${indent ? "f" : "r"}-${note.id}`} className={indent ? "pl-3" : ""}>
        <div
          onClick={() => onSelectNote(note.id)}
          onDoubleClick={() => {
            setRenamingId(note.id);
            setRenameText(note.title);
          }}
          className={`group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
            isActive
              ? "bg-[#1c2430] text-white"
              : "text-[#9ca3af] hover:bg-[#151b24] hover:text-[#e6edf3]"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {note.language === "plain" ? (
              <FileText className="w-3.5 h-3.5 text-[#6e7681] shrink-0" />
            ) : (
              <FileCode2 className="w-3.5 h-3.5 text-emerald-400/80 shrink-0" />
            )}

            {isRenaming ? (
              <input
                type="text"
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                onBlur={() => {
                  if (renameText.trim()) onRenameNote(note.id, renameText.trim());
                  setRenamingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (renameText.trim()) onRenameNote(note.id, renameText.trim());
                    setRenamingId(null);
                  } else if (e.key === "Escape") {
                    setRenamingId(null);
                  }
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-[#0b0e14] border border-emerald-500 rounded px-1 py-0.5 text-xs font-mono text-white outline-none"
              />
            ) : (
              <span className="truncate font-mono">{note.title}</span>
            )}

            {isDirty ? (
              <span
                title="Unsaved changes"
                className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
              />
            ) : null}
          </div>

          {!isRenaming ? (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePinNote(note.id);
                }}
                title={note.pinned ? "Unpin" : "Pin note"}
                className={`p-0.5 rounded hover:bg-[#262f3f] cursor-pointer ${
                  note.pinned ? "text-amber-400" : "text-[#6e7681] hover:text-amber-300"
                }`}
              >
                <Star className={`w-3 h-3 ${note.pinned ? "fill-amber-400" : ""}`} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMovingId(isMoving ? null : note.id);
                  setMoveFolderText(note.folder);
                }}
                title="Move to folder"
                className="p-0.5 rounded text-[#6e7681] hover:text-sky-300 hover:bg-[#262f3f] cursor-pointer"
              >
                <FolderInput className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenamingId(note.id);
                  setRenameText(note.title);
                }}
                title="Rename"
                className="p-0.5 rounded text-[#6e7681] hover:text-white hover:bg-[#262f3f] cursor-pointer"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteNote(note.id);
                }}
                title="Delete note"
                className="p-0.5 rounded text-[#6e7681] hover:text-rose-400 hover:bg-[#262f3f] cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ) : null}
        </div>

        {/* Inline Move-to-Folder Bar */}
        {isMoving ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onMoveNoteToFolder(note.id, moveFolderText.trim());
              setMovingId(null);
            }}
            className="mx-2 my-1 p-1.5 rounded bg-[#0b0e14] border border-[#2b323d] flex items-center gap-1"
          >
            <input
              type="text"
              list="superpad-folder-list"
              value={moveFolderText}
              onChange={(e) => setMoveFolderText(e.target.value)}
              placeholder="Folder (empty = root)"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") setMovingId(null);
              }}
              className="flex-1 bg-transparent text-[11px] font-mono text-white placeholder-[#484f58] outline-none min-w-0"
            />
            <button
              type="submit"
              className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] cursor-pointer"
            >
              Move
            </button>
          </form>
        ) : null}
      </div>
    );
  };

  return (
    <aside className="w-60 sm:w-64 shrink-0 bg-[#0e1218] border-r border-[#21262d] flex flex-col select-none">
      <datalist id="superpad-folder-list">
        {allFolderNames.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      {/* Sidebar Header */}
      <div className="h-9 px-3 border-b border-[#1c222b] flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8b949e] truncate">
          @{username}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onCreateNote("")}
            title="New Note"
            className="p-1 rounded text-[#8b949e] hover:bg-[#1c222b] hover:text-emerald-400 cursor-pointer"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setCreatingFolder((v) => !v);
              setNewFolderName("");
            }}
            title="New Folder"
            className="p-1 rounded text-[#8b949e] hover:bg-[#1c222b] hover:text-sky-400 cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onTriggerImport}
            title="Import Files"
            className="p-1 rounded text-[#8b949e] hover:bg-[#1c222b] hover:text-white cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter Input */}
      <div className="p-2 border-b border-[#1c222b] space-y-1.5">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#0b0e14] border border-[#262e3a] focus-within:border-[#3c485a]">
          <Search className="w-3 h-3 text-[#6e7681] shrink-0" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter notes..."
            className="flex-1 bg-transparent text-xs text-white placeholder-[#484f58] outline-none min-w-0"
          />
        </div>

        {creatingFolder ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newFolderName.trim()) {
                onCreateFolder(newFolderName.trim());
                setNewFolderName("");
                setCreatingFolder(false);
              }
            }}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#131820] border border-sky-500/50"
          >
            <Folder className="w-3 h-3 text-sky-400 shrink-0" />
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") setCreatingFolder(false);
              }}
              className="flex-1 bg-transparent text-xs text-white outline-none min-w-0"
            />
            <button
              type="submit"
              className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 cursor-pointer"
            >
              Add
            </button>
          </form>
        ) : null}
      </div>

      {/* Notes Tree */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-3">
        {/* Pinned Notes */}
        {pinnedNotes.length > 0 ? (
          <div className="space-y-0.5">
            <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80 flex items-center gap-1">
              <Star className="w-2.5 h-2.5 fill-amber-400" />
              Pinned
            </div>
            {pinnedNotes.map((n) => renderNoteItem(n, false))}
          </div>
        ) : null}

        {/* Folders */}
        {folderGroups.length > 0 ? (
          <div className="space-y-1">
            <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">
              Folders
            </div>
            {folderGroups.map(([folderName, items]) => {
              const collapsed = collapsedFolders.has(folderName);
              return (
                <div key={folderName}>
                  <div
                    onClick={() => toggleFolder(folderName)}
                    className="group flex items-center justify-between px-1.5 py-1 rounded-md text-xs text-[#c9d1d9] hover:bg-[#151b24] cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {collapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 text-[#6e7681] shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-[#6e7681] shrink-0" />
                      )}
                      {collapsed ? (
                        <Folder className="w-3.5 h-3.5 text-sky-400/80 shrink-0" />
                      ) : (
                        <FolderOpen className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      )}
                      <span className="truncate font-medium">{folderName}</span>
                      <span className="text-[10px] font-mono text-[#6e7681]">
                        {items.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateNote(folderName);
                      }}
                      title={`New note inside ${folderName}`}
                      className="p-0.5 rounded text-[#6e7681] hover:text-emerald-400 opacity-0 group-hover:opacity-100 cursor-pointer"
                    >
                      <FilePlus className="w-3 h-3" />
                    </button>
                  </div>
                  {!collapsed ? (
                    <div className="mt-0.5 space-y-0.5">
                      {items.length > 0 ? (
                        items.map((n) => renderNoteItem(n, true))
                      ) : (
                        <div className="pl-7 py-1 text-[11px] italic text-[#484f58]">
                          Empty folder
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Root Notes */}
        <div className="space-y-0.5">
          {folderGroups.length > 0 || pinnedNotes.length > 0 ? (
            <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">
              Notes
            </div>
          ) : null}
          {rootNotes.length > 0 ? (
            rootNotes.map((n) => renderNoteItem(n, false))
          ) : notes.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[#6e7681]">
              No notes yet. Click <span className="text-emerald-400">+</span> to create one.
            </div>
          ) : null}
        </div>
      </div>

      {/* Sidebar Storage Footer */}
      <div className="h-7 px-3 border-t border-[#1c222b] flex items-center justify-between text-[10px] font-mono text-[#6e7681]">
        <span>{notes.length} {notes.length === 1 ? "note" : "notes"}</span>
        <span>{formatBytes(totalBytes)}</span>
      </div>
    </aside>
  );
}
