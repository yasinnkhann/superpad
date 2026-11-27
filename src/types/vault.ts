export type LanguageMode =
  | "plain"
  | "markdown"
  | "javascript"
  | "typescript"
  | "python"
  | "json"
  | "sql"
  | "html"
  | "css"
  | "xml"
  | "yaml";

export type ThemeMode = "midnight" | "onedark" | "monokai" | "nord";

export interface AuthUser {
  id: string;
  username: string;
  kdfSalt: string;
  createdAt: number;
}

export interface NoteMetadata {
  title: string;
  folder: string; // "" for root, or folder name like "Work", "Personal"
  language: LanguageMode;
  wordWrap: boolean;
  bookmarks: number[]; // 1-based line numbers
  pinned: boolean;
}

export interface NoteRecord extends NoteMetadata {
  id: string;
  content: string;
  version: number;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface EncryptedNoteDTO {
  id: string;
  encryptedMeta: string;
  encryptedContent: string;
  version: number;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface NoteRevisionSummary {
  id: string;
  noteId: string;
  version: number;
  sizeBytes: number;
  createdAt: number;
}

export interface EncryptedRevisionDTO extends NoteRevisionSummary {
  encryptedMeta: string;
  encryptedContent: string;
}

export interface EditorSettings {
  theme: ThemeMode;
  fontSize: number;
  sessionTtlMinutes: number; // 0 = never remember key across reloads, 15, 60, 1440
  idleLockMinutes: number; // 0 = off, 5, 15, 30, 60
  autoSave: boolean;
  showLineNumbers: boolean;
  tabSize: number;
}

export interface ScannerQuery {
  all: string;
  any: string;
  exclude: string;
  scope: "current" | "open" | "all";
  caseSensitive?: boolean;
}

export interface ScannerMatch {
  noteId: string;
  noteTitle: string;
  noteFolder: string;
  blockIndex: number;
  lineNumber: number;
  startOffset: number;
  endOffset: number;
  content: string;
}

export const LANGUAGE_LABELS: Record<LanguageMode, string> = {
  plain: "Plain Text",
  markdown: "Markdown",
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  json: "JSON",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  xml: "XML",
  yaml: "YAML",
};

export const LANGUAGE_EXTENSIONS: Record<LanguageMode, string> = {
  plain: "txt",
  markdown: "md",
  javascript: "js",
  typescript: "ts",
  python: "py",
  json: "json",
  sql: "sql",
  html: "html",
  css: "css",
  xml: "xml",
  yaml: "yml",
};

export const DEFAULT_SETTINGS: EditorSettings = {
  theme: "midnight",
  fontSize: 14,
  sessionTtlMinutes: 60,
  idleLockMinutes: 30,
  autoSave: false,
  showLineNumbers: true,
  tabSize: 2,
};

export function generateNoteId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function detectLanguageFromFilename(filename: string): LanguageMode {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "md":
    case "markdown":
      return "markdown";
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "py":
      return "python";
    case "json":
      return "json";
    case "sql":
      return "sql";
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "xml":
    case "svg":
      return "xml";
    case "yml":
    case "yaml":
      return "yaml";
    default:
      return "plain";
  }
}

export function normalizeNoteMetadata(input: unknown, fallbackTitle = "untitled.txt"): NoteMetadata {
  if (!input || typeof input !== "object") {
    return {
      title: fallbackTitle,
      folder: "",
      language: detectLanguageFromFilename(fallbackTitle),
      wordWrap: true,
      bookmarks: [],
      pinned: false,
    };
  }
  const obj = input as Partial<NoteMetadata>;
  const title =
    typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : fallbackTitle;
  const folder = typeof obj.folder === "string" ? obj.folder.trim().replace(/^\/+|\/+$/g, "") : "";
  const language: LanguageMode =
    typeof obj.language === "string" && obj.language in LANGUAGE_LABELS
      ? (obj.language as LanguageMode)
      : detectLanguageFromFilename(title);
  const wordWrap = typeof obj.wordWrap === "boolean" ? obj.wordWrap : true;
  const bookmarks = Array.isArray(obj.bookmarks)
    ? Array.from(
        new Set(obj.bookmarks.filter((n): n is number => typeof n === "number" && n >= 1))
      ).sort((a, b) => a - b)
    : [];
  const pinned = Boolean(obj.pinned);

  return { title, folder, language, wordWrap, bookmarks, pinned };
}

export function extractNoteMetadata(note: NoteRecord): NoteMetadata {
  return {
    title: note.title,
    folder: note.folder,
    language: note.language,
    wordWrap: note.wordWrap,
    bookmarks: note.bookmarks,
    pinned: note.pinned,
  };
}
