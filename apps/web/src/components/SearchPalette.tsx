import type { SearchResult } from "@parlor/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CornerDownLeft, Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { Avatar } from "./Avatar";

export interface SearchScope {
  chatId: string;
  label: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

const when = (ts: number) => {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days < 1) return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 7) return new Date(ts).toLocaleDateString([], { weekday: "short" });
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
};

/** Wraps each case-insensitive occurrence of `query` in a <mark>. */
export function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, from)) {
    parts.push(
      text.slice(from, at),
      <mark key={at} className="rounded bg-accent/25 px-0.5 text-ink">
        {text.slice(at, at + q.length)}
      </mark>,
    );
    from = at + q.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

/** Ctrl/⌘ K: search every message in every chat, or just the open one. */
export function SearchPalette({ scope, onClose }: { scope: SearchScope | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [scoped, setScoped] = useState(Boolean(scope));
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebounced(text.trim(), 180);
  const chatId = scoped ? scope?.chatId : undefined;

  const results = useQuery({
    queryKey: ["search", q, chatId ?? null],
    queryFn: () => api.search(q, chatId),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  const items = q ? (results.data ?? []) : [];

  useEffect(() => setSelected(0), [q, chatId]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const open = (r: SearchResult) => {
    onClose();
    navigate(`/chat/${r.chatId}?${new URLSearchParams({ m: String(r.messageId), s: String(r.swipeId), q })}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-3 pt-[10vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Search chats"
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-rise flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl shadow-black/40"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          {results.isFetching ? (
            <Loader2 size={18} className="shrink-0 animate-spin text-faint" />
          ) : (
            <Search size={18} className="shrink-0 text-faint" />
          )}
          <input
            ref={inputRef}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((i) => Math.min(i + 1, items.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter" && items[selected]) open(items[selected]);
            }}
            placeholder={scoped && scope ? `Search ${scope.label}…` : "Search all your chats…"}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-faint focus:outline-none"
          />
          <button onClick={onClose} aria-label="Close search" className="text-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        {scope && (
          <div className="flex gap-1.5 border-b border-line px-4 py-2">
            {[
              { on: false, label: "All chats" },
              { on: true, label: "This chat" },
            ].map((chip) => (
              <button
                key={chip.label}
                onClick={() => {
                  setScoped(chip.on);
                  inputRef.current?.focus();
                }}
                className={clsx(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  scoped === chip.on ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        <ul ref={listRef} className="flex-1 overflow-y-auto p-2">
          {items.map((r, i) => (
            <li key={r.messageId}>
              <button
                data-index={i}
                onMouseMove={() => setSelected(i)}
                onClick={() => open(r)}
                className={clsx("flex w-full gap-3 rounded-xl px-3 py-2.5 text-left transition-colors", i === selected && "bg-surface-2")}
              >
                <Avatar
                  name={r.role === "assistant" ? r.characterName : "You"}
                  src={r.role === "assistant" ? r.characterAvatar : null}
                  size={34}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="font-display text-sm font-semibold">{r.role === "assistant" ? r.characterName : "You"}</span>
                    <span className="truncate text-faint">{r.chatTitle}</span>
                    <span className="ml-auto shrink-0 text-faint">{when(r.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-muted">
                    <Highlighted text={r.snippet} query={q} />
                  </p>
                </div>
                {i === selected && <CornerDownLeft size={14} className="mt-1 shrink-0 text-faint max-sm:hidden" />}
              </button>
            </li>
          ))}
          {q && results.isSuccess && !items.length && (
            <li className="px-4 py-10 text-center text-sm text-muted">Nothing matches "{q}". Maybe it was worded differently? 🤔</li>
          )}
          {!q && <li className="px-4 py-8 text-center text-sm text-faint">Find that one line you loved. Searches every swipe, too.</li>}
        </ul>
      </div>
    </div>
  );
}
