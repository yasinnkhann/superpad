"use client";

import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  CaseSensitive,
  Check,
  Copy,
  CornerDownRight,
  FilePlus2,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { NoteRecord, ScannerMatch } from "@/types/vault";
import { runBooleanScanner } from "@/lib/scanner";

interface ScannerModalProps {
  open: boolean;
  allNotes: NoteRecord[];
  openNoteIds: string[];
  activeNoteId: string | null;
  onJumpToMatch: (match: ScannerMatch) => void;
  onExportMatchesToNote: (title: string, content: string) => void;
  onClose: () => void;
}

const URL_SPLIT_REGEX = /(https?:\/\/[^\s)<>"]+)/g;

function renderHighlightedText(text: string, terms: string[], caseSensitive: boolean) {
  const cleanedTerms = Array.from(new Set(terms.filter(Boolean)));
  const termRegex =
    cleanedTerms.length > 0
      ? new RegExp(
          `(${cleanedTerms
            .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|")})`,
          caseSensitive ? "g" : "gi"
        )
      : null;

  const highlightSegment = (segment: string, keyPrefix: string) => {
    if (!termRegex) return segment;
    const parts = segment.split(termRegex);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <mark
          key={`${keyPrefix}-m-${i}`}
          className="bg-amber-500/80 text-[#0b0e14] px-1 rounded font-semibold"
        >
          {part}
        </mark>
      ) : (
        <Fragment key={`${keyPrefix}-t-${i}`}>{part}</Fragment>
      )
    );
  };

  const urlParts = text.split(URL_SPLIT_REGEX);
  return urlParts.map((chunk, idx) => {
    if (idx % 2 === 1) {
      return (
        <a
          key={`url-${idx}`}
          href={chunk}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300 underline break-all"
        >
          {highlightSegment(chunk, `u-${idx}`)}
        </a>
      );
    }
    return <Fragment key={`txt-${idx}`}>{highlightSegment(chunk, `p-${idx}`)}</Fragment>;
  });
}

export default function ScannerModal({
  open,
  allNotes,
  openNoteIds,
  activeNoteId,
  onJumpToMatch,
  onExportMatchesToNote,
  onClose,
}: ScannerModalProps) {
  const [allInput, setAllInput] = useState("");
  const [anyInput, setAnyInput] = useState("");
  const [excludeInput, setExcludeInput] = useState("");
  const [scope, setScope] = useState<"current" | "open" | "all">("current");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const allInputRef = useRef<HTMLInputElement | null>(null);

  const deferredAll = useDeferredValue(allInput);
  const deferredAny = useDeferredValue(anyInput);
  const deferredExclude = useDeferredValue(excludeInput);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => allInputRef.current?.focus());
    }
  }, [open]);

  const { matches, totalBlocks, highlightTerms } = useMemo(() => {
    if (!open) {
      return { matches: [], totalBlocks: 0, highlightTerms: [] };
    }
    return runBooleanScanner(allNotes, openNoteIds, activeNoteId, {
      all: deferredAll,
      any: deferredAny,
      exclude: deferredExclude,
      scope,
      caseSensitive,
    });
  }, [
    open,
    allNotes,
    openNoteIds,
    activeNoteId,
    deferredAll,
    deferredAny,
    deferredExclude,
    scope,
    caseSensitive,
  ]);

  if (!open) return null;

  const hasCriteria = Boolean(allInput.trim() || anyInput.trim() || excludeInput.trim());

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleExport = () => {
    if (matches.length === 0) return;
    const summaryLabel = [allInput.trim(), anyInput.trim()].filter(Boolean).join(" ") || "scan";
    const tabTitle = `scan-${summaryLabel.slice(0, 18).replace(/[^a-zA-Z0-9_-]+/g, "-")}.txt`;
    const body = matches.map((m) => m.content).join("\n\n");
    onExportMatchesToNote(tabTitle, body);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl h-[85vh] max-h-[760px] rounded-xl bg-[#131820] border border-[#30363d] shadow-2xl shadow-black/70 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-[#262e3a] bg-[#161b22]">
          <div className="flex items-center gap-2.5">
            <Search className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Boolean Block Scanner</h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Scope Toggle: Current / Open Tabs / All Account Notes */}
            <div className="flex items-center p-0.5 rounded-lg bg-[#0d1117] border border-[#2b323d] text-xs">
              <button
                type="button"
                onClick={() => setScope("current")}
                className={`px-2 py-1 rounded-md transition-colors cursor-pointer ${
                  scope === "current"
                    ? "bg-[#21262d] text-white font-medium"
                    : "text-[#8b949e] hover:text-white"
                }`}
              >
                Current
              </button>
              <button
                type="button"
                onClick={() => setScope("open")}
                className={`px-2 py-1 rounded-md transition-colors cursor-pointer ${
                  scope === "open"
                    ? "bg-[#21262d] text-white font-medium"
                    : "text-[#8b949e] hover:text-white"
                }`}
              >
                Open ({openNoteIds.length})
              </button>
              <button
                type="button"
                onClick={() => setScope("all")}
                className={`px-2 py-1 rounded-md transition-colors cursor-pointer ${
                  scope === "all"
                    ? "bg-[#21262d] text-white font-medium"
                    : "text-[#8b949e] hover:text-white"
                }`}
              >
                All Notes ({allNotes.length})
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="p-1.5 rounded-lg text-[#8b949e] hover:bg-[#21262d] hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Criteria Form */}
        <div className="p-4 bg-[#0f131a] border-b border-[#262e3a] space-y-3">
          <div className="grid grid-cols-1 gap-2.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[#8b949e]">
                  Must contain ALL criteria
                </label>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                  AND
                </span>
              </div>
              <input
                ref={allInputRef}
                type="text"
                value={allInput}
                onChange={(e) => setAllInput(e.target.value)}
                placeholder="Comma-separated terms, e.g. alpha, beta"
                className="w-full px-3 py-2 rounded-lg bg-[#0b0e14] border border-[#2b323d] focus:border-emerald-500/70 text-xs font-mono text-white placeholder-[#484f58] outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[#8b949e]">
                    Can contain ANY criteria
                  </label>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400">
                    OR
                  </span>
                </div>
                <input
                  type="text"
                  value={anyInput}
                  onChange={(e) => setAnyInput(e.target.value)}
                  placeholder="Comma-separated, e.g. idea, todo"
                  className="w-full px-3 py-2 rounded-lg bg-[#0b0e14] border border-[#2b323d] focus:border-sky-500/70 text-xs font-mono text-white placeholder-[#484f58] outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[#8b949e]">
                    Must EXCLUDE criteria
                  </label>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400">
                    NOT
                  </span>
                </div>
                <input
                  type="text"
                  value={excludeInput}
                  onChange={(e) => setExcludeInput(e.target.value)}
                  placeholder="Comma-separated, e.g. archived, draft"
                  className="w-full px-3 py-2 rounded-lg bg-[#0b0e14] border border-[#2b323d] focus:border-rose-500/70 text-xs font-mono text-white placeholder-[#484f58] outline-none"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="text-xs text-[#8b949e]">
              {hasCriteria ? (
                <span>
                  Found{" "}
                  <strong className="text-white font-mono">
                    {matches.length.toLocaleString()}
                  </strong>{" "}
                  matching {matches.length === 1 ? "entry" : "entries"} out of{" "}
                  {totalBlocks.toLocaleString()} blocks
                </span>
              ) : (
                <span>{totalBlocks.toLocaleString()} paragraph blocks indexed</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCaseSensitive((v) => !v)}
                className={`px-2 py-1 rounded-md text-xs inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                  caseSensitive
                    ? "bg-[#1f6feb]/20 border-[#1f6feb] text-sky-300"
                    : "bg-[#161b22] border-[#2b323d] text-[#8b949e] hover:text-white"
                }`}
              >
                <CaseSensitive className="w-3.5 h-3.5" />
                <span>Case</span>
              </button>

              {matches.length > 0 ? (
                <button
                  type="button"
                  onClick={handleExport}
                  className="px-2.5 py-1 rounded-md text-xs inline-flex items-center gap-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 cursor-pointer transition-colors"
                >
                  <FilePlus2 className="w-3.5 h-3.5" />
                  <span>Save Matches to New Note</span>
                </button>
              ) : null}

              {hasCriteria ? (
                <button
                  type="button"
                  onClick={() => {
                    setAllInput("");
                    setAnyInput("");
                    setExcludeInput("");
                    allInputRef.current?.focus();
                  }}
                  className="px-2.5 py-1 rounded-md text-xs inline-flex items-center gap-1 bg-[#161b22] hover:bg-[#21262d] text-[#8b949e] hover:text-white border border-[#2b323d] cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0b0e14]">
          {!hasCriteria ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-[#6e7681] space-y-2 py-12">
              <Search className="w-8 h-8 opacity-30" />
              <p className="text-sm text-[#8b949e]">
                Enter comma-separated keywords in AND, OR, or NOT above.
              </p>
              <p className="text-xs max-w-md">
                Switch scope to All Notes to search across every encrypted note in your account instantly.
              </p>
            </div>
          ) : matches.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-[#6e7681] py-12">
              <p className="text-sm text-[#8b949e]">No matching entries found.</p>
            </div>
          ) : (
            matches.slice(0, 250).map((match, idx) => {
              const cardKey = `${match.noteId}-${match.startOffset}`;
              const isCopied = copiedKey === cardKey;
              return (
                <div
                  key={cardKey}
                  className="rounded-lg bg-[#131820] border border-[#262e3a] hover:border-[#3c485a] p-3.5 transition-colors"
                >
                  <div className="font-mono text-[13px] leading-relaxed text-[#e6edf3] whitespace-pre-wrap break-words">
                    {renderHighlightedText(match.content, highlightTerms, caseSensitive)}
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-[#1e2530] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[11px] font-mono text-[#8b949e]">
                      <span className="text-[#6e7681]">#{idx + 1}</span>
                      <span className="px-1.5 py-0.5 rounded bg-[#1b222c] text-[#c9d1d9]">
                        {match.noteFolder ? `${match.noteFolder} / ` : ""}
                        {match.noteTitle}
                      </span>
                      <span>Ln {match.lineNumber}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleCopy(cardKey, match.content)}
                        className="px-2 py-1 rounded bg-[#1b222c] hover:bg-[#262f3f] text-[#c9d1d9] text-[11px] inline-flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onJumpToMatch(match);
                          onClose();
                        }}
                        className="px-2 py-1 rounded bg-[#1f6feb]/20 hover:bg-[#1f6feb]/35 text-sky-300 border border-[#1f6feb]/30 text-[11px] inline-flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <CornerDownRight className="w-3 h-3" />
                        <span>Jump to</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          {matches.length > 250 ? (
            <p className="text-center text-xs text-[#6e7681] py-2">
              Showing first 250 of {matches.length.toLocaleString()} matches. Narrow your query or save all matches to a new note.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
