import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { MessageSquarePlus, Moon, Pencil, ScrollText, Search, Settings, Sun, Upload, UserPlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { api } from "../lib/api";
import { keys, useCharacters, useImportCharacters, useNewChat, useOpenCharacter } from "../lib/hooks";
import type { Theme } from "../lib/theme";
import { Avatar } from "./Avatar";
import { IconButton } from "./ui";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function Logo() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="font-display text-2xl font-semibold tracking-tight">
        Par<span className="text-gradient">lor</span>
      </span>
    </NavLink>
  );
}

function ChatList({ characterId, onNavigate }: { characterId: string; onNavigate: () => void }) {
  const { chatId } = useParams();
  const chats = useQuery({ queryKey: keys.chats(characterId), queryFn: () => api.chats(characterId) });
  if (!chats.data?.length) return null;
  return (
    <ul className="mb-2 ml-[1.85rem] space-y-0.5 border-l border-line pl-3">
      {chats.data.slice(0, 8).map((chat) => (
        <li key={chat.id}>
          <NavLink
            to={`/chat/${chat.id}`}
            onClick={onNavigate}
            className={clsx(
              "block truncate rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
              chat.id === chatId ? "bg-surface-3 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {chat.title}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export function Sidebar({
  activeCharacterId,
  theme,
  onToggleTheme,
  open,
  onClose,
  onSearch,
}: {
  activeCharacterId: string | null;
  theme: Theme;
  onToggleTheme: () => void;
  open: boolean;
  onClose: () => void;
  onSearch: () => void;
}) {
  const characters = useCharacters();
  const openCharacter = useOpenCharacter();
  const newChat = useNewChat();
  const navigate = useNavigate();
  const importCharacters = useImportCharacters();
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = (characters.data ?? []).filter(
    (c) => !query || c.name.toLowerCase().includes(query) || c.card.tags.some((t) => t.toLowerCase().includes(query)),
  );

  return (
    <>
      {/* Mobile backdrop */}
      <div
        onClick={onClose}
        className={clsx(
          "fixed inset-0 z-30 bg-black/50 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        className={clsx(
          "glass fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-line transition-transform duration-300 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Logo />
          <IconButton label="Close menu" onClick={onClose} className="lg:hidden">
            <X size={18} />
          </IconButton>
        </div>

        <div className="px-3 pt-1">
          <button
            onClick={onSearch}
            className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-sm text-faint transition-colors hover:border-line-strong hover:text-muted"
          >
            <Search size={15} />
            <span className="flex-1 text-left">Search chats</span>
            <kbd className="rounded-md border border-line px-1.5 font-sans text-[11px] max-lg:hidden">{isMac ? "⌘" : "Ctrl"} K</kbd>
          </button>
        </div>

        <div className="flex items-center justify-between pt-3 pr-3 pb-1 pl-5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Characters</span>
          <div className="flex">
            <IconButton label="Import character cards" onClick={() => fileInput.current?.click()} disabled={importCharacters.isPending}>
              <Upload size={15} />
            </IconButton>
            <IconButton
              label="New character"
              onClick={() => {
                navigate("/characters/new");
                onClose();
              }}
            >
              <UserPlus size={15} />
            </IconButton>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".png,.json,image/png,application/json"
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) importCharacters.mutate(files);
              e.target.value = "";
            }}
          />
        </div>
        {(characters.data?.length ?? 0) > 6 && (
          <div className="relative px-3 pb-2">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-6 -translate-y-1/2 text-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter characters"
              className="w-full rounded-lg border border-line bg-surface-2/70 py-1.5 pr-3 pl-8 text-sm placeholder:text-faint focus:border-accent-2/50 focus:outline-none"
            />
          </div>
        )}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {visible.map((character) => {
            const active = character.id === activeCharacterId;
            return (
              <div key={character.id}>
                <div
                  className={clsx(
                    "group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors",
                    active ? "bg-surface-2" : "hover:bg-surface-2/70",
                  )}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => {
                      openCharacter(character.id);
                      onClose();
                    }}
                  >
                    <Avatar name={character.name} src={character.avatar} size={36} />
                    <div className="min-w-0">
                      <div className="truncate font-display text-[15px] font-medium">{character.name}</div>
                      <div className="truncate text-xs text-faint">{character.card.tags.slice(0, 3).join(" · ") || "Character"}</div>
                    </div>
                  </button>
                  <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-lg:opacity-100">
                    <IconButton
                      label={`Edit ${character.name}`}
                      className="size-7"
                      onClick={() => {
                        navigate(`/characters/${character.id}`);
                        onClose();
                      }}
                    >
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton
                      label={`New chat with ${character.name}`}
                      className="size-7"
                      onClick={() => {
                        newChat(character.id);
                        onClose();
                      }}
                    >
                      <MessageSquarePlus size={15} />
                    </IconButton>
                  </div>
                </div>
                {active && <ChatList characterId={character.id} onNavigate={onClose} />}
              </div>
            );
          })}
          {query && !visible.length && <p className="px-3 py-4 text-sm text-faint">No one matches "{search}".</p>}
        </nav>

        <div className="flex items-center gap-1 border-t border-line p-3">
          {[
            { to: "/settings", label: "Settings", icon: Settings },
            { to: "/prompts", label: "Prompts", icon: ScrollText },
          ].map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                clsx(
                  "flex flex-1 items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
                  isActive ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
                )
              }
            >
              <Icon size={16} /> {label}
            </NavLink>
          ))}
          <IconButton label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={onToggleTheme}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
        </div>
      </aside>
    </>
  );
}
