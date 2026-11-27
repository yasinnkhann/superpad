"use client";

import { useEffect, useRef, useState } from "react";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Regex,
  Replace,
  ReplaceAll,
  WholeWord,
  X,
} from "lucide-react";
import type { SearchMatchSummary, SearchOptions } from "@/components/CodeEditor";

interface FindReplaceBarProps {
  open: boolean;
  initialShowReplace?: boolean;
  summary: SearchMatchSummary;
  onOptionsChange: (opts: SearchOptions) => void;
  onStep: (opts: SearchOptions, dir: "next" | "prev") => void;
  onReplaceOne: (opts: SearchOptions) => void;
  onReplaceAll: (opts: SearchOptions) => void;
  onClose: () => void;
}

export default function FindReplaceBar({
  open,
  initialShowReplace = false,
  summary,
  onOptionsChange,
  onStep,
  onReplaceOne,
  onReplaceAll,
  onClose,
}: FindReplaceBarProps) {
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [showReplace, setShowReplace] = useState(initialShowReplace);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const findInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setShowReplace((prev) => initialShowReplace || prev);
      requestAnimationFrame(() => {
        findInputRef.current?.focus();
        findInputRef.current?.select();
      });
    }
  }, [open, initialShowReplace]);

  useEffect(() => {
    if (!open) return;
    onOptionsChange({
      query,
      replaceText,
      caseSensitive,
      wholeWord,
      useRegex,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, caseSensitive, wholeWord, useRegex]);

  if (!open) return null;

  const currentOpts: SearchOptions = {
    query,
    replaceText,
    caseSensitive,
    wholeWord,
    useRegex,
  };

  const handleFindKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      onStep(currentOpts, e.shiftKey ? "prev" : "next");
    }
  };

  const handleReplaceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        onReplaceAll(currentOpts);
      } else {
        onReplaceOne(currentOpts);
      }
    }
  };

  return (
    <div className="absolute top-2 right-4 z-30 w-[min(460px,calc(100%-2rem))] rounded-lg bg-[#161b22]/95 backdrop-blur-md border border-[#30363d] shadow-2xl shadow-black/60 p-2">
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          onClick={() => setShowReplace((v) => !v)}
          title="Toggle Replace"
          className="mt-1 p-1 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white cursor-pointer"
        >
          {showReplace ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>

        <div className="flex-1 space-y-1.5 min-w-0">
          {/* Find Row */}
          <div className="flex items-center gap-1.5">
            <div className="flex-1 flex items-center bg-[#0d1117] border border-[#30363d] focus-within:border-[#58a6ff] rounded px-2 py-1 gap-1 min-w-0">
              <input
                ref={findInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleFindKeyDown}
                placeholder="Find..."
                className="flex-1 bg-transparent text-xs text-[#e6edf3] placeholder-[#484f58] outline-none font-mono min-w-0"
              />
              <button
                type="button"
                onClick={() => setCaseSensitive((v) => !v)}
                title="Match Case"
                className={`p-1 rounded cursor-pointer transition-colors ${
                  caseSensitive
                    ? "bg-[#1f6feb] text-white"
                    : "text-[#8b949e] hover:bg-[#21262d] hover:text-white"
                }`}
              >
                <CaseSensitive className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setWholeWord((v) => !v)}
                title="Match Whole Word"
                className={`p-1 rounded cursor-pointer transition-colors ${
                  wholeWord
                    ? "bg-[#1f6feb] text-white"
                    : "text-[#8b949e] hover:bg-[#21262d] hover:text-white"
                }`}
              >
                <WholeWord className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setUseRegex((v) => !v)}
                title="Use Regular Expression"
                className={`p-1 rounded cursor-pointer transition-colors ${
                  useRegex
                    ? "bg-[#1f6feb] text-white"
                    : "text-[#8b949e] hover:bg-[#21262d] hover:text-white"
                }`}
              >
                <Regex className="w-3.5 h-3.5" />
              </button>
            </div>

            <span
              className={`text-[11px] font-mono min-w-[56px] text-center ${
                summary.error
                  ? "text-rose-400"
                  : summary.total > 0
                    ? "text-[#c9d1d9]"
                    : "text-[#6e7681]"
              }`}
              title={summary.error}
            >
              {summary.error
                ? "Regex err"
                : query
                  ? summary.total > 0
                    ? `${summary.currentIndex}/${summary.total}`
                    : "0/0"
                  : ""}
            </span>

            <button
              type="button"
              onClick={() => onStep(currentOpts, "prev")}
              disabled={summary.total === 0}
              title="Previous Match (Shift+Enter)"
              className="p-1 rounded text-[#8b949e] hover:bg-[#21262d] hover:text-white disabled:opacity-30 cursor-pointer"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onStep(currentOpts, "next")}
              disabled={summary.total === 0}
              title="Next Match (Enter)"
              className="p-1 rounded text-[#8b949e] hover:bg-[#21262d] hover:text-white disabled:opacity-30 cursor-pointer"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="p-1 rounded text-[#8b949e] hover:bg-[#21262d] hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Replace Row */}
          {showReplace ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                onKeyDown={handleReplaceKeyDown}
                placeholder="Replace with..."
                className="flex-1 bg-[#0d1117] border border-[#30363d] focus:border-[#58a6ff] rounded px-2 py-1 text-xs text-[#e6edf3] placeholder-[#484f58] outline-none font-mono min-w-0"
              />
              <button
                type="button"
                onClick={() => onReplaceOne(currentOpts)}
                disabled={summary.total === 0}
                title="Replace Current (Enter)"
                className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] text-[11px] inline-flex items-center gap-1 disabled:opacity-30 cursor-pointer"
              >
                <Replace className="w-3 h-3" />
                <span>Replace</span>
              </button>
              <button
                type="button"
                onClick={() => onReplaceAll(currentOpts)}
                disabled={summary.total === 0}
                title="Replace All (Cmd/Ctrl+Enter)"
                className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] text-[11px] inline-flex items-center gap-1 disabled:opacity-30 cursor-pointer"
              >
                <ReplaceAll className="w-3 h-3" />
                <span>All</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
