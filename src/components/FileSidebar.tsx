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
  RotateCcw,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { NoteRecord } from "@/types/vault";
import { formatBytes } from "@/lib/scanner";

export const NOTE_DRAG_MIME = "application/x-superpad-note";

interface FileSidebarProps {
  open: boolean;
  username: string;
  notes: NoteRecord[];
  trashedNotes: NoteRecord[];
  activeNoteId: string | null;
  dirtyNoteIds: Set<string>;
  extraFolders: string[];
  collapsedFolders: Set<string>;
  totalBytes: number;
  onSelectNote: (noteId: string) => void;
  onCreateNote: (folder?: string) => void;
  onCreateFolder: (folderName: string) => void;
  onRenameFolder: (oldName: string, newName: string) => void;
  onDeleteFolder: (folderName: string) => void;
  onToggleFolder: (folderName: string) => void;
  onRenameNote: (noteId: string, newTitle: string) => void;
  onMoveNoteToFolder: (noteId: string, folder: string) => void;
  onTogglePinNote: (noteId: string) => void;
  onDeleteNote: (noteId: string) => void;
  onRestoreNote: (noteId: string) => void;
  onPermanentDeleteNote: (noteId: string) => void;
  onEmptyTrash: () => void;
  onTriggerImport: () => void;
  onCloseMobile: () => void;
}

export default function FileSidebar({
  open,
  username,
  notes,
  trashedNotes,
  activeNoteId,
  dirtyNoteIds,
  extraFolders,
  collapsedFolders,
  totalBytes,
  onSelectNote,
  onCreateNote,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  onRenameNote,
  onMoveNoteToFolder,
  onTogglePinNote,
  onDeleteNote,
  onRestoreNote,
  onPermanentDeleteNote,
  onEmptyTrash,
  onTriggerImport,
  onCloseMobile,
}: FileSidebarProps) {
  const [filter, setFilter] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameFolderText, setRenameFolderText] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveFolderText, setMoveFolderText] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);

  // Internal Note Drag-and-Drop State
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dropTargetFolder, setDropTargetFolder] = useState<string | "__root__" | null>(null);

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

  const isInternalNoteDrag = (e: React.DragEvent): boolean =>
    Boolean(draggingNoteId) || e.dataTransfer.types.includes(NOTE_DRAG_MIME);

  const handleNoteDrop = (e: React.DragEvent, targetFolder: string) => {
    if (!isInternalNoteDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const noteId = e.dataTransfer.getData(NOTE_DRAG_MIME) || draggingNoteId;
    setDropTargetFolder(null);
    setDraggingNoteId(null);
    if (noteId) {
      onMoveNoteToFolder(noteId, targetFolder);
    }
  };

  const renderNoteItem = (note: NoteRecord, indent = false) => {
    const isActive = note.id === activeNoteId;
    const isDirty = dirtyNoteIds.has(note.id);
    const isRenaming = renamingId === note.id;
    const isMoving = movingId === note.id;
    const isBeingDragged = draggingNoteId === note.id;

    return (
      <div key={`${indent ? "f" : "r"}-${note.id}`} className={indent ? "pl-3" : ""}>
        <div
          draggable={!isRenaming}
          onDragStart={(e) => {
            setDraggingNoteId(note.id);
            e.dataTransfer.setData(NOTE_DRAG_MIME, note.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            setDraggingNoteId(null);
            setDropTargetFolder(null);
          }}
          onClick={() => {
            onSelectNote(note.id);
            onCloseMobile();
          }}
          onDoubleClick={() => {
            setRenamingId(note.id);
            setRenameText(note.title);
          }}
          className={`group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
            isBeingDragged ? "opacity-45" : ""
          } ${
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
            <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
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
                title="Move to Trash"
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
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setMovingId(null);
              }
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
    <>
      {/* Mobile Slide-over Backdrop */}
      <div
        onClick={onCloseMobile}
        className="md:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-xs"
      />

      <aside className="fixed md:static inset-y-0 left-0 z-40 w-64 shrink-0 bg-[#0e1218] border-r border-[#21262d] flex flex-col select-none shadow-2xl md:shadow-none">
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
              onClick={() => {
                onCreateNote("");
                onCloseMobile();
              }}
              title="New Note"
              className="p-1 rounded text-[#8b949e] border border-transparent hover:bg-[#1c222b] hover:text-emerald-400 cursor-pointer"
            >
              <FilePlus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={creatingFolder}
              onClick={() => {
                if (!creatingFolder) {
                  setCreatingFolder(true);
                  setNewFolderName("");
                }
              }}
              title={creatingFolder ? "Creating folder..." : "New Folder"}
              className={`p-1 rounded transition-colors ${
                creatingFolder
                  ? "text-sky-400 bg-[#1c222b] border border-sky-400 ring-1 ring-sky-400/40 cursor-default"
                  : "text-[#8b949e] border border-transparent hover:bg-[#1c222b] hover:text-sky-400 cursor-pointer"
              }`}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onTriggerImport}
              title="Import Files"
              className="p-1 rounded text-[#8b949e] border border-transparent hover:bg-[#1c222b] hover:text-white cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onCloseMobile}
              title="Close sidebar"
              className="md:hidden p-1 rounded text-[#8b949e] hover:bg-[#1c222b] hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
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
                } else {
                  setCreatingFolder(false);
                }
              }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setCreatingFolder(false);
                  setNewFolderName("");
                }
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#131820] border border-sky-400 ring-1 ring-sky-400/30"
            >
              <Folder className="w-3 h-3 text-sky-400 shrink-0" />
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setCreatingFolder(false);
                    setNewFolderName("");
                  }
                }}
                className="flex-1 bg-transparent text-xs text-white outline-none min-w-0"
              />
            </form>
          ) : null}
        </div>

        {/* Scrollable Tree */}
        <div className="flex-1 overflow-y-auto px-1.5 py-2 space-y-3">
          {/* Pinned Section */}
          {pinnedNotes.length > 0 ? (
            <div className="space-y-0.5">
              <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80 flex items-center gap-1">
                <Star className="w-2.5 h-2.5 fill-amber-400/80" />
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
                const isRenamingThis = renamingFolder === folderName;
                const isDropTarget = dropTargetFolder === folderName;

                return (
                  <div
                    key={folderName}
                    onDragOver={(e) => {
                      if (!isInternalNoteDrag(e)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "move";
                      if (dropTargetFolder !== folderName) setDropTargetFolder(folderName);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        if (dropTargetFolder === folderName) setDropTargetFolder(null);
                      }
                    }}
                    onDrop={(e) => handleNoteDrop(e, folderName)}
                    className={`rounded-md transition-colors ${
                      isDropTarget ? "bg-sky-500/15 ring-1 ring-sky-400" : ""
                    }`}
                  >
                    <div
                      onClick={() => {
                        if (!isRenamingThis) onToggleFolder(folderName);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setRenamingFolder(folderName);
                        setRenameFolderText(folderName);
                      }}
                      title="Click to expand/collapse • Double-click to rename • Drop notes here"
                      className="group flex items-center justify-between px-1.5 py-1 rounded-md text-xs text-[#c9d1d9] hover:bg-[#151b24] cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
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

                        {isRenamingThis ? (
                          <input
                            type="text"
                            value={renameFolderText}
                            onChange={(e) => setRenameFolderText(e.target.value)}
                            onBlur={() => {
                              const next = renameFolderText.trim();
                              if (next && next !== folderName) {
                                onRenameFolder(folderName, next);
                              }
                              setRenamingFolder(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const next = renameFolderText.trim();
                                if (next && next !== folderName) {
                                  onRenameFolder(folderName, next);
                                }
                                setRenamingFolder(null);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setRenamingFolder(null);
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                            className="flex-1 min-w-0 bg-[#0b0e14] border border-sky-400 rounded px-1 py-0.5 text-xs text-white outline-none"
                          />
                        ) : (
                          <>
                            <span className="truncate font-medium">{folderName}</span>
                            <span className="text-[10px] font-mono text-[#6e7681]">
                              {items.length}
                            </span>
                          </>
                        )}
                      </div>

                      {!isRenamingThis ? (
                        <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onCreateNote(folderName);
                              onCloseMobile();
                            }}
                            title={`New note inside ${folderName}`}
                            className="p-0.5 rounded text-[#6e7681] hover:text-emerald-400 hover:bg-[#262f3f] cursor-pointer"
                          >
                            <FilePlus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingFolder(folderName);
                              setRenameFolderText(folderName);
                            }}
                            title={`Rename folder "${folderName}"`}
                            className="p-0.5 rounded text-[#6e7681] hover:text-white hover:bg-[#262f3f] cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteFolder(folderName);
                            }}
                            title={`Delete folder "${folderName}"`}
                            className="p-0.5 rounded text-[#6e7681] hover:text-rose-400 hover:bg-[#262f3f] cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {!collapsed ? (
                      <div className="mt-0.5 space-y-0.5">
                        {items.length > 0 ? (
                          items.map((n) => renderNoteItem(n, true))
                        ) : (
                          <div className="pl-7 py-1 text-[11px] italic text-[#484f58]">
                            {isDropTarget ? "Drop note here" : "Empty folder"}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Root Notes (also a drop target to move notes out of folders!) */}
          <div
            onDragOver={(e) => {
              if (!isInternalNoteDrag(e)) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              if (dropTargetFolder !== "__root__") setDropTargetFolder("__root__");
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                if (dropTargetFolder === "__root__") setDropTargetFolder(null);
              }
            }}
            onDrop={(e) => handleNoteDrop(e, "")}
            className={`space-y-0.5 rounded-md min-h-[48px] transition-colors ${
              dropTargetFolder === "__root__" ? "bg-emerald-500/10 ring-1 ring-emerald-400/70 p-1" : ""
            }`}
          >
            {folderGroups.length > 0 || pinnedNotes.length > 0 || draggingNoteId ? (
              <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">
                {dropTargetFolder === "__root__" ? "Drop to move to Root" : "Notes"}
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

          {/* 30-Day Soft Trash Section */}
          {trashedNotes.length > 0 ? (
            <div className="pt-2 border-t border-[#1c222b] space-y-1">
              <div
                onClick={() => setTrashOpen((v) => !v)}
                className="group flex items-center justify-between px-1.5 py-1 rounded-md text-xs text-[#8b949e] hover:bg-[#151b24] hover:text-[#e6edf3] cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  {trashOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-[#6e7681]" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-[#6e7681]" />
                  )}
                  <Trash2 className="w-3.5 h-3.5 text-rose-400/80" />
                  <span className="font-medium">Trash</span>
                  <span className="text-[10px] font-mono text-[#6e7681]">
                    {trashedNotes.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEmptyTrash();
                  }}
                  title="Empty Trash permanently"
                  className="text-[10px] px-1.5 py-0.5 rounded text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/15 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  Empty
                </button>
              </div>

              {trashOpen ? (
                <div className="space-y-0.5 pl-2">
                  {trashedNotes.map((note) => (
                    <div
                      key={`trash-${note.id}`}
                      className="group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-md text-xs text-[#6e7681] hover:bg-[#151b24] hover:text-[#c9d1d9]"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileText className="w-3 h-3 shrink-0 opacity-60" />
                        <span className="truncate font-mono line-through">{note.title}</span>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onRestoreNote(note.id)}
                          title="Restore note"
                          className="p-0.5 rounded text-[#8b949e] hover:text-emerald-400 hover:bg-[#262f3f] cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onPermanentDeleteNote(note.id)}
                          title="Delete permanently"
                          className="p-0.5 rounded text-[#8b949e] hover:text-rose-400 hover:bg-[#262f3f] cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="px-2 pt-1 text-[10px] text-[#484f58]">
                    Auto-deleted after 30 days
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Footer Stats */}
        <div className="h-7 px-3 border-t border-[#1c222b] flex items-center justify-between text-[10px] font-mono text-[#6e7681]">
          <span>
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </span>
          <span>{formatBytes(totalBytes)}</span>
        </div>
      </aside>
    </>
  );
}
