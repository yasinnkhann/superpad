import type { NoteRecord, ScannerMatch, ScannerQuery } from "@/types/vault";

export function parseCriteriaList(raw: string, caseSensitive = false): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(",")
    .map((term) => (caseSensitive ? term.trim() : term.trim().toLowerCase()))
    .filter(Boolean);
}

interface IndexedBlock {
  content: string;
  flattened: string;
  startOffset: number;
  endOffset: number;
  lineNumber: number;
}

interface CachedNoteBlocks {
  contentLength: number;
  version?: number;
  sample: string;
  blocks: IndexedBlock[];
}

const noteBlocksCache = new Map<string, CachedNoteBlocks>();

/**
 * Splits note text into paragraph blocks separated by one or more blank lines
 * (matching Python `re.split(r"\n\s*\n", content)`), while tracking exact
 * character offsets and 1-based starting line numbers for instant Jump-To.
 *
 * Performance note: uses an O(N) single-pass cursor to track line numbers
 * monotonically without re-scanning characters from offset 0 for every block.
 */
export function extractParagraphBlocks(text: string): IndexedBlock[] {
  const blocks: IndexedBlock[] = [];
  if (!text) return blocks;

  const separator = /\n[ \t]*\n/g;
  let lastIndex = 0;
  let currentLine = 1;
  let cursorCharIndex = 0;

  const advanceCursorTo = (targetIndex: number) => {
    while (cursorCharIndex < targetIndex) {
      if (text.charCodeAt(cursorCharIndex) === 10) currentLine++;
      cursorCharIndex++;
    }
  };

  const pushSlice = (rawStart: number, rawEnd: number) => {
    const slice = text.slice(rawStart, rawEnd);
    const trimmed = slice.trim();
    if (!trimmed) {
      advanceCursorTo(rawEnd);
      return;
    }

    const leadingWs = slice.length - slice.trimStart().length;
    const startOffset = rawStart + leadingWs;
    const endOffset = startOffset + trimmed.length;

    advanceCursorTo(startOffset);
    const lineNumber = currentLine;
    advanceCursorTo(rawEnd);

    const flattened = trimmed
      .split("\n")
      .map((line) => line.trim())
      .join(" ");

    blocks.push({
      content: trimmed,
      flattened,
      startOffset,
      endOffset,
      lineNumber,
    });
  };

  let match: RegExpExecArray | null;
  while ((match = separator.exec(text)) !== null) {
    pushSlice(lastIndex, match.index);
    advanceCursorTo(match.index + match[0].length);
    lastIndex = match.index + match[0].length;
  }
  pushSlice(lastIndex, text.length);

  return blocks;
}

export function getCachedOrExtractNoteBlocks(note: NoteRecord): IndexedBlock[] {
  const sample = note.content.slice(0, 64);
  const cached = noteBlocksCache.get(note.id);
  if (
    cached &&
    cached.contentLength === note.content.length &&
    cached.version === note.version &&
    cached.sample === sample
  ) {
    return cached.blocks;
  }

  const blocks = extractParagraphBlocks(note.content);
  noteBlocksCache.set(note.id, {
    contentLength: note.content.length,
    version: note.version,
    sample,
    blocks,
  });

  if (noteBlocksCache.size > 100) {
    const oldestKey = noteBlocksCache.keys().next().value;
    if (oldestKey) noteBlocksCache.delete(oldestKey);
  }

  return blocks;
}

/**
 * Runs the boolean paragraph scanner across current tab, open tabs, or ALL notes in the account:
 * - all: every comma-separated term MUST appear in the block (AND)
 * - any: at least one comma-separated term MUST appear in the block (OR)
 * - exclude: NONE of these comma-separated terms may appear in the block (NOT)
 */
export function runBooleanScanner(
  allNotes: NoteRecord[],
  openNoteIds: string[],
  activeNoteId: string | null,
  query: ScannerQuery
): { matches: ScannerMatch[]; totalBlocks: number; highlightTerms: string[] } {
  const caseSensitive = Boolean(query.caseSensitive);
  const allTerms = parseCriteriaList(query.all, caseSensitive);
  const anyTerms = parseCriteriaList(query.any, caseSensitive);
  const excludeTerms = parseCriteriaList(query.exclude, caseSensitive);

  const openSet = new Set(openNoteIds);
  const targetNotes =
    query.scope === "all"
      ? allNotes
      : query.scope === "open"
        ? allNotes.filter((n) => openSet.has(n.id))
        : allNotes.filter((n) => n.id === activeNoteId);

  let totalBlocks = 0;
  const hasCriteria = allTerms.length > 0 || anyTerms.length > 0 || excludeTerms.length > 0;
  const matches: ScannerMatch[] = [];

  for (const note of targetNotes) {
    const blocks = getCachedOrExtractNoteBlocks(note);
    totalBlocks += blocks.length;

    if (!hasCriteria) continue;

    blocks.forEach((block, blockIndex) => {
      const haystack = caseSensitive ? block.flattened : block.flattened.toLowerCase();

      if (allTerms.length > 0 && !allTerms.every((term) => haystack.includes(term))) {
        return;
      }
      if (anyTerms.length > 0 && !anyTerms.some((term) => haystack.includes(term))) {
        return;
      }
      if (excludeTerms.length > 0 && excludeTerms.some((term) => haystack.includes(term))) {
        return;
      }

      matches.push({
        noteId: note.id,
        noteTitle: note.title,
        noteFolder: note.folder,
        blockIndex,
        lineNumber: block.lineNumber,
        startOffset: block.startOffset,
        endOffset: block.endOffset,
        content: block.content,
      });
    });
  }

  const highlightTerms = Array.from(new Set([...allTerms, ...anyTerms]));
  return { matches, totalBlocks, highlightTerms };
}

// ==========================================
// Notepad++ Power Text Operations
// ==========================================

export function sortLines(text: string, direction: "asc" | "desc" = "asc"): string {
  const lines = text.split("\n");
  const sorted = [...lines].sort((a, b) =>
    direction === "asc"
      ? a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      : b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" })
  );
  return sorted.join("\n");
}

export function deduplicateLines(text: string): { result: string; removed: number } {
  const lines = text.split("\n");
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of lines) {
    if (!seen.has(line)) {
      seen.add(line);
      kept.push(line);
    }
  }
  return { result: kept.join("\n"), removed: lines.length - kept.length };
}

export function removeEmptyLines(text: string): { result: string; removed: number } {
  const lines = text.split("\n");
  const kept = lines.filter((line) => line.trim().length > 0);
  return { result: kept.join("\n"), removed: lines.length - kept.length };
}

export function trimTrailingWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
}

export function formatJsonText(
  text: string,
  minify = false
): { ok: true; result: string } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text);
    return {
      ok: true,
      result: minify ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid JSON",
    };
  }
}

export function createDateStamp(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `=== ${yyyy}-${mm}-${dd} ===`;
}

export function computeTextStats(text: string): {
  lines: number;
  words: number;
  chars: number;
  bytes: number;
} {
  if (!text) {
    return { lines: 1, words: 0, chars: 0, bytes: 0 };
  }
  const lines = text.split("\n").length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  const bytes = new TextEncoder().encode(text).length;
  return { lines, words, chars, bytes };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
