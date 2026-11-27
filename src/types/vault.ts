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

export interface NoteTab {
  id: string;
  title: string;
  content: string;
  language: LanguageMode;
  wordWrap: boolean;
  bookmarks: number[]; // 1-based line numbers
  createdAt: number;
  updatedAt: number;
}

export interface VaultData {
  version: 1;
  activeTabId: string;
  splitTabId: string | null;
  tabs: NoteTab[];
  updatedAt: number;
}

export interface EditorSettings {
  theme: ThemeMode;
  fontSize: number;
  sessionTtlMinutes: number; // 0 = never remember, 15, 60, 1440
  autoSave: boolean;
  showLineNumbers: boolean;
  tabSize: number;
}

export interface RevisionSummary {
  id: string;
  timestamp: number;
  size: number;
}

export interface ScannerQuery {
  all: string;
  any: string;
  exclude: string;
  scope: "current" | "all";
  caseSensitive?: boolean;
}

export interface ScannerMatch {
  tabId: string;
  tabTitle: string;
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
  autoSave: false,
  showLineNumbers: true,
  tabSize: 2,
};

export function generateTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
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

export function createNewTab(
  title = "untitled.txt",
  content = "",
  language?: LanguageMode
): NoteTab {
  const now = Date.now();
  return {
    id: generateTabId(),
    title,
    content,
    language: language ?? detectLanguageFromFilename(title),
    wordWrap: true,
    bookmarks: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultVault(initialTitle = "notes.txt", initialContent = ""): VaultData {
  const tab = createNewTab(initialTitle, initialContent);
  return {
    version: 1,
    activeTabId: tab.id,
    splitTabId: null,
    tabs: [tab],
    updatedAt: Date.now(),
  };
}

export function normalizeVaultData(input: unknown): VaultData {
  if (typeof input === "string") {
    return createDefaultVault("notes.txt", input);
  }
  if (!input || typeof input !== "object") {
    return createDefaultVault();
  }
  const obj = input as Partial<VaultData>;
  const rawTabs: unknown[] = Array.isArray(obj.tabs) ? obj.tabs : [];
  const tabs: NoteTab[] = rawTabs
    .filter((t): t is Partial<NoteTab> => !!t && typeof t === "object")
    .map((t, i) => ({
      id: typeof t.id === "string" && t.id ? t.id : generateTabId(),
      title: typeof t.title === "string" && t.title.trim() ? t.title : `note-${i + 1}.txt`,
      content: typeof t.content === "string" ? t.content : "",
      language:
        typeof t.language === "string" && t.language in LANGUAGE_LABELS
          ? (t.language as LanguageMode)
          : "plain",
      wordWrap: typeof t.wordWrap === "boolean" ? t.wordWrap : true,
      bookmarks: Array.isArray(t.bookmarks)
        ? t.bookmarks.filter((n): n is number => typeof n === "number" && n > 0)
        : [],
      createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
      updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : Date.now(),
    }));

  if (tabs.length === 0) {
    return createDefaultVault();
  }

  const activeTabId =
    typeof obj.activeTabId === "string" && tabs.some((t) => t.id === obj.activeTabId)
      ? obj.activeTabId
      : tabs[0].id;

  const splitTabId =
    typeof obj.splitTabId === "string" &&
    obj.splitTabId !== activeTabId &&
    tabs.some((t) => t.id === obj.splitTabId)
      ? obj.splitTabId
      : null;

  return {
    version: 1,
    activeTabId,
    splitTabId,
    tabs,
    updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : Date.now(),
  };
}
