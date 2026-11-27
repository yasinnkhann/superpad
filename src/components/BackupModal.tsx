"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileJson,
  Loader2,
  Lock,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import type { NoteRecord } from "@/types/vault";
import {
  BackupInspection,
  BackupNoteEntry,
  createEncryptedBackupJson,
  createPlaintextBackupJson,
  decryptBackupFile,
  inspectBackupFile,
} from "@/lib/backup";

interface BackupModalProps {
  open: boolean;
  username: string;
  notes: NoteRecord[];
  extraFolders: string[];
  onRestoreBackup: (entries: BackupNoteEntry[], folders: string[]) => Promise<number>;
  onClose: () => void;
}

export default function BackupModal({
  open,
  username,
  notes,
  extraFolders,
  onRestoreBackup,
  onClose,
}: BackupModalProps) {
  const [encPwd, setEncPwd] = useState("");
  const [encPwdConfirm, setEncPwdConfirm] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<{ msg: string; err?: boolean } | null>(null);

  const [inspected, setInspected] = useState<BackupInspection | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [restorePwd, setRestorePwd] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<{ msg: string; err?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const downloadBlob = (filename: string, text: string) => {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleEncryptedExport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (encPwd.length < 4) {
      setExportStatus({ msg: "Enter a backup password (at least 4 characters).", err: true });
      return;
    }
    if (encPwd !== encPwdConfirm) {
      setExportStatus({ msg: "Backup passwords do not match.", err: true });
      return;
    }
    setExporting(true);
    setExportStatus(null);
    try {
      const json = await createEncryptedBackupJson(notes, extraFolders, encPwd);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(`superpad-${username}-${stamp}.enc.json`, json);
      setEncPwd("");
      setEncPwdConfirm("");
      setExportStatus({ msg: `Exported ${notes.length} encrypted note(s).` });
    } catch (err) {
      setExportStatus({
        msg: err instanceof Error ? err.message : "Encrypted export failed.",
        err: true,
      });
    } finally {
      setExporting(false);
    }
  };

  const handlePlaintextExport = () => {
    const json = createPlaintextBackupJson(notes, extraFolders);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(`superpad-${username}-${stamp}.json`, json);
    setExportStatus({ msg: `Downloaded plaintext backup (${notes.length} notes).` });
  };

  const handleFilePick = async (file: File) => {
    setRestoreStatus(null);
    setRestorePwd("");
    setSelectedFileName(file.name);
    try {
      const text = await file.text();
      const result = inspectBackupFile(text);
      setInspected(result);
      if (result.kind === "invalid") {
        setRestoreStatus({ msg: result.error, err: true });
      }
    } catch {
      setInspected(null);
      setRestoreStatus({ msg: "Could not read selected file.", err: true });
    }
  };

  const handleConfirmRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspected || inspected.kind === "invalid") return;
    setRestoring(true);
    setRestoreStatus(null);

    try {
      let toImport: { notes: BackupNoteEntry[]; folders: string[] };
      if (inspected.kind === "encrypted") {
        if (!restorePwd) {
          setRestoreStatus({ msg: "Enter the backup password to decrypt.", err: true });
          setRestoring(false);
          return;
        }
        toImport = await decryptBackupFile(inspected.payload, restorePwd);
      } else {
        toImport = { notes: inspected.notes, folders: inspected.folders };
      }

      const importedCount = await onRestoreBackup(toImport.notes, toImport.folders);
      setRestoreStatus({
        msg: `Restored ${importedCount} note(s) and ${toImport.folders.length} folder(s) into your vault.`,
      });
      setInspected(null);
      setSelectedFileName("");
      setRestorePwd("");
    } catch (err) {
      setRestoreStatus({
        msg: err instanceof Error ? err.message : "Restore failed.",
        err: true,
      });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[88vh] rounded-xl bg-[#131820] border border-[#30363d] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-[#262e3a] bg-[#161b22] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">Backup &amp; Restore</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#8b949e] hover:bg-[#21262d] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Export Section */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b949e] flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              Export Vault ({notes.length} active note{notes.length === 1 ? "" : "s"})
            </h3>

            <form
              onSubmit={handleEncryptedExport}
              className="p-3.5 rounded-lg bg-[#0e1218] border border-emerald-500/25 space-y-2.5"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                <Lock className="w-3.5 h-3.5" />
                <span>Encrypted Backup (.enc.json) — Recommended</span>
              </div>
              <p className="text-[11px] text-[#8b949e]">
                Encrypts all notes, folders, bookmarks, and pins with a dedicated backup passphrase before downloading.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="password"
                  value={encPwd}
                  onChange={(e) => setEncPwd(e.target.value)}
                  placeholder="Backup password"
                  className="px-3 py-1.5 rounded-lg bg-[#0b0e14] border border-[#2b323d] focus:border-emerald-500 text-xs text-white outline-none"
                />
                <input
                  type="password"
                  value={encPwdConfirm}
                  onChange={(e) => setEncPwdConfirm(e.target.value)}
                  placeholder="Confirm password"
                  className="px-3 py-1.5 rounded-lg bg-[#0b0e14] border border-[#2b323d] focus:border-emerald-500 text-xs text-white outline-none"
                />
              </div>
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={handlePlaintextExport}
                  className="text-[11px] text-[#8b949e] hover:text-white underline underline-offset-2 inline-flex items-center gap-1 cursor-pointer"
                >
                  <FileJson className="w-3 h-3" />
                  <span>Or download plaintext .json</span>
                </button>
                <button
                  type="submit"
                  disabled={exporting || !encPwd}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#0b0e14] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
                >
                  {exporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>Download Encrypted</span>
                </button>
              </div>
            </form>

            {exportStatus ? (
              <p
                className={`text-xs ${exportStatus.err ? "text-rose-400" : "text-emerald-400"}`}
              >
                {exportStatus.msg}
              </p>
            ) : null}
          </section>

          <hr className="border-[#21262d]" />

          {/* Restore Section */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b949e] flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5 text-sky-400" />
              Restore from Backup
            </h3>
            <p className="text-[11px] text-[#8b949e]">
              Select a SuperPad encrypted (<code className="text-[#c9d1d9]">.enc.json</code>) or plaintext (<code className="text-[#c9d1d9]">.json</code>) backup file. Restored notes are added alongside your existing notes.
            </p>

            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFilePick(file);
                e.target.value = "";
              }}
            />

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full py-3 px-4 rounded-lg border border-dashed border-[#30363d] hover:border-sky-400/60 bg-[#0e1218] text-xs text-[#c9d1d9] hover:text-white inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Upload className="w-4 h-4 text-sky-400" />
              <span>{selectedFileName || "Choose SuperPad Backup File (.json)"}</span>
            </button>

            {inspected && inspected.kind !== "invalid" ? (
              <form
                onSubmit={handleConfirmRestore}
                className="p-3.5 rounded-lg bg-[#0e1218] border border-sky-500/30 space-y-3"
              >
                {inspected.kind === "encrypted" ? (
                  <>
                    <div className="flex items-center gap-1.5 text-xs text-sky-300 font-medium">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Encrypted SuperPad Backup detected</span>
                    </div>
                    <input
                      type="password"
                      value={restorePwd}
                      onChange={(e) => setRestorePwd(e.target.value)}
                      placeholder="Enter backup password to decrypt"
                      autoFocus
                      className="w-full px-3 py-1.5 rounded-lg bg-[#0b0e14] border border-[#2b323d] focus:border-sky-400 text-xs text-white outline-none"
                    />
                  </>
                ) : (
                  <div className="text-xs text-[#c9d1d9]">
                    Ready to restore{" "}
                    <strong className="text-white">{inspected.notes.length} note(s)</strong>
                    {inspected.folders.length > 0
                      ? ` and ${inspected.folders.length} folder(s)`
                      : ""}
                    .
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setInspected(null);
                      setSelectedFileName("");
                      setRestorePwd("");
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#1b222c] text-xs text-[#c9d1d9] hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={restoring || (inspected.kind === "encrypted" && !restorePwd)}
                    className="px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-[#0b0e14] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
                  >
                    {restoring ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Restoring...</span>
                      </>
                    ) : (
                      <span>Restore Notes</span>
                    )}
                  </button>
                </div>
              </form>
            ) : null}

            {restoreStatus ? (
              <div
                className={`flex items-center gap-1.5 text-xs ${
                  restoreStatus.err ? "text-rose-400" : "text-emerald-400"
                }`}
              >
                {restoreStatus.err ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> : null}
                <span>{restoreStatus.msg}</span>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
