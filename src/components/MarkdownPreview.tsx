"use client";

import React, { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";

interface MarkdownPreviewProps {
  content: string;
  onToggleCheckbox?: (lineIndex: number) => void;
}

function isSafeUrl(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  return (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("#")
  );
}

/**
 * Pure React inline markdown renderer (zero dangerouslySetInnerHTML, 100% XSS-safe & CSP-clean).
 */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Matches: `code`, [label](url), **bold**, ~~strike~~, *italic*, bare https:// URLs
  const tokenRegex =
    /(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*\n]+\*|https?:\/\/[^\s<>)\]]+)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${idx++}`;

    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="px-1.5 py-0.5 rounded bg-[#161b22] border border-[#262e3a] text-emerald-300 font-mono text-[0.88em]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("[")) {
      const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m && isSafeUrl(m[2])) {
        nodes.push(
          <a
            key={key}
            href={m[2].trim()}
            target={m[2].trim().startsWith("#") ? undefined : "_blank"}
            rel="noopener noreferrer"
            className="text-sky-400 hover:text-sky-300 underline decoration-sky-400/50 underline-offset-2"
          >
            {renderInline(m[1], `${key}-lbl`)}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-white">
          {renderInline(token.slice(2, -2), `${key}-b`)}
        </strong>
      );
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(
        <del key={key} className="line-through text-[#6e7681]">
          {renderInline(token.slice(2, -2), `${key}-s`)}
        </del>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={key} className="italic text-[#d2d9e2]">
          {renderInline(token.slice(1, -1), `${key}-i`)}
        </em>
      );
    } else if (token.startsWith("http://") || token.startsWith("https://")) {
      nodes.push(
        <a
          key={key}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300 underline decoration-sky-400/50 underline-offset-2 break-all"
        >
          {token}
        </a>
      );
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="my-3 rounded-lg bg-[#0d1117] border border-[#262e3a] overflow-hidden">
      <div className="px-3 py-1.5 bg-[#161b22] border-b border-[#21262d] flex items-center justify-between text-[11px] font-mono text-[#8b949e]">
        <span>{lang || "code"}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-xs font-mono text-[#e6edf3] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

type MdBlock =
  | { type: "heading"; level: number; text: string; line: number }
  | { type: "code"; lang: string; code: string; line: number }
  | { type: "hr"; line: number }
  | { type: "blockquote"; lines: string[]; line: number }
  | { type: "table"; headers: string[]; rows: string[][]; line: number }
  | {
      type: "list";
      ordered: boolean;
      items: { text: string; checked: boolean | null; lineIndex: number }[];
      line: number;
    }
  | { type: "paragraph"; text: string; line: number };

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function parseMarkdownBlocks(content: string): MdBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block
    const fenceMatch = line.match(/^```([\w-]*)\s*$/);
    if (fenceMatch) {
      const startLine = i;
      const lang = fenceMatch[1] || "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      blocks.push({ type: "code", lang, code: codeLines.join("\n"), line: startLine });
      continue;
    }

    // Horizontal rule
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push({ type: "hr", line: i });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
        line: i,
      });
      i++;
      continue;
    }

    // GFM Table
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])
    ) {
      const startLine = i;
      const headers = parseTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", headers, rows, line: startLine });
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const startLine = i;
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", lines: quoteLines, line: startLine });
      continue;
    }

    // Unordered or Task List
    if (/^\s*[-*+]\s+/.test(line)) {
      const startLine = i;
      const items: { text: string; checked: boolean | null; lineIndex: number }[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*[-*+]\s+/, "");
        const taskMatch = raw.match(/^\[([ xX])\]\s*(.*)$/);
        if (taskMatch) {
          items.push({
            text: taskMatch[2],
            checked: taskMatch[1].toLowerCase() === "x",
            lineIndex: i,
          });
        } else {
          items.push({ text: raw, checked: null, lineIndex: i });
        }
        i++;
      }
      blocks.push({ type: "list", ordered: false, items, line: startLine });
      continue;
    }

    // Ordered List
    if (/^\s*\d+\.\s+/.test(line)) {
      const startLine = i;
      const items: { text: string; checked: boolean | null; lineIndex: number }[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push({
          text: lines[i].replace(/^\s*\d+\.\s+/, ""),
          checked: null,
          lineIndex: i,
        });
        i++;
      }
      blocks.push({ type: "list", ordered: true, items, line: startLine });
      continue;
    }

    // Paragraph
    const startLine = i;
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", text: paraLines.join("\n"), line: startLine });
  }

  return blocks;
}

export default function MarkdownPreview({ content, onToggleCheckbox }: MarkdownPreviewProps) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  if (!content.trim()) {
    return (
      <div className="h-full overflow-y-auto p-6 bg-[#0d1117] text-xs text-[#6e7681] italic">
        Empty Markdown document — start typing to preview.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-5 bg-[#0d1117] text-[#c9d1d9] text-sm leading-7">
      <div className="max-w-3xl mx-auto space-y-3">
        {blocks.map((block, bIdx) => {
          const key = `b-${block.line}-${bIdx}`;
          switch (block.type) {
            case "heading": {
              const sizes: Record<number, string> = {
                1: "text-2xl font-bold text-white pb-2 border-b border-[#21262d] mt-2",
                2: "text-xl font-semibold text-white pb-1.5 border-b border-[#21262d] mt-4",
                3: "text-lg font-semibold text-white mt-3",
                4: "text-base font-semibold text-[#e6edf3] mt-2",
                5: "text-sm font-semibold text-[#e6edf3] mt-2",
                6: "text-xs font-semibold uppercase tracking-wider text-[#8b949e] mt-2",
              };
              const Tag = `h${block.level}` as keyof React.JSX.IntrinsicElements;
              return (
                <Tag key={key} className={sizes[block.level] || sizes[3]}>
                  {renderInline(block.text, key)}
                </Tag>
              );
            }
            case "code":
              return <CodeBlock key={key} lang={block.lang} code={block.code} />;
            case "hr":
              return <hr key={key} className="my-5 border-[#262e3a]" />;
            case "blockquote":
              return (
                <blockquote
                  key={key}
                  className="pl-4 py-1 border-l-2 border-emerald-500/60 bg-[#131820]/60 rounded-r text-[#9ca3af] italic space-y-1"
                >
                  {block.lines.map((l, li) => (
                    <p key={`${key}-q-${li}`}>{renderInline(l, `${key}-q-${li}`)}</p>
                  ))}
                </blockquote>
              );
            case "table":
              return (
                <div key={key} className="overflow-x-auto my-3 rounded-lg border border-[#262e3a]">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-[#161b22] text-[#e6edf3]">
                      <tr>
                        {block.headers.map((h, hi) => (
                          <th
                            key={`${key}-th-${hi}`}
                            className="px-3 py-2 border-b border-[#262e3a] font-semibold"
                          >
                            {renderInline(h, `${key}-th-${hi}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, ri) => (
                        <tr
                          key={`${key}-tr-${ri}`}
                          className="border-b border-[#21262d] last:border-b-0 odd:bg-[#0d1117] even:bg-[#11161e]"
                        >
                          {row.map((cell, ci) => (
                            <td key={`${key}-td-${ri}-${ci}`} className="px-3 py-2">
                              {renderInline(cell, `${key}-td-${ri}-${ci}`)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            case "list": {
              const hasTasks = block.items.some((it) => it.checked !== null);
              if (block.ordered) {
                return (
                  <ol key={key} className="list-decimal pl-6 space-y-1">
                    {block.items.map((it, ii) => (
                      <li key={`${key}-li-${ii}`}>{renderInline(it.text, `${key}-li-${ii}`)}</li>
                    ))}
                  </ol>
                );
              }
              return (
                <ul
                  key={key}
                  className={hasTasks ? "list-none pl-1 space-y-1.5" : "list-disc pl-6 space-y-1"}
                >
                  {block.items.map((it, ii) => {
                    if (it.checked !== null) {
                      return (
                        <li key={`${key}-li-${ii}`} className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={it.checked}
                            onChange={() => onToggleCheckbox?.(it.lineIndex)}
                            className="mt-1.5 w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer shrink-0"
                          />
                          <span className={it.checked ? "line-through text-[#6e7681]" : ""}>
                            {renderInline(it.text, `${key}-li-${ii}`)}
                          </span>
                        </li>
                      );
                    }
                    return (
                      <li key={`${key}-li-${ii}`}>{renderInline(it.text, `${key}-li-${ii}`)}</li>
                    );
                  })}
                </ul>
              );
            }
            case "paragraph":
              return (
                <p key={key} className="whitespace-pre-wrap break-words">
                  {renderInline(block.text, key)}
                </p>
              );
          }
        })}
      </div>
    </div>
  );
}
