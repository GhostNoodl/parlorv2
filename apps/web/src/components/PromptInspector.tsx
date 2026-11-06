import type { GenerateMode, PromptBlockKind, PromptPreview } from "@parlor/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Copy, Loader2, ScanEye, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";

const COLORS: Record<PromptBlockKind, string> = {
  main: "var(--accent)",
  character: "var(--accent-2)",
  persona: "var(--success)",
  examples: "#e8a95b",
  history: "var(--text-faint)",
  postHistory: "#e9788f",
  text: "#5bb8e8",
};

function asText(preview: PromptPreview): string {
  const parts = [`[system]\n${preview.prompt.system}`];
  for (const m of preview.prompt.messages) parts.push(`[${m.role}]\n${m.content}`);
  return parts.join("\n\n");
}

/** A slide-over that shows exactly what the model will read for the next reply. */
export function PromptInspector({ chatId, canRegenerate, onClose }: { chatId: string; canRegenerate: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<GenerateMode>("send");
  const [copied, setCopied] = useState(false);
  const query = useQuery({
    queryKey: ["prompt", chatId, mode],
    queryFn: () => api.promptPreview(chatId, mode),
    staleTime: 0,
    gcTime: 0,
  });
  const preview = query.data;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    if (!preview) return;
    await navigator.clipboard.writeText(asText(preview));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const budget = preview ? Math.max(1, preview.contextSize - preview.maxTokens) : 1;
  const parts = preview?.prompt.breakdown.filter((p) => p.tokens > 0) ?? [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[2px]" onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-label="Prompt inspector"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-xl animate-[slide-in_0.25s_ease-out] flex-col border-l border-line-strong bg-surface shadow-2xl shadow-black/40"
      >
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-5">
          <ScanEye size={19} className="text-accent" />
          <h2 className="flex-1 font-display text-lg font-semibold">Prompt inspector</h2>
          <button
            onClick={copy}
            disabled={!preview}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy all"}
          </button>
          <button onClick={onClose} aria-label="Close inspector" className="text-faint hover:text-ink">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div className="flex gap-1.5">
            {(
              [
                ["send", "Your next message"],
                ["regenerate", "Regenerating"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                disabled={m === "regenerate" && !canRegenerate}
                onClick={() => setMode(m)}
                className={clsx(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40",
                  mode === m ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {query.isError && <p className="text-sm text-danger">{(query.error as Error).message}</p>}
          {!preview && query.isLoading && <Loader2 size={20} className="mx-auto animate-spin text-faint" />}

          {preview && (
            <>
              {/* Budget */}
              <section className="space-y-3 rounded-2xl border border-line bg-surface-2/50 p-4">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>
                    <span className="font-display text-xl font-semibold">~{preview.prompt.estimatedTokens.toLocaleString()}</span>
                    <span className="text-muted"> of {budget.toLocaleString()} tokens</span>
                  </span>
                  <span className="truncate text-xs text-faint">
                    {preview.connection ? preview.connection.model : "No connection yet"} · {preview.maxTokens.toLocaleString()} saved for
                    the reply
                  </span>
                </div>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-3">
                  {parts.map((p) => (
                    <div
                      key={p.blockId}
                      title={`${p.name}: ~${p.tokens} tokens`}
                      style={{ width: `${Math.min(100, (p.tokens / budget) * 100)}%`, background: COLORS[p.kind] }}
                    />
                  ))}
                </div>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {parts.map((p) => (
                    <li key={p.blockId} className="flex items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: COLORS[p.kind] }} />
                      <span className="truncate text-muted">{p.name}</span>
                      <span className="ml-auto text-faint">{p.tokens.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-faint">
                  Preset:{" "}
                  <Link to="/prompts" onClick={onClose} className="text-accent hover:underline">
                    {preview.preset.name}
                  </Link>
                  {preview.prompt.droppedMessages > 0 && (
                    <>
                      {" "}
                      · {preview.prompt.droppedMessages} older message{preview.prompt.droppedMessages === 1 ? "" : "s"} didn't fit and{" "}
                      {preview.prompt.droppedMessages === 1 ? "was" : "were"} left out
                    </>
                  )}
                  . Token counts are estimates.
                </p>
              </section>

              <PromptBlockView role="system" text={preview.prompt.system} />
              {preview.prompt.messages.map((m, i) => (
                <PromptBlockView key={i} role={m.role} text={m.content} />
              ))}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function PromptBlockView({ role, text }: { role: "system" | "user" | "assistant"; text: string }) {
  return (
    <section>
      <div
        className={clsx(
          "mb-1.5 inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wider uppercase",
          role === "system" ? "bg-accent/12 text-accent" : role === "user" ? "bg-accent-2/12 text-accent-2" : "bg-surface-3 text-muted",
        )}
      >
        {role}
      </div>
      <pre className="rounded-xl border border-line bg-bg/40 p-3.5 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-ink/85">
        {text || <span className="text-faint italic">(empty)</span>}
      </pre>
    </section>
  );
}
