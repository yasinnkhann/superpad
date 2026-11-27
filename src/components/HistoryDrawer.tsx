"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Clock,
  FilePlus2,
  History,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import type { NoteTab, RevisionSummary, VaultData } from "@/types/vault";
import { decryptVault } from "@/lib/crypto";
import { formatBytes } from "@/lib/scanner";

interface HistoryDrawerProps {
  open: boolean;
  room: string;
  password: string;
  onRestoreVault: (vault: VaultData) => void;
  onImportTab: (tab: NoteTab) => void;
  onClose: () => void;
}

export default function HistoryDrawer({
  open,
  room,
  password,
  onRestoreVault,
  onImportTab,
  onClose,
}: HistoryDrawerProps) {
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingRev, setLoadingRev] = useState(false);
  const [previewVault, setPreviewVault] = useState<VaultData | null>(null);
  const [previewTabId, setPreviewTabId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingList(true);
    setError("");
    setSelectedId(null);
    setPreviewVault(null);

    fetch(`/api/vault/${encodeURIComponent(room)}/history`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setRevisions(Array.isArray(data.revisions) ? data.revisions : []);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load revision history.");
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, room]);

  const handleSelectRevision = async (rev: RevisionSummary) => {
    setSelectedId(rev.id);
    setLoadingRev(true);
    setError("");
    setPreviewVault(null);

    try {
      const res = await fetch(
        `/api/vault/${encodeURIComponent(room)}/history/${encodeURIComponent(rev.id)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Failed to fetch backup");
      const data = await res.json();
      const decrypted = await decryptVault(data.ciphertext, password);
      setPreviewVault(decrypted);
      setPreviewTabId(decrypted.tabs[0]?.id ?? null);
    } catch {
      setError(
        "Could not decrypt this backup with your current password (it may have been saved with an older password)."
      );
    } finally {
      setLoadingRev(false);
    }
  };

  if (!open) return null;

  const activePreviewTab =
    previewVault?.tabs.find((t) => t.id === previewTabId) ?? previewVault?.tabs[0] ?? null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl h-full bg-[#11161e] border-l border-[#2b323d] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#262e3a] bg-[#161b22] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <History className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold text-white">Encrypted Time Machine</h2>
            <span className="text-[11px] text-[#8b949e]">Last 10 cloud saves</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#8b949e] hover:bg-[#21262d] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col sm:flex-row min-h-0">
          {/* Left: Revision List */}
          <div className="w-full sm:w-64 border-b sm:border-b-0 sm:border-r border-[#262e3a] overflow-y-auto p-3 space-y-1.5 bg-[#0e1218]">
            {loadingList ? (
              <div className="flex items-center justify-center py-10 text-xs text-[#8b949e] gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading backups...</span>
              </div>
            ) : revisions.length === 0 ? (
              <div className="text-center py-10 text-xs text-[#6e7681]">
                No saved backups yet. Save your vault to create the first snapshot.
              </div>
            ) : (
              revisions.map((rev, index) => {
                const date = new Date(rev.timestamp);
                const isSelected = selectedId === rev.id;
                return (
                  <button
                    key={rev.id}
                    type="button"
                    onClick={() => handleSelectRevision(rev)}
                    className={`w-full text-left p-2.5 rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-violet-500/15 border-violet-500/50 text-white"
                        : "bg-[#131820] border-[#21262d] hover:border-[#30363d] text-[#c9d1d9]"
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-violet-400" />
                        {index === 0 ? "Latest save" : `Backup #${revisions.length - index}`}
                      </span>
                      <span className="text-[10px] font-mono text-[#6e7681]">
                        {formatBytes(rev.size)}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-[#8b949e] mt-1">
                      {date.toLocaleDateString()} • {date.toLocaleTimeString()}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Right: Decrypted Snapshot Preview */}
          <div className="flex-1 flex flex-col min-w-0 bg-[#0b0e14]">
            {loadingRev ? (
              <div className="flex-1 flex items-center justify-center text-xs text-[#8b949e] gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                <span>Decrypting snapshot locally...</span>
              </div>
            ) : error ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-2">
                <AlertTriangle className="w-6 h-6 text-amber-400" />
                <p className="text-xs text-[#c9d1d9] max-w-sm">{error}</p>
              </div>
            ) : !previewVault ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#6e7681] space-y-2">
                <History className="w-8 h-8 opacity-25" />
                <p className="text-xs">Select a backup on the left to decrypt and inspect it.</p>
              </div>
            ) : (
              <>
                {/* Snapshot Tabs + Actions */}
                <div className="px-4 py-2.5 border-b border-[#21262d] bg-[#131820] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1 overflow-x-auto">
                    {previewVault.tabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setPreviewTabId(tab.id)}
                        className={`px-2.5 py-1 rounded text-xs font-mono cursor-pointer transition-colors ${
                          activePreviewTab?.id === tab.id
                            ? "bg-[#21262d] text-white"
                            : "text-[#8b949e] hover:text-white"
                        }`}
                      >
                        {tab.title}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    {activePreviewTab ? (
                      <button
                        type="button"
                        onClick={() => {
                          onImportTab(activePreviewTab);
                          onClose();
                        }}
                        className="px-2.5 py-1 rounded-md bg-[#21262d] hover:bg-[#30363d] text-xs text-[#e6edf3] inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <FilePlus2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Open Tab as Copy</span>
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => {
                        onRestoreVault(previewVault);
                        onClose();
                      }}
                      className="px-2.5 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore Full Vault</span>
                    </button>
                  </div>
                </div>

                {/* Content Preview */}
                <div className="flex-1 overflow-auto p-4">
                  <pre className="font-mono text-xs text-[#c9d1d9] whitespace-pre-wrap break-words leading-relaxed">
                    {activePreviewTab?.content || "(Empty tab)"}
                  </pre>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
