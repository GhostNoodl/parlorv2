import { ArrowRight, Loader2, Menu, PlugZap, Upload, UserPlus } from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router";
import { nameHue } from "../components/Avatar";
import { Logo } from "../components/Sidebar";
import { Button, IconButton } from "../components/ui";
import { useActiveConnection, useCharacters, useConnections, useImportCharacters, useOpenCharacter } from "../lib/hooks";
import { useLayout } from "../lib/layout";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Up late?";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomePage() {
  const { openMenu } = useLayout();
  const characters = useCharacters();
  const connections = useConnections();
  const active = useActiveConnection();
  const openCharacter = useOpenCharacter();
  const importCharacters = useImportCharacters();
  const fileInput = useRef<HTMLInputElement>(null);
  const needsSetup = connections.isSuccess && !active;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex h-16 items-center px-4 lg:hidden">
        <IconButton label="Open menu" onClick={openMenu}>
          <Menu size={20} />
        </IconButton>
        <div className="ml-2">
          <Logo />
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-5 pt-10 pb-16 sm:px-8 lg:pt-20">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-faint">{greeting()}</p>
        <h1 className="mt-3 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Welcome to the <span className="text-gradient italic">Parlor</span>.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted">Pull up a chair. Pick someone to talk to, or bring your own model and start a new story.</p>

        {needsSetup && (
          <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-accent/25 bg-accent/[0.06] p-5 sm:flex-row sm:items-center">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-accent text-accent-ink">
              <PlugZap size={20} />
            </div>
            <div className="flex-1">
              <div className="font-medium">Connect a model to get started</div>
              <div className="text-sm text-muted">Claude, OpenRouter, Ollama, LM Studio, or anything OpenAI-compatible.</div>
            </div>
            <Link to="/settings">
              <Button variant="primary">
                Set up a connection <ArrowRight size={16} />
              </Button>
            </Link>
          </div>
        )}

        <div className="mt-14 mb-5 flex items-center justify-between gap-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Your characters</h2>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => fileInput.current?.click()} disabled={importCharacters.isPending}>
              {importCharacters.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Import
            </Button>
            <Link to="/characters/new">
              <Button size="sm">
                <UserPlus size={14} /> New
              </Button>
            </Link>
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {characters.data?.map((character, i) => {
            const hue = nameHue(character.name);
            return (
              <button
                key={character.id}
                onClick={() => openCharacter(character.id)}
                style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
                className="animate-rise group relative aspect-[2/3] overflow-hidden rounded-2xl border border-line text-left shadow-lg shadow-black/10 transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-2xl hover:shadow-black/25 focus-visible:outline-2 focus-visible:outline-accent-2"
              >
                {character.avatar ? (
                  <img src={character.avatar} alt="" className="absolute inset-0 size-full object-cover object-top transition-transform duration-500 group-hover:scale-105" />
                ) : (
                  <div
                    className="absolute inset-0 flex items-center justify-center font-display text-7xl font-semibold text-white/85 transition-transform duration-500 group-hover:scale-105"
                    style={{ background: `linear-gradient(150deg, hsl(${hue} 75% 72%), hsl(${(hue + 50) % 360} 60% 42%))` }}
                  >
                    {character.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <div className="truncate font-display text-xl font-semibold text-white">{character.name}</div>
                  <p className="mt-1 line-clamp-2 text-xs text-white/70">
                    {character.card.creator_notes || character.card.description.replace(/\{\{char\}\}/gi, character.name)}
                  </p>
                  {character.card.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {character.card.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] text-white/85 backdrop-blur">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
          <Link
            to="/characters/new"
            className="flex aspect-[2/3] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line text-center text-faint transition-colors hover:border-accent/50 hover:text-ink"
          >
            <UserPlus size={26} />
            <span className="px-4 text-sm">
              Create a character
              <br />
              <span className="text-xs">or drop card files anywhere</span>
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
