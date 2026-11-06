import type { Character, GenerateMode, Message } from "@parlor/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FastForward,
  Menu,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Avatar, nameHue } from "../components/Avatar";
import { Button, IconButton } from "../components/ui";
import { api, generate, type ChatDetail } from "../lib/api";
import { keys, useActiveConnection, useActivePersona, useNewChat, usePersonas } from "../lib/hooks";
import { useLayout } from "../lib/layout";
import { RpText } from "../lib/rp-text";

interface Streaming {
  mode: GenerateMode;
  /** The message being regenerated or continued. */
  targetId: number | null;
  /** The user's message, shown right away while the reply streams. */
  pendingUser: string | null;
  text: string;
}

export function ChatPage() {
  const { chatId = "" } = useParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: keys.chat(chatId), queryFn: () => api.chat(chatId) });
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stop any in-flight generation when leaving the chat.
  useEffect(() => () => abortRef.current?.abort(), [chatId]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: keys.chat(chatId) });
    if (query.data) queryClient.invalidateQueries({ queryKey: keys.chats(query.data.character.id) });
  }, [chatId, queryClient, query.data]);

  const run = useCallback(
    async (mode: GenerateMode, text?: string) => {
      if (abortRef.current) return;
      const messages = query.data?.messages ?? [];
      const last = messages.at(-1);
      const targetId = mode !== "send" && last?.role === "assistant" ? last.id : null;
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setStreaming({ mode, targetId, pendingUser: text?.trim() || null, text: "" });

      try {
        await generate(
          chatId,
          { mode, text },
          (event) => {
            if (event.type === "token") setStreaming((s) => s && { ...s, text: s.text + event.text });
            if (event.type === "error") setError(event.error);
          },
          controller.signal,
        );
      } catch (err) {
        if (!controller.signal.aborted) setError((err as Error).message);
      } finally {
        // On stop, give the server a moment to save the partial reply.
        if (controller.signal.aborted) await new Promise((r) => setTimeout(r, 250));
        abortRef.current = null;
        await refresh();
        setStreaming(null);
      }
    },
    [chatId, query.data, refresh],
  );

  const stop = () => abortRef.current?.abort();

  if (query.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-muted">This chat doesn't exist anymore.</p>
        <Link to="/">
          <Button>Back home</Button>
        </Link>
      </div>
    );
  }
  if (!query.data) return <div className="flex-1" />;

  return (
    <ChatView
      key={chatId}
      detail={query.data}
      streaming={streaming}
      error={error}
      onDismissError={() => setError(null)}
      onRun={run}
      onStop={stop}
    />
  );
}

function ChatView({
  detail,
  streaming,
  error,
  onDismissError,
  onRun,
  onStop,
}: {
  detail: ChatDetail;
  streaming: Streaming | null;
  error: string | null;
  onDismissError: () => void;
  onRun: (mode: GenerateMode, text?: string) => void;
  onStop: () => void;
}) {
  const { chat, character, messages } = detail;
  const queryClient = useQueryClient();
  const persona = useActivePersona();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const hue = nameHue(character.name);
  const lastAssistant = messages.at(-1)?.role === "assistant" ? messages.at(-1) : undefined;

  const setMessage = (updated: Message) =>
    queryClient.setQueryData<ChatDetail>(keys.chat(chat.id), (d) => d && { ...d, messages: d.messages.map((m) => (m.id === updated.id ? updated : m)) });

  const swipe = useMutation({
    mutationFn: ({ message, to }: { message: Message; to: number }) => api.updateMessage(message.id, { swipeId: to }),
    onMutate: ({ message, to }) => setMessage({ ...message, swipeId: to }),
    onSuccess: setMessage,
  });

  const onSwipe = (message: Message, dir: -1 | 1) => {
    const to = message.swipeId + dir;
    if (to < 0) return;
    if (to >= message.swipes.length) {
      // Past the last swipe means "write a new one", except on the opening greeting.
      if (messages.length > 1) onRun("regenerate");
      return;
    }
    else swipe.mutate({ message, to });
  };

  // Follow the conversation as it grows, unless the user scrolled up to read.
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming?.text, streaming?.pendingUser]);

  const busy = streaming !== null;
  const user: UserInfo = { name: persona?.name ?? "You", avatar: persona?.avatar ?? null };

  return (
    <>
      {/* Character colour glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-[0.15] blur-3xl"
        style={{ background: `radial-gradient(60% 100% at 50% 0%, hsl(${hue} 80% 65%), transparent)` }}
      />
      <ChatHeader detail={detail} />

      <div ref={scrollRef} onScroll={onScroll} className="relative flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-4 pt-6 pb-10 sm:px-6">
          {messages.length === 0 && !streaming && (
            <div className="py-16 text-center text-muted">
              <Avatar name={character.name} src={character.avatar} size={72} className="mx-auto mb-4" />
              <p className="font-display text-xl">Say hello to {character.name}.</p>
            </div>
          )}
          {messages.map((message) => {
            const isTarget = streaming?.targetId === message.id;
            let override: string | undefined;
            if (isTarget && streaming.mode === "regenerate") override = streaming.text;
            if (isTarget && streaming.mode === "continue") override = (message.swipes[message.swipeId] ?? "") + streaming.text;
            return (
              <MessageItem
                key={message.id}
                message={message}
                character={character}
                user={user}
                override={override}
                streaming={isTarget}
                swipeLabel={isTarget && streaming.mode === "regenerate" ? `${message.swipes.length + 1}/${message.swipes.length + 1}` : undefined}
                canSwipe={!busy && message.id === lastAssistant?.id && (messages.length > 1 || message.swipes.length > 1)}
                busy={busy}
                onSwipe={(dir) => onSwipe(message, dir)}
                onChange={setMessage}
                isGreetingOnly={messages.length === 1}
              />
            );
          })}
          {streaming?.pendingUser && <UserBubble user={user} text={streaming.pendingUser} />}
          {streaming?.mode === "send" && (
            <AssistantShell character={character}>
              {streaming.text ? <RpText text={streaming.text} streaming /> : <TypingDots />}
            </AssistantShell>
          )}
        </div>
      </div>

      <Composer
        characterName={character.name}
        busy={busy}
        error={error}
        canContinue={Boolean(lastAssistant) && messages.length > 1}
        onDismissError={onDismissError}
        onSend={(text) => {
          stickToBottom.current = true;
          onRun("send", text);
        }}
        onRegenerate={() => onRun("regenerate")}
        onContinue={() => onRun("continue")}
        onStop={onStop}
        onSwipeKey={(dir) => lastAssistant && onSwipe(lastAssistant, dir)}
      />
    </>
  );
}

function ChatHeader({ detail }: { detail: ChatDetail }) {
  const { openMenu } = useLayout();
  const { chat, character } = detail;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const newChat = useNewChat();
  const connection = useActiveConnection();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chat.title);

  const rename = async () => {
    setEditing(false);
    if (!title.trim() || title === chat.title) return setTitle(chat.title);
    await api.renameChat(chat.id, title.trim());
    queryClient.invalidateQueries({ queryKey: keys.chat(chat.id) });
    queryClient.invalidateQueries({ queryKey: keys.chats(character.id) });
  };

  const remove = async () => {
    if (!confirm(`Delete "${chat.title}"? This can't be undone.`)) return;
    await api.deleteChat(chat.id);
    await queryClient.invalidateQueries({ queryKey: keys.chats(character.id) });
    navigate("/");
  };

  return (
    <header className="glass relative z-10 flex h-16 shrink-0 items-center gap-3 border-b border-line px-3 sm:px-5">
      <IconButton label="Open menu" onClick={openMenu} className="lg:hidden">
        <Menu size={20} />
      </IconButton>
      <Link to={`/characters/${character.id}`} title={`Edit ${character.name}`} className="shrink-0 transition-opacity hover:opacity-80">
        <Avatar name={character.name} src={character.avatar} size={38} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/characters/${character.id}`} className="block truncate font-display text-lg leading-tight font-semibold hover:text-accent">
          {character.name}
        </Link>
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename();
              if (e.key === "Escape") {
                setTitle(chat.title);
                setEditing(false);
              }
            }}
            className="w-full max-w-xs rounded border-b border-accent-2 bg-transparent text-xs text-ink outline-none"
          />
        ) : (
          <button onClick={() => setEditing(true)} className="block max-w-full truncate text-xs text-faint hover:text-muted" title="Rename chat">
            {chat.title}
          </button>
        )}
      </div>
      <Link
        to="/settings"
        className={clsx(
          "hidden items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors sm:flex",
          connection ? "border-line text-muted hover:border-line-strong hover:text-ink" : "border-danger/40 text-danger",
        )}
      >
        <span className={clsx("size-1.5 rounded-full", connection ? "bg-success" : "bg-danger")} />
        <span className="max-w-48 truncate">{connection ? connection.model || connection.name : "No model connected"}</span>
      </Link>
      <IconButton label="New chat" onClick={() => newChat(character.id)}>
        <MessageSquarePlus size={18} />
      </IconButton>
      <IconButton label="Delete chat" onClick={remove} className="hover:text-danger">
        <Trash2 size={17} />
      </IconButton>
    </header>
  );
}

function AssistantShell({ character, children, actions }: { character: Character; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="group animate-rise flex gap-3 sm:gap-4">
      <Avatar name={character.name} src={character.avatar} size={40} className="mt-0.5 hidden sm:flex" />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          <Avatar name={character.name} src={character.avatar} size={24} className="sm:hidden" />
          <span className="font-display font-semibold">{character.name}</span>
          {actions}
        </div>
        <div className="text-[15px] text-ink/90 sm:text-base">{children}</div>
      </div>
    </div>
  );
}

interface UserInfo {
  name: string;
  avatar: string | null;
}

function UserBubble({ user, text, children, actions }: { user: UserInfo; text?: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="group animate-rise flex flex-col items-end">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-faint">
        {actions}
        <span className="font-medium">{user.name}</span>
        <Avatar name={user.name} src={user.avatar} size={22} />
      </div>
      <div className="max-w-[88%] rounded-2xl rounded-tr-md border border-line bg-user-bubble px-4 py-3 text-[15px] sm:text-base">
        {children ?? <RpText text={text ?? ""} />}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex h-6 items-center gap-1" aria-label="Typing">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-bounce rounded-full bg-accent/70" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

function MessageItem({
  message,
  character,
  user,
  override,
  streaming,
  swipeLabel,
  canSwipe,
  busy,
  onSwipe,
  onChange,
  isGreetingOnly,
}: {
  message: Message;
  character: Character;
  user: UserInfo;
  override?: string;
  streaming: boolean;
  swipeLabel?: string;
  canSwipe: boolean;
  busy: boolean;
  onSwipe: (dir: -1 | 1) => void;
  onChange: (message: Message) => void;
  isGreetingOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const text = override ?? message.swipes[message.swipeId] ?? "";

  const save = async () => {
    onChange(await api.updateMessage(message.id, { content: draft }));
    setEditing(false);
  };
  const remove = async () => {
    if (!confirm("Delete this message?")) return;
    await api.deleteMessage(message.id);
    queryClient.invalidateQueries({ queryKey: keys.chat(message.chatId) });
  };
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const actions = !busy && !editing && (
    <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-60">
      <IconButton label="Copy" onClick={copy} className="size-7">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </IconButton>
      <IconButton
        label="Edit"
        className="size-7"
        onClick={() => {
          setDraft(text);
          setEditing(true);
        }}
      >
        <Pencil size={14} />
      </IconButton>
      <IconButton label="Delete" onClick={remove} className="size-7 hover:text-danger">
        <Trash2 size={14} />
      </IconButton>
    </div>
  );

  const body = editing ? (
    <div className="space-y-2">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
        rows={Math.min(14, Math.max(3, draft.split("\n").length + 1))}
        className="w-full min-w-64 rounded-xl border border-accent-2/40 bg-surface-2 p-3 text-[15px] leading-relaxed text-ink outline-none focus:ring-2 focus:ring-accent-2/20"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={save}>
          Save
        </Button>
      </div>
    </div>
  ) : streaming && !text ? (
    <TypingDots />
  ) : (
    <RpText text={text} streaming={streaming} />
  );

  if (message.role === "user") {
    return (
      <UserBubble user={user} actions={actions}>
        {body}
      </UserBubble>
    );
  }

  const total = message.swipes.length;
  return (
    <AssistantShell character={character} actions={actions}>
      {body}
      {(canSwipe || swipeLabel || total > 1) && !editing && (
        <div className="mt-2 flex items-center gap-1 text-xs text-faint">
          <IconButton label="Previous swipe" className="size-7" disabled={!canSwipe || message.swipeId === 0} onClick={() => onSwipe(-1)}>
            <ChevronLeft size={16} />
          </IconButton>
          <span className="min-w-8 text-center tabular-nums">{swipeLabel ?? `${message.swipeId + 1}/${total}`}</span>
          <IconButton
            label={message.swipeId === total - 1 ? "Generate a new swipe" : "Next swipe"}
            className="size-7"
            disabled={!canSwipe || (isGreetingOnly && message.swipeId === total - 1)}
            onClick={() => onSwipe(1)}
          >
            <ChevronRight size={16} />
          </IconButton>
        </div>
      )}
    </AssistantShell>
  );
}

function Composer({
  characterName,
  busy,
  error,
  canContinue,
  onDismissError,
  onSend,
  onRegenerate,
  onContinue,
  onStop,
  onSwipeKey,
}: {
  characterName: string;
  busy: boolean;
  error: string | null;
  canContinue: boolean;
  onDismissError: () => void;
  onSend: (text: string) => void;
  onRegenerate: () => void;
  onContinue: () => void;
  onStop: () => void;
  onSwipeKey: (dir: -1 | 1) => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to a limit.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const submit = () => {
    if (busy) return;
    onSend(text);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      submit();
    }
    if (!text && !busy && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      onSwipeKey(e.key === "ArrowLeft" ? -1 : 1);
    }
  };

  return (
    <div className="relative shrink-0 px-3 pb-3 sm:px-6 sm:pb-5" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
      <div className="mx-auto max-w-3xl">
        {error && (
          <div className="animate-rise mb-2 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">
            <span className="flex-1">{error}</span>
            {error.includes("Settings") && (
              <Link to="/settings" className="font-medium underline underline-offset-2">
                Open Settings
              </Link>
            )}
            <button aria-label="Dismiss" onClick={onDismissError}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="glass rounded-2xl border border-line shadow-2xl shadow-black/10 transition-colors focus-within:border-accent-2/50">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={`Message ${characterName}…`}
            className="block max-h-56 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-relaxed text-ink placeholder:text-faint focus:outline-none sm:text-base"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <IconButton label="Regenerate reply" disabled={busy || !canContinue} onClick={onRegenerate}>
              <RefreshCw size={16} />
            </IconButton>
            <IconButton label="Continue reply" disabled={busy || !canContinue} onClick={onContinue}>
              <FastForward size={16} />
            </IconButton>
            <PersonaSwitcher />
            <span className="ml-1 hidden text-xs text-faint xl:inline">Enter to send · Shift+Enter for a new line · ←/→ to swipe</span>
            <div className="flex-1" />
            {busy ? (
              <Button size="sm" variant="soft" onClick={onStop} aria-label="Stop">
                <Square size={13} className="fill-current" /> Stop
              </Button>
            ) : (
              <button
                aria-label="Send"
                onClick={submit}
                className="flex size-9 items-center justify-center rounded-xl bg-gradient-accent text-accent-ink shadow-lg shadow-accent/20 transition-all hover:brightness-110 active:scale-95"
              >
                <ArrowUp size={18} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PersonaSwitcher() {
  const personas = usePersonas();
  const active = useActivePersona();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  if (!active) return null;

  const choose = async (id: string) => {
    setOpen(false);
    queryClient.setQueryData(keys.settings, await api.updateSettings({ activePersonaId: id }));
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-xs text-muted transition-colors hover:bg-surface-3 hover:text-ink"
        title="Who you're playing as"
      >
        <Avatar name={active.name} src={active.avatar} size={20} />
        <span className="max-w-28 truncate">{active.name}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="animate-rise absolute bottom-full left-0 z-20 mb-2 w-56 rounded-xl bg-surface border border-line p-1.5 shadow-2xl shadow-black/20">
            <div className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Play as</div>
            {personas.data?.map((p) => (
              <button
                key={p.id}
                onClick={() => choose(p.id)}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  p.id === active.id ? "bg-surface-3 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                <Avatar name={p.name} src={p.avatar} size={24} />
                <span className="flex-1 truncate">{p.name}</span>
                {p.id === active.id && <Check size={14} className="text-accent" />}
              </button>
            ))}
            <Link to="/settings" onClick={() => setOpen(false)} className="mt-1 block rounded-lg px-2.5 py-2 text-xs text-faint hover:bg-surface-2 hover:text-ink">
              Manage personas…
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
