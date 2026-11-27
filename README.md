# ZeroPad

**Zero-knowledge Notepad++ for the Web — powered by Turso (libSQL / SQLite).**

Sign in with an anonymous handle and master password (no email, no OAuth) to manage all your end-to-end encrypted folders, notes, and code tabs across every device.

---

## Architecture & Security

- **Split-Key Zero-Knowledge Auth (Standard Notes / Proton design):**
  - The browser runs **PBKDF2-SHA-256 (200,000 rounds, 512 bits)** on `(password, userSalt)` and splits the output into two independent 256-bit keys:
    1. **`authKey`** → sent to `/api/auth/login` and verified server-side via **`scrypt` + timing-safe compare** to issue an `HttpOnly` session cookie.
    2. **`encryptionKey`** → **never leaves your browser**. Encrypts and decrypts every note's title, folder, language, bookmarks, and body locally via **AES-256-GCM**.
  - Username enumeration is prevented via HMAC-derived decoy salts on `/api/auth/challenge`.
- **Turso (libSQL / SQLite) Backend:**
  - Free tier gives **5 GB storage, 500M reads/mo, and 10M writes/mo** (no inactivity pausing).
  - Atomic `UNIQUE(username)` accounts, optimistic concurrency (`version` checks → `409 Conflict` resolution across devices), and **10 rolling encrypted backups per note**.
  - **Zero-config local dev:** Automatically opens a local SQLite database (`./.zeropad-data/zeropad.db`) when `TURSO_DATABASE_URL` is unset.
- **Notepad++ Crash Recovery:** Unsaved edits are automatically encrypted and persisted to local browser **IndexedDB** every second so a browser crash or reboot never loses typing.

---

## Features

- **Collapsible File-Tree Sidebar (`⌘B`):** Encrypted virtual folders, pinned notes, inline rename/move, quick search filter, and drag-and-drop file import.
- **Multi-Tab CodeMirror 6 Workspace:** Per-tab undo/redo history, line numbers, code folding, 11 languages, 4 dark themes, multi-cursor editing, **Dual Split View**, **Go to Line (`⌘G`)**, and **Line Bookmarks (`⌘F2` / `F2`)**.
- **Find & Replace Bar (`⌘F` / `⌘H`):** Match Case, Whole Word, Regex, live match counter, and atomic Replace All (undoable with `⌘Z`).
- **Boolean Block Scanner (`⌘⇧F`):** AND / OR / NOT paragraph scanner across **Current Note**, **Open Tabs**, or **All Account Notes**, with clickable URLs, keyword highlights, exact jump-to-line, and one-click export to a new note.
- **Text Tools & Time Machine:** Sort lines, remove duplicates/empty lines, trim trailing spaces, pretty/minify JSON, date stamps (`⌘⇧D`), and per-note 10-version encrypted revision preview/restore.

---

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create an anonymous handle, and start writing!

## Production Deployment (Vercel + Turso)

1. Create a free database at [turso.tech](https://turso.tech) (or via `turso db create zeropad`).
2. Add environment variables in Vercel:
   - `TURSO_DATABASE_URL=libsql://<your-db>.turso.io`
   - `TURSO_AUTH_TOKEN=<your-token>`
   - `AUTH_PEPPER=<random-32-byte-hex>`
3. Deploy:
   ```bash
   vercel --prod
   ```
