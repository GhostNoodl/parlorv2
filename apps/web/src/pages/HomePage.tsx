import { ArrowRight, Menu, PlugZap } from "lucide-react";
import { Link } from "react-router";
import { Avatar, nameHue } from "../components/Avatar";
import { Logo } from "../components/Sidebar";
import { Button, IconButton } from "../components/ui";
import { useActiveConnection, useCharacters, useConnections, useOpenCharacter } from "../lib/hooks";
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

        <h2 className="mt-14 mb-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Your characters</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {characters.data?.map((character, i) => {
            const hue = nameHue(character.name);
            return (
              <button
                key={character.id}
                onClick={() => openCharacter(character.id)}
                style={{ animationDelay: `${i * 40}ms` }}
                className="animate-rise group relative overflow-hidden rounded-2xl border border-line bg-surface/70 p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-2xl hover:shadow-black/10"
              >
                <div
                  className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full opacity-30 blur-3xl transition-opacity group-hover:opacity-50"
                  style={{ background: `hsl(${hue} 80% 65%)` }}
                />
                <div className="relative flex items-center gap-4">
                  <Avatar name={character.name} src={character.avatar} size={56} />
                  <div className="min-w-0">
                    <div className="truncate font-display text-xl font-semibold">{character.name}</div>
                    <div className="truncate text-xs text-faint">{character.card.tags.slice(0, 3).join(" · ")}</div>
                  </div>
                </div>
                <p className="relative mt-4 line-clamp-3 text-sm text-muted">
                  {character.card.creator_notes || character.card.description.replace(/\{\{char\}\}/gi, character.name)}
                </p>
                <div className="relative mt-4 flex items-center gap-1.5 text-sm font-medium text-accent opacity-80 transition-opacity group-hover:opacity-100">
                  Start chatting <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-6 text-sm text-faint">Character card import and a character editor are coming next.</p>
      </div>
    </div>
  );
}
