"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Extension,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  GutterMarker,
  crosshairCursor,
  drawSelection,
  dropCursor,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { tags } from "@lezer/highlight";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { sql } from "@codemirror/lang-sql";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import type { LanguageMode, ThemeMode } from "@/types/vault";

export interface CursorStats {
  line: number;
  col: number;
  selChars: number;
  selLines: number;
}

export interface SearchOptions {
  query: string;
  replaceText?: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

export interface SearchMatchSummary {
  total: number;
  currentIndex: number; // 1-based, 0 when none
  error?: string;
}

export interface CodeEditorHandle {
  focus: () => void;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  jumpToRange: (start: number, end: number) => void;
  jumpToLine: (lineNumber: number) => void;
  insertAtCursor: (text: string) => void;
  replaceFullDocument: (nextText: string) => void;
  toggleBookmarkAtCursor: () => void;
  jumpToNextBookmark: () => void;
  updateSearchHighlights: (opts: SearchOptions | null) => SearchMatchSummary;
  findStep: (opts: SearchOptions, direction: "next" | "prev") => SearchMatchSummary;
  replaceCurrent: (opts: SearchOptions) => SearchMatchSummary;
  replaceAllMatches: (opts: SearchOptions) => { replaced: number; error?: string };
}

interface CodeEditorProps {
  tabId: string;
  content: string;
  language: LanguageMode;
  wordWrap: boolean;
  bookmarks: number[];
  theme: ThemeMode;
  fontSize: number;
  tabSize: number;
  showLineNumbers: boolean;
  onChange: (nextContent: string) => void;
  onBookmarksChange: (nextBookmarks: number[]) => void;
  onCursorChange?: (stats: CursorStats) => void;
  onHistoryChange?: (stats: { canUndo: boolean; canRedo: boolean }) => void;
  onFocusPane?: () => void;
}

// ==========================================
// Themes & Syntax Highlighting
// ==========================================

interface ThemePalette {
  bg: string;
  gutterBg: string;
  gutterText: string;
  gutterActiveText: string;
  activeLine: string;
  selection: string;
  cursor: string;
  text: string;
  border: string;
  keyword: string;
  string: string;
  number: string;
  comment: string;
  func: string;
  type: string;
  variable: string;
  operator: string;
}

const PALETTES: Record<ThemeMode, ThemePalette> = {
  midnight: {
    bg: "#0d1117",
    gutterBg: "#0b0e14",
    gutterText: "#484f58",
    gutterActiveText: "#c9d1d9",
    activeLine: "rgba(56, 139, 253, 0.08)",
    selection: "rgba(56, 139, 253, 0.3)",
    cursor: "#58a6ff",
    text: "#e6edf3",
    border: "#1f2630",
    keyword: "#ff7b72",
    string: "#a5d6ff",
    number: "#79c0ff",
    comment: "#8b949e",
    func: "#d2a8ff",
    type: "#ffa657",
    variable: "#e6edf3",
    operator: "#79c0ff",
  },
  onedark: {
    bg: "#21252b",
    gutterBg: "#1d2026",
    gutterText: "#5c6370",
    gutterActiveText: "#abb2bf",
    activeLine: "rgba(171, 178, 191, 0.07)",
    selection: "rgba(97, 175, 239, 0.28)",
    cursor: "#528bff",
    text: "#abb2bf",
    border: "#2c313c",
    keyword: "#c678dd",
    string: "#98c379",
    number: "#d19a66",
    comment: "#5c6370",
    func: "#61afef",
    type: "#e5c07b",
    variable: "#e06c75",
    operator: "#56b6c2",
  },
  monokai: {
    bg: "#1e1f1c",
    gutterBg: "#191a17",
    gutterText: "#75715e",
    gutterActiveText: "#f8f8f2",
    activeLine: "rgba(255, 255, 255, 0.06)",
    selection: "rgba(166, 226, 46, 0.22)",
    cursor: "#f8f8f0",
    text: "#f8f8f2",
    border: "#2d2e27",
    keyword: "#f92672",
    string: "#e6db74",
    number: "#ae81ff",
    comment: "#75715e",
    func: "#a6e22e",
    type: "#66d9ef",
    variable: "#f8f8f2",
    operator: "#f92672",
  },
  nord: {
    bg: "#242933",
    gutterBg: "#1e222b",
    gutterText: "#616e88",
    gutterActiveText: "#d8dee9",
    activeLine: "rgba(136, 192, 208, 0.08)",
    selection: "rgba(136, 192, 208, 0.25)",
    cursor: "#88c0d0",
    text: "#e5e9f0",
    border: "#2e3440",
    keyword: "#81a1c1",
    string: "#a3be8c",
    number: "#b48ead",
    comment: "#616e88",
    func: "#88c0d0",
    type: "#ebcb8b",
    variable: "#d8dee9",
    operator: "#81a1c1",
  },
};

function buildThemeExtension(theme: ThemeMode, fontSize: number): Extension {
  const p = PALETTES[theme];
  const editorTheme = EditorView.theme(
    {
      "&": {
        backgroundColor: p.bg,
        color: p.text,
        fontSize: `${fontSize}px`,
      },
      ".cm-content": {
        caretColor: p.cursor,
        padding: "12px 0 64px 0",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: p.cursor,
        borderLeftWidth: "2px",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: p.selection,
      },
      ".cm-activeLine": {
        backgroundColor: p.activeLine,
      },
      ".cm-gutters": {
        backgroundColor: p.gutterBg,
        color: p.gutterText,
        borderRight: `1px solid ${p.border}`,
      },
      ".cm-activeLineGutter": {
        backgroundColor: p.activeLine,
        color: p.gutterActiveText,
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 10px 0 6px",
        minWidth: "40px",
      },
      ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: "rgba(88, 166, 255, 0.25)",
        outline: "1px solid rgba(88, 166, 255, 0.55)",
      },
    },
    { dark: true }
  );

  const highlight = HighlightStyle.define([
    { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: p.keyword },
    { tag: [tags.string, tags.special(tags.string)], color: p.string },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: p.number },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: p.comment, fontStyle: "italic" },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: p.func },
    { tag: [tags.typeName, tags.className, tags.tagName], color: p.type },
    { tag: [tags.variableName, tags.propertyName], color: p.variable },
    { tag: [tags.operator, tags.punctuation], color: p.operator },
    { tag: tags.heading, color: p.func, fontWeight: "bold" },
    { tag: tags.link, color: p.string, textDecoration: "underline" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
  ]);

  return [editorTheme, syntaxHighlighting(highlight)];
}

function getLanguageExtension(lang: LanguageMode): Extension {
  switch (lang) {
    case "markdown":
      return markdown();
    case "javascript":
      return javascript({ jsx: true });
    case "typescript":
      return javascript({ jsx: true, typescript: true });
    case "python":
      return python();
    case "json":
      return json();
    case "sql":
      return sql();
    case "html":
      return html();
    case "css":
      return css();
    case "xml":
      return xml();
    case "yaml":
      return yaml();
    default:
      return [];
  }
}

// ==========================================
// Bookmark Gutter Extension (Notepad++ style)
// ==========================================

class BookmarkMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-bookmark-dot";
    el.title = "Bookmarked line (click to remove)";
    return el;
  }
}

const bookmarkMarker = new BookmarkMarker();
const setBookmarksEffect = StateEffect.define<number[]>();

function buildBookmarkSet(doc: EditorState["doc"], lines: number[]): RangeSet<GutterMarker> {
  const validSorted = Array.from(
    new Set(lines.filter((ln) => ln >= 1 && ln <= doc.lines))
  ).sort((a, b) => a - b);

  const builder = new RangeSetBuilder<GutterMarker>();
  for (const ln of validSorted) {
    const lineInfo = doc.line(ln);
    builder.add(lineInfo.from, lineInfo.from, bookmarkMarker);
  }
  return builder.finish();
}

const bookmarkField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty;
  },
  update(markers, tr) {
    let next = markers.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setBookmarksEffect)) {
        next = buildBookmarkSet(tr.state.doc, effect.value);
      }
    }
    return next;
  },
});

function extractBookmarkLineNumbers(state: EditorState): number[] {
  const field = state.field(bookmarkField);
  const lines: number[] = [];
  const cursor = field.iter();
  while (cursor.value) {
    lines.push(state.doc.lineAt(cursor.from).number);
    cursor.next();
  }
  return Array.from(new Set(lines)).sort((a, b) => a - b);
}

// ==========================================
// Search Highlight Decorations
// ==========================================

interface MatchRange {
  from: number;
  to: number;
}

const setSearchHighlightsEffect = StateEffect.define<{
  matches: MatchRange[];
  activeIndex: number;
}>();

const matchMark = Decoration.mark({ class: "cm-search-match" });
const activeMatchMark = Decoration.mark({ class: "cm-search-match-active" });

const searchHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    let next = decos.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setSearchHighlightsEffect)) {
        const { matches, activeIndex } = effect.value;
        const builder = new RangeSetBuilder<Decoration>();
        for (let i = 0; i < matches.length; i++) {
          const m = matches[i];
          if (m.from < m.to && m.to <= tr.state.doc.length) {
            builder.add(m.from, m.to, i === activeIndex ? activeMatchMark : matchMark);
          }
        }
        next = builder.finish();
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function compileSearchRegex(opts: SearchOptions): { regex: RegExp | null; error?: string } {
  if (!opts.query) return { regex: null };
  try {
    let source = opts.useRegex
      ? opts.query
      : opts.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (opts.wholeWord) {
      source = `\\b(?:${source})\\b`;
    }
    const flags = opts.caseSensitive ? "g" : "gi";
    return { regex: new RegExp(source, flags) };
  } catch (err) {
    return {
      regex: null,
      error: err instanceof Error ? err.message : "Invalid regex",
    };
  }
}

function collectMatches(text: string, opts: SearchOptions): { matches: MatchRange[]; error?: string } {
  const { regex, error } = compileSearchRegex(opts);
  if (error) return { matches: [], error };
  if (!regex) return { matches: [] };

  const matches: MatchRange[] = [];
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m[0].length === 0) {
      regex.lastIndex++;
      if (regex.lastIndex > text.length) break;
      continue;
    }
    matches.push({ from: m.index, to: m.index + m[0].length });
    if (++guard > 20_000) break;
  }
  return { matches };
}

// ==========================================
// CodeEditor Component
// ==========================================

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  {
    tabId,
    content,
    language,
    wordWrap,
    bookmarks,
    theme,
    fontSize,
    tabSize,
    showLineNumbers,
    onChange,
    onBookmarksChange,
    onCursorChange,
    onHistoryChange,
    onFocusPane,
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Per-tab EditorState cache preserves undo/redo history & scroll/cursor per tab
  const statesRef = useRef<Map<string, EditorState>>(new Map());
  const currentTabIdRef = useRef<string>(tabId);

  // Dynamic compartments
  const languageComp = useRef(new Compartment());
  const themeComp = useRef(new Compartment());
  const wrapComp = useRef(new Compartment());
  const tabSizeComp = useRef(new Compartment());
  const lineNumComp = useRef(new Compartment());

  // Latest callbacks in refs to avoid rebuilding EditorView
  const onChangeRef = useRef(onChange);
  const onBookmarksChangeRef = useRef(onBookmarksChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onHistoryChangeRef = useRef(onHistoryChange);
  const onFocusPaneRef = useRef(onFocusPane);
  const activeSearchIndexRef = useRef<number>(-1);

  onChangeRef.current = onChange;
  onBookmarksChangeRef.current = onBookmarksChange;
  onCursorChangeRef.current = onCursorChange;
  onHistoryChangeRef.current = onHistoryChange;
  onFocusPaneRef.current = onFocusPane;

  const createTabState = (
    docText: string,
    tabLang: LanguageMode,
    tabWrap: boolean,
    tabBookmarks: number[]
  ): EditorState => {
    const bookmarkGutterExt = gutter({
      class: "cm-bookmark-gutter",
      markers: (v) => v.state.field(bookmarkField),
      initialSpacer: () => bookmarkMarker,
      domEventHandlers: {
        mousedown(view, line) {
          const lineNumber = view.state.doc.lineAt(line.from).number;
          const existing = extractBookmarkLineNumbers(view.state);
          const next = existing.includes(lineNumber)
            ? existing.filter((n) => n !== lineNumber)
            : [...existing, lineNumber].sort((a, b) => a - b);
          view.dispatch({ effects: setBookmarksEffect.of(next) });
          onBookmarksChangeRef.current(next);
          return true;
        },
      },
    });

    const state = EditorState.create({
      doc: docText,
      extensions: [
        bookmarkField,
        searchHighlightField,
        bookmarkGutterExt,
        lineNumComp.current.of(showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
        foldGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        languageComp.current.of(getLanguageExtension(tabLang)),
        themeComp.current.of(buildThemeExtension(theme, fontSize)),
        wrapComp.current.of(tabWrap ? EditorView.lineWrapping : []),
        tabSizeComp.current.of(EditorState.tabSize.of(tabSize)),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
            onHistoryChangeRef.current?.({
              canUndo: undoDepth(update.state) > 0,
              canRedo: redoDepth(update.state) > 0,
            });
            const updatedBookmarks = extractBookmarkLineNumbers(update.state);
            // Sync bookmark line shifts after inserting/deleting newlines
            const prevBookmarks = extractBookmarkLineNumbers(update.startState);
            if (
              updatedBookmarks.length !== prevBookmarks.length ||
              updatedBookmarks.some((v, idx) => v !== prevBookmarks[idx])
            ) {
              onBookmarksChangeRef.current(updatedBookmarks);
            }
          }
          if (update.selectionSet || update.docChanged) {
            const sel = update.state.selection.main;
            const headLine = update.state.doc.lineAt(sel.head);
            const fromLine = update.state.doc.lineAt(sel.from).number;
            const toLine = update.state.doc.lineAt(sel.to).number;
            const selChars = sel.to - sel.from;
            const selLines = selChars > 0 ? toLine - fromLine + 1 : 0;
            onCursorChangeRef.current?.({
              line: headLine.number,
              col: sel.head - headLine.from + 1,
              selChars,
              selLines,
            });
          }
          if (update.focusChanged && update.view.hasFocus) {
            onFocusPaneRef.current?.();
          }
        }),
      ],
    });

    if (tabBookmarks.length > 0) {
      return state.update({ effects: setBookmarksEffect.of(tabBookmarks) }).state;
    }
    return state;
  };

  // Mount EditorView once
  useEffect(() => {
    if (!hostRef.current) return;

    const initialState = createTabState(content, language, wordWrap, bookmarks);
    statesRef.current.set(tabId, initialState);
    currentTabIdRef.current = tabId;

    const view = new EditorView({
      state: initialState,
      parent: hostRef.current,
    });
    viewRef.current = view;

    const headLine = initialState.doc.lineAt(0);
    onHistoryChangeRef.current?.({
      canUndo: undoDepth(initialState) > 0,
      canRedo: redoDepth(initialState) > 0,
    });
    onCursorChangeRef.current?.({
      line: headLine.number,
      col: 1,
      selChars: 0,
      selLines: 0,
    });

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch active tab state seamlessly while preserving per-tab undo stack
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (currentTabIdRef.current !== tabId) {
      // Save outgoing tab state
      statesRef.current.set(currentTabIdRef.current, view.state);
      currentTabIdRef.current = tabId;

      let nextState = statesRef.current.get(tabId);
      if (!nextState) {
        nextState = createTabState(content, language, wordWrap, bookmarks);
      } else {
        // Ensure cached tab state matches current content & settings
        if (nextState.doc.toString() !== content) {
          nextState = nextState.update({
            changes: { from: 0, to: nextState.doc.length, insert: content },
          }).state;
        }
        nextState = nextState.update({
          effects: [
            languageComp.current.reconfigure(getLanguageExtension(language)),
            themeComp.current.reconfigure(buildThemeExtension(theme, fontSize)),
            wrapComp.current.reconfigure(wordWrap ? EditorView.lineWrapping : []),
            tabSizeComp.current.reconfigure(EditorState.tabSize.of(tabSize)),
            lineNumComp.current.reconfigure(
              showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []
            ),
            setBookmarksEffect.of(bookmarks),
          ],
        }).state;
      }

      view.setState(nextState);
      onHistoryChangeRef.current?.({
        canUndo: undoDepth(nextState) > 0,
        canRedo: redoDepth(nextState) > 0,
      });
      const sel = nextState.selection.main;
      const headLine = nextState.doc.lineAt(sel.head);
      onCursorChangeRef.current?.({
        line: headLine.number,
        col: sel.head - headLine.from + 1,
        selChars: sel.to - sel.from,
        selLines: sel.to > sel.from
          ? nextState.doc.lineAt(sel.to).number - nextState.doc.lineAt(sel.from).number + 1
          : 0,
      });
    } else if (view.state.doc.toString() !== content) {
      // External content update (e.g., split pane editing same tab or revision restore)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, content]);

  // Reconfigure dynamic extensions without resetting editor state
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageComp.current.reconfigure(getLanguageExtension(language)),
    });
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeComp.current.reconfigure(buildThemeExtension(theme, fontSize)),
    });
  }, [theme, fontSize]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapComp.current.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: tabSizeComp.current.reconfigure(EditorState.tabSize.of(tabSize)),
    });
  }, [tabSize]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: lineNumComp.current.reconfigure(
        showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []
      ),
    });
  }, [showLineNumbers]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = extractBookmarkLineNumbers(view.state);
    if (
      current.length !== bookmarks.length ||
      current.some((v, idx) => v !== bookmarks[idx])
    ) {
      view.dispatch({ effects: setBookmarksEffect.of(bookmarks) });
    }
  }, [bookmarks]);

  // Imperative Notepad++ Editor API
  useImperativeHandle(
    ref,
    () => ({
      focus() {
        viewRef.current?.focus();
      },
      undo(): boolean {
        const view = viewRef.current;
        if (!view) return false;
        const res = undo(view);
        onHistoryChangeRef.current?.({
          canUndo: undoDepth(view.state) > 0,
          canRedo: redoDepth(view.state) > 0,
        });
        return res;
      },
      redo(): boolean {
        const view = viewRef.current;
        if (!view) return false;
        const res = redo(view);
        onHistoryChangeRef.current?.({
          canUndo: undoDepth(view.state) > 0,
          canRedo: redoDepth(view.state) > 0,
        });
        return res;
      },
      canUndo(): boolean {
        const view = viewRef.current;
        if (!view) return false;
        return undoDepth(view.state) > 0;
      },
      canRedo(): boolean {
        const view = viewRef.current;
        if (!view) return false;
        return redoDepth(view.state) > 0;
      },
      jumpToRange(start: number, end: number) {
        const view = viewRef.current;
        if (!view) return;
        const max = view.state.doc.length;
        const safeStart = Math.max(0, Math.min(start, max));
        const safeEnd = Math.max(safeStart, Math.min(end, max));
        view.dispatch({
          selection: EditorSelection.range(safeStart, safeEnd),
          effects: EditorView.scrollIntoView(EditorSelection.range(safeStart, safeEnd), {
            y: "center",
          }),
        });
        view.focus();
      },
      jumpToLine(lineNumber: number) {
        const view = viewRef.current;
        if (!view) return;
        const clamped = Math.max(1, Math.min(lineNumber, view.state.doc.lines));
        const line = view.state.doc.line(clamped);
        view.dispatch({
          selection: EditorSelection.cursor(line.from),
          effects: EditorView.scrollIntoView(line.from, { y: "center" }),
        });
        view.focus();
      },
      insertAtCursor(text: string) {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: EditorSelection.cursor(from + text.length),
          scrollIntoView: true,
        });
        view.focus();
      },
      replaceFullDocument(nextText: string) {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: nextText },
        });
      },
      toggleBookmarkAtCursor() {
        const view = viewRef.current;
        if (!view) return;
        const lineNum = view.state.doc.lineAt(view.state.selection.main.head).number;
        const existing = extractBookmarkLineNumbers(view.state);
        const next = existing.includes(lineNum)
          ? existing.filter((n) => n !== lineNum)
          : [...existing, lineNum].sort((a, b) => a - b);
        view.dispatch({ effects: setBookmarksEffect.of(next) });
        onBookmarksChangeRef.current(next);
      },
      jumpToNextBookmark() {
        const view = viewRef.current;
        if (!view) return;
        const existing = extractBookmarkLineNumbers(view.state);
        if (existing.length === 0) return;
        const curLine = view.state.doc.lineAt(view.state.selection.main.head).number;
        const nextLine = existing.find((n) => n > curLine) ?? existing[0];
        const lineInfo = view.state.doc.line(nextLine);
        view.dispatch({
          selection: EditorSelection.cursor(lineInfo.from),
          effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
        });
        view.focus();
      },
      updateSearchHighlights(opts: SearchOptions | null): SearchMatchSummary {
        const view = viewRef.current;
        if (!view || !opts || !opts.query) {
          activeSearchIndexRef.current = -1;
          view?.dispatch({
            effects: setSearchHighlightsEffect.of({ matches: [], activeIndex: -1 }),
          });
          return { total: 0, currentIndex: 0 };
        }
        const docText = view.state.doc.toString();
        const { matches, error } = collectMatches(docText, opts);
        if (error) {
          view.dispatch({
            effects: setSearchHighlightsEffect.of({ matches: [], activeIndex: -1 }),
          });
          return { total: 0, currentIndex: 0, error };
        }
        if (matches.length === 0) {
          activeSearchIndexRef.current = -1;
          view.dispatch({
            effects: setSearchHighlightsEffect.of({ matches: [], activeIndex: -1 }),
          });
          return { total: 0, currentIndex: 0 };
        }
        const cursorPos = view.state.selection.main.from;
        let idx = matches.findIndex((m) => m.from >= cursorPos);
        if (idx === -1) idx = 0;
        activeSearchIndexRef.current = idx;
        view.dispatch({
          effects: [
            setSearchHighlightsEffect.of({ matches, activeIndex: idx }),
            EditorView.scrollIntoView(EditorSelection.range(matches[idx].from, matches[idx].to), {
              y: "center",
            }),
          ],
        });
        return { total: matches.length, currentIndex: idx + 1 };
      },
      findStep(opts: SearchOptions, direction: "next" | "prev"): SearchMatchSummary {
        const view = viewRef.current;
        if (!view || !opts.query) return { total: 0, currentIndex: 0 };
        const docText = view.state.doc.toString();
        const { matches, error } = collectMatches(docText, opts);
        if (error || matches.length === 0) {
          return { total: 0, currentIndex: 0, error };
        }
        let nextIdx: number;
        if (activeSearchIndexRef.current >= 0 && activeSearchIndexRef.current < matches.length) {
          nextIdx =
            direction === "next"
              ? (activeSearchIndexRef.current + 1) % matches.length
              : (activeSearchIndexRef.current - 1 + matches.length) % matches.length;
        } else {
          nextIdx = direction === "next" ? 0 : matches.length - 1;
        }
        activeSearchIndexRef.current = nextIdx;
        const target = matches[nextIdx];
        view.dispatch({
          selection: EditorSelection.range(target.from, target.to),
          effects: [
            setSearchHighlightsEffect.of({ matches, activeIndex: nextIdx }),
            EditorView.scrollIntoView(EditorSelection.range(target.from, target.to), {
              y: "center",
            }),
          ],
        });
        return { total: matches.length, currentIndex: nextIdx + 1 };
      },
      replaceCurrent(opts: SearchOptions): SearchMatchSummary {
        const view = viewRef.current;
        if (!view || !opts.query) return { total: 0, currentIndex: 0 };
        const docText = view.state.doc.toString();
        const { matches, error } = collectMatches(docText, opts);
        if (error || matches.length === 0) {
          return { total: 0, currentIndex: 0, error };
        }
        const idx =
          activeSearchIndexRef.current >= 0 && activeSearchIndexRef.current < matches.length
            ? activeSearchIndexRef.current
            : 0;
        const target = matches[idx];
        const replacement = opts.replaceText ?? "";
        view.dispatch({
          changes: { from: target.from, to: target.to, insert: replacement },
          selection: EditorSelection.cursor(target.from + replacement.length),
        });
        // Re-collect remaining matches and focus next
        const updatedText = view.state.doc.toString();
        const { matches: nextMatches } = collectMatches(updatedText, opts);
        if (nextMatches.length === 0) {
          activeSearchIndexRef.current = -1;
          view.dispatch({
            effects: setSearchHighlightsEffect.of({ matches: [], activeIndex: -1 }),
          });
          return { total: 0, currentIndex: 0 };
        }
        const nextIdx = idx % nextMatches.length;
        activeSearchIndexRef.current = nextIdx;
        const nextTarget = nextMatches[nextIdx];
        view.dispatch({
          selection: EditorSelection.range(nextTarget.from, nextTarget.to),
          effects: [
            setSearchHighlightsEffect.of({ matches: nextMatches, activeIndex: nextIdx }),
            EditorView.scrollIntoView(EditorSelection.range(nextTarget.from, nextTarget.to), {
              y: "center",
            }),
          ],
        });
        return { total: nextMatches.length, currentIndex: nextIdx + 1 };
      },
      replaceAllMatches(opts: SearchOptions): { replaced: number; error?: string } {
        const view = viewRef.current;
        if (!view || !opts.query) return { replaced: 0 };
        const docText = view.state.doc.toString();
        const { matches, error } = collectMatches(docText, opts);
        if (error || matches.length === 0) return { replaced: 0, error };
        const replacement = opts.replaceText ?? "";
        // Apply as a single atomic CodeMirror transaction so Ctrl+Z undoes Replace All cleanly!
        view.dispatch({
          changes: matches.map((m) => ({
            from: m.from,
            to: m.to,
            insert: replacement,
          })),
          effects: setSearchHighlightsEffect.of({ matches: [], activeIndex: -1 }),
        });
        activeSearchIndexRef.current = -1;
        return { replaced: matches.length };
      },
    }),
    []
  );

  return <div ref={hostRef} className="w-full h-full overflow-hidden" />;
});

export default CodeEditor;
