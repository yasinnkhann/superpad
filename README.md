# ZeroPad

**Zero-knowledge Notepad++ for the Web.**

Anonymous URL vaults (`/your-secret-room`) with client-side **AES-256-GCM** encryption, multi-tab **CodeMirror 6** editing, a boolean paragraph **Scanner**, regex **Find & Replace**, **Split View**, and **10-revision Encrypted Time Machine** backups.

---

## Features

- **Zero-Knowledge Architecture:** Passwords never leave your browser. All vault contents—including tab titles, notes, language modes, and bookmarks—are encrypted locally with **PBKDF2-SHA-256 (200,000 rounds)** + **AES-256-GCM** before upload. Even room slugs are SHA-256 hashed server-side before hitting storage.
- **Anonymous URL Rooms:** No accounts, no email, no tracking. Go to `/any-room-name`, set a password, and start writing.
- **Multi-Tab CodeMirror 6 Workspace:**
  - Independent per-tab undo/redo history, scroll position, and cursor memory
  - Line numbers, code folding, bracket matching, multi-cursor editing (`Alt+Click`)
  - 11 syntax modes: Plain Text, Markdown, JavaScript, TypeScript, Python, JSON, SQL, HTML, CSS, XML, YAML
  - 4 handcrafted dark themes: Midnight, One Dark, Monokai, Nord
  - **Notepad++ Line Bookmarks:** Click the gutter or press `⌘F2` to bookmark lines, `F2` to jump to the next bookmark
  - **Dual Split Pane:** View and edit two tabs side-by-side
- **Dual-Mode Search:**
  - **Find & Replace (`⌘F` / `⌘H`):** Match Case, Whole Word, Regular Expressions, live match counter, and atomic Replace All (undoable with `⌘Z`)
  - **Boolean Block Scanner (`⌘⇧F`):** Scan paragraph blocks across the current tab or all tabs with **AND / OR / NOT** comma-separated criteria, clickable links, keyword highlighting, jump-to-line, and one-click export of matches to a new tab
- **Notepad++ Text Tools:** Sort lines (A→Z / Z→A), remove duplicates, remove empty lines, trim trailing whitespace, pretty-print / minify JSON, insert date stamps (`⌘⇧D`), drag-and-drop file import, and decrypted export (`.txt` or `.json`).
- **Encrypted Time Machine:** Automatic rolling backups of your last 10 cloud saves—decrypt, preview, restore the full vault, or copy a single tab from any backup.
- **Smart Session & Dirty State:** Remember password locally for 15m / 1h / 24h (zero popup flicker on reload) and true undo-aware save state (undoing changes back to the saved state automatically clears the dirty indicator).

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘S` / `Ctrl+S` | Encrypt & Save Vault |
| `⌘F` / `Ctrl+F` | Find Bar |
| `⌘H` / `Ctrl+H` | Find & Replace Bar |
| `⌘⇧F` / `Ctrl+Shift+F` | Boolean Block Scanner |
| `⌘G` / `Ctrl+G` | Go to Line & Bookmarks |
| `⌘⇧D` / `Ctrl+Shift+D` | Insert Date Header (`=== YYYY-MM-DD ===`) |
| `⌘F2` / `Ctrl+F2` | Toggle Line Bookmark |
| `F2` | Jump to Next Bookmark |

---

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

When `BLOB_READ_WRITE_TOKEN` is not set, ZeroPad automatically stores encrypted vault blobs locally in `./.zeropad-data/` (gitignored), so everything works out-of-the-box offline with zero cloud configuration.

## Deploying to Vercel with Vercel Blob

1. Link your project and create a Blob store:
   ```bash
   vercel link
   vercel blob create-store zeropad-blob --access public
   ```
   *(Or use `--access private` and set `BLOB_ACCESS=private` in your Vercel project env vars.)*
2. Deploy:
   ```bash
   vercel --prod
   ```
