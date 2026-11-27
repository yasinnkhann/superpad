"use client";

import { useState } from "react";
import {
  AlertTriangle,
  KeyRound,
  Lock,
  Palette,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { EditorSettings, ThemeMode } from "@/types/vault";

interface SettingsModalProps {
  open: boolean;
  room: string;
  settings: EditorSettings;
  onUpdateSettings: (next: EditorSettings) => void;
  onChangePassword: (newPassword: string) => Promise<void>;
  onLockNow: () => void;
  onDeleteRoom: () => Promise<void>;
  onClose: () => void;
}

const THEME_OPTIONS: { id: ThemeMode; label: string; swatch: string }[] = [
  { id: "midnight", label: "Midnight", swatch: "#0d1117" },
  { id: "onedark", label: "One Dark", swatch: "#21252b" },
  { id: "monokai", label: "Monokai", swatch: "#1e1f1c" },
  { id: "nord", label: "Nord", swatch: "#242933" },
];

export default function SettingsModal({
  open,
  room,
  settings,
  onUpdateSettings,
  onChangePassword,
  onLockNow,
  onDeleteRoom,
  onClose,
}: SettingsModalProps) {
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdMessage, setPwdMessage] = useState("");
  const [changingPwd, setChangingPwd] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (!open) return null;

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd.length < 4) {
      setPwdMessage("Password must be at least 4 characters.");
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdMessage("Passwords do not match.");
      return;
    }
    setChangingPwd(true);
    setPwdMessage("");
    try {
      await onChangePassword(newPwd);
      setNewPwd("");
      setConfirmPwd("");
      setPwdMessage("Vault re-encrypted and saved with new password!");
    } catch (err) {
      setPwdMessage(err instanceof Error ? err.message : "Failed to update password.");
    } finally {
      setChangingPwd(false);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirm !== room) return;
    setDeleting(true);
    try {
      await onDeleteRoom();
    } finally {
      setDeleting(false);
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
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#262e3a] bg-[#161b22] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">Workspace Settings &amp; Security</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#8b949e] hover:bg-[#21262d] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Appearance */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b949e] flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" />
              Editor Preferences
            </h3>

            <div>
              <label className="block text-xs text-[#c9d1d9] mb-1.5">Color Theme</label>
              <div className="grid grid-cols-4 gap-2">
                {THEME_OPTIONS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onUpdateSettings({ ...settings, theme: t.id })}
                    className={`p-2 rounded-lg border text-xs flex flex-col items-center gap-1.5 cursor-pointer transition-all ${
                      settings.theme === t.id
                        ? "border-emerald-500 bg-emerald-500/10 text-white"
                        : "border-[#2b323d] bg-[#0d1117] text-[#8b949e] hover:text-white"
                    }`}
                  >
                    <span
                      className="w-full h-4 rounded border border-white/10"
                      style={{ backgroundColor: t.swatch }}
                    />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#c9d1d9] mb-1">
                  Font Size: <span className="font-mono text-emerald-400">{settings.fontSize}px</span>
                </label>
                <input
                  type="range"
                  min={12}
                  max={20}
                  value={settings.fontSize}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, fontSize: Number(e.target.value) })
                  }
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs text-[#c9d1d9] mb-1">Tab Indentation</label>
                <div className="flex gap-1.5">
                  {[2, 4].map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, tabSize: size })}
                      className={`flex-1 py-1 rounded text-xs font-mono border cursor-pointer ${
                        settings.tabSize === size
                          ? "bg-[#21262d] border-emerald-500/60 text-white"
                          : "bg-[#0d1117] border-[#2b323d] text-[#8b949e]"
                      }`}
                    >
                      {size} spaces
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-[#c9d1d9]">Show Line Numbers</span>
              <input
                type="checkbox"
                checked={settings.showLineNumbers}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, showLineNumbers: e.target.checked })
                }
                className="w-4 h-4 accent-emerald-500 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-[#c9d1d9]">Auto-Save (3s idle debounce)</div>
                <div className="text-[11px] text-[#6e7681]">
                  Automatically encrypt &amp; sync after you pause typing
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.autoSave}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, autoSave: e.target.checked })
                }
                className="w-4 h-4 accent-emerald-500 cursor-pointer"
              />
            </div>
          </section>

          <hr className="border-[#21262d]" />

          {/* Security & Session */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b949e] flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              Session &amp; Password
            </h3>

            <div>
              <label className="block text-xs text-[#c9d1d9] mb-1.5">
                Remember Password in This Browser
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { mins: 0, label: "Never" },
                  { mins: 15, label: "15 min" },
                  { mins: 60, label: "1 hour" },
                  { mins: 1440, label: "24 hours" },
                ].map((opt) => (
                  <button
                    key={opt.mins}
                    type="button"
                    onClick={() =>
                      onUpdateSettings({ ...settings, sessionTtlMinutes: opt.mins })
                    }
                    className={`py-1.5 rounded-lg text-xs border cursor-pointer transition-colors ${
                      settings.sessionTtlMinutes === opt.mins
                        ? "bg-emerald-500/15 border-emerald-500/60 text-emerald-300 font-medium"
                        : "bg-[#0d1117] border-[#2b323d] text-[#8b949e] hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handlePasswordSubmit} className="space-y-2 pt-1">
              <label className="block text-xs text-[#c9d1d9]">Change Vault Password</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="New password"
                  className="px-3 py-1.5 rounded-lg bg-[#0d1117] border border-[#2b323d] focus:border-emerald-500 text-xs text-white outline-none"
                />
                <input
                  type="password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  placeholder="Confirm new password"
                  className="px-3 py-1.5 rounded-lg bg-[#0d1117] border border-[#2b323d] focus:border-emerald-500 text-xs text-white outline-none"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-emerald-400">{pwdMessage}</span>
                <button
                  type="submit"
                  disabled={changingPwd || !newPwd}
                  className="px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-xs font-medium text-white disabled:opacity-40 cursor-pointer"
                >
                  {changingPwd ? "Re-encrypting..." : "Update Password"}
                </button>
              </div>
            </form>

            <div className="pt-1 flex items-center justify-between p-3 rounded-lg bg-[#0d1117] border border-[#21262d]">
              <div>
                <div className="text-xs font-medium text-white">Lock Session Immediately</div>
                <div className="text-[11px] text-[#6e7681]">
                  Wipes decrypted notes from memory &amp; clears saved browser session
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLockNow();
                }}
                className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Lock Now</span>
              </button>
            </div>
          </section>

          <hr className="border-[#21262d]" />

          {/* Danger Zone */}
          <section className="space-y-2.5 p-3.5 rounded-lg bg-rose-950/20 border border-rose-500/30">
            <h3 className="text-xs font-semibold text-rose-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Danger Zone — Delete Vault
            </h3>
            <p className="text-[11px] text-[#8b949e]">
              Permanently deletes <code className="text-rose-300">/{room}</code> and all 10 rolling backups from cloud storage. Type <code className="text-white">{room}</code> to confirm.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={room}
                className="flex-1 px-2.5 py-1.5 rounded bg-[#0d1117] border border-rose-500/40 text-xs font-mono text-white outline-none"
              />
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteConfirm !== room || deleting}
                className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-xs font-medium text-white disabled:opacity-30 inline-flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deleting ? "Deleting..." : "Delete"}</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
