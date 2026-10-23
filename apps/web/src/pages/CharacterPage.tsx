import { emptyCard, estimateTokens, type Character, type CharacterCard } from "@parlor/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { BookOpen, Copy, Download, FileJson, Loader2, Menu, MessageCircle, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useBlocker, useNavigate, useParams } from "react-router";
import { AvatarPicker } from "../components/AvatarPicker";
import { Button, Card, Field, IconButton, Input, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { keys, useOpenCharacter } from "../lib/hooks";
import { toPng } from "../lib/image";
import { useLayout } from "../lib/layout";
import { useToast } from "../lib/toast";

export function CharacterPage() {
  const { characterId } = useParams();
  const isNew = !characterId;
  const query = useQuery({ queryKey: ["character", characterId], queryFn: () => api.character(characterId!), enabled: !isNew });
  if (!isNew && !query.data) return <div className="flex-1" />;
  return <CharacterEditor key={characterId ?? "new"} character={query.data ?? null} />;
}

function bookEntryCount(book: unknown): number {
  const entries = (book as { entries?: unknown })?.entries;
  if (Array.isArray(entries)) return entries.length;
  if (entries && typeof entries === "object") return Object.keys(entries).length;
  return 0;
}

function CharacterEditor({ character }: { character: Character | null }) {
  const { openMenu } = useLayout();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const openCharacter = useOpenCharacter();
  const initial = useMemo(() => character?.card ?? emptyCard(), [character]);
  const [card, setCard] = useState<CharacterCard>(initial);
  const [avatar, setAvatar] = useState<string | null>(character?.avatar ?? null);
  const [pendingAvatar, setPendingAvatar] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(card) !== JSON.stringify(initial) || pendingAvatar !== null;
  const set = (patch: Partial<CharacterCard>) => setCard((c) => ({ ...c, ...patch }));

  // Warn before leaving with unsaved edits.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !saving && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (confirm("Discard your unsaved changes?")) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const tokens = estimateTokens([card.description, card.personality, card.scenario, card.mes_example, card.system_prompt].join("\n"));

  const pickAvatar = async (file: File) => {
    try {
      const png = await toPng(file);
      if (character) {
        const { avatar } = await api.setAvatar("characters", character.id, png);
        setAvatar(avatar);
        queryClient.invalidateQueries({ queryKey: keys.characters });
        queryClient.invalidateQueries({ queryKey: ["chat"] });
      } else {
        setPendingAvatar(png);
        setAvatar(URL.createObjectURL(png));
      }
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  const removeAvatar = async () => {
    if (character) {
      await api.removeAvatar("characters", character.id);
      queryClient.invalidateQueries({ queryKey: keys.characters });
      queryClient.invalidateQueries({ queryKey: ["chat"] });
    }
    setPendingAvatar(null);
    setAvatar(null);
  };

  const save = async () => {
    if (!card.name.trim()) return toast("error", "Give your character a name first.");
    setSaving(true);
    try {
      const cleaned = { ...card, alternate_greetings: card.alternate_greetings.filter((g) => g.trim()) };
      if (character) {
        const updated = await api.updateCharacter(character.id, cleaned);
        queryClient.setQueryData(["character", character.id], updated);
        toast("success", "Saved!");
      } else {
        const created = await api.createCharacter(cleaned);
        if (pendingAvatar) await api.setAvatar("characters", created.id, pendingAvatar);
        toast("success", `${created.name} is ready to chat 🎉`);
        navigate(`/characters/${created.id}`, { replace: true });
      }
      queryClient.invalidateQueries({ queryKey: keys.characters });
      queryClient.invalidateQueries({ queryKey: ["chat"] });
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!character || !confirm(`Delete ${character.name} and all of their chats? This can't be undone.`)) return;
    await api.deleteCharacter(character.id);
    queryClient.invalidateQueries({ queryKey: keys.characters });
    navigate("/", { replace: true });
  };

  const duplicate = async () => {
    if (!character) return;
    const copy = await api.duplicateCharacter(character.id);
    queryClient.invalidateQueries({ queryKey: keys.characters });
    navigate(`/characters/${copy.id}`);
  };

  const bookEntries = bookEntryCount(card.character_book);

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:h-24 sm:px-8">
        <IconButton label="Open menu" onClick={openMenu} className="lg:hidden">
          <Menu size={20} />
        </IconButton>
        <h1 className="flex-1 truncate font-display text-2xl font-semibold">{character ? card.name || "Untitled" : "New character"}</h1>
        <span className="hidden text-xs text-faint sm:inline" title="Description, personality, scenario and examples are sent with every message.">
          ≈ {tokens.toLocaleString()} tokens
        </span>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 pb-32 sm:px-8 md:grid-cols-[240px_1fr]">
        <aside className="space-y-3 md:sticky md:top-4 md:self-start">
          <AvatarPicker name={card.name} src={avatar} onPick={pickAvatar} onRemove={removeAvatar} className="mx-auto max-w-44 md:max-w-60" />
          {character && (
            <div className="grid gap-2">
              <Button variant="primary" onClick={() => openCharacter(character.id)}>
                <MessageCircle size={16} /> Chat
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <a href={api.exportUrl(character.id, "png")} download>
                  <Button size="sm" className="w-full" title="Card PNG that works in SillyTavern and friends">
                    <Download size={14} /> PNG
                  </Button>
                </a>
                <a href={api.exportUrl(character.id, "json")} download>
                  <Button size="sm" className="w-full">
                    <FileJson size={14} /> JSON
                  </Button>
                </a>
                <Button size="sm" onClick={duplicate}>
                  <Copy size={14} /> Duplicate
                </Button>
                <Button size="sm" variant="danger" onClick={remove}>
                  <Trash2 size={14} /> Delete
                </Button>
              </div>
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          <EditorSection title="Basics">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input value={card.name} onChange={(e) => set({ name: e.target.value })} placeholder="Who are they?" autoFocus={!character} />
              </Field>
              <Field label="Tags" hint="Comma separated.">
                <TagInput tags={card.tags} onChange={(tags) => set({ tags })} />
              </Field>
            </div>
            <Field label="Creator notes" hint="Shown on their card. Not sent to the model.">
              <Textarea rows={2} value={card.creator_notes} onChange={(e) => set({ creator_notes: e.target.value })} />
            </Field>
          </EditorSection>

          <EditorSection title="Character" description="Sent with every message. Use {{char}} and {{user}} for names.">
            <Field label="Description">
              <Textarea
                rows={8}
                value={card.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="Appearance, backstory, how they talk, what they want…"
              />
            </Field>
            <Field label="Personality">
              <Textarea rows={2} value={card.personality} onChange={(e) => set({ personality: e.target.value })} placeholder="curious, stubborn, kind to animals" />
            </Field>
            <Field label="Scenario">
              <Textarea rows={3} value={card.scenario} onChange={(e) => set({ scenario: e.target.value })} placeholder="Where and when the story starts." />
            </Field>
          </EditorSection>

          <EditorSection title="Greetings" description="How chats open. Alternates become swipes on the first message.">
            <Field label="First message">
              <Textarea rows={6} value={card.first_mes} onChange={(e) => set({ first_mes: e.target.value })} />
            </Field>
            {card.alternate_greetings.map((greeting, i) => (
              <Field key={i} label={`Alternate greeting ${i + 1}`}>
                <div className="relative">
                  <Textarea
                    rows={4}
                    value={greeting}
                    onChange={(e) => set({ alternate_greetings: card.alternate_greetings.with(i, e.target.value) })}
                    className="pr-10"
                  />
                  <IconButton
                    label="Remove greeting"
                    className="absolute top-2 right-2 hover:text-danger"
                    onClick={() => set({ alternate_greetings: card.alternate_greetings.filter((_, j) => j !== i) })}
                  >
                    <X size={15} />
                  </IconButton>
                </div>
              </Field>
            ))}
            <Button size="sm" variant="ghost" onClick={() => set({ alternate_greetings: [...card.alternate_greetings, ""] })}>
              <Plus size={14} /> Add alternate greeting
            </Button>
          </EditorSection>

          <EditorSection title="Example dialogue" description="Shows the model their voice. Start each example with <START>.">
            <Textarea
              rows={6}
              value={card.mes_example}
              onChange={(e) => set({ mes_example: e.target.value })}
              placeholder={"<START>\n{{user}}: Hi!\n{{char}}: *waves* \"Oh, hello there.\""}
              className="font-mono text-[13px]"
            />
          </EditorSection>

          <details className="group">
            <summary className="cursor-pointer list-none font-display text-lg font-semibold text-muted select-none hover:text-ink">
              <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>Advanced
            </summary>
            <div className="mt-4 space-y-6">
              <EditorSection title="Prompt overrides">
                <Field label="System prompt" hint="Replaces the global system prompt for this character. {{original}} inserts the global one.">
                  <Textarea rows={4} value={card.system_prompt} onChange={(e) => set({ system_prompt: e.target.value })} className="font-mono text-[13px]" />
                </Field>
                <Field label="Post-history instructions" hint="Added after the chat history, right before the reply. Good for style nudges.">
                  <Textarea rows={3} value={card.post_history_instructions} onChange={(e) => set({ post_history_instructions: e.target.value })} className="font-mono text-[13px]" />
                </Field>
              </EditorSection>
              <EditorSection title="Card info">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Creator">
                    <Input value={card.creator} onChange={(e) => set({ creator: e.target.value })} />
                  </Field>
                  <Field label="Version">
                    <Input value={card.character_version} onChange={(e) => set({ character_version: e.target.value })} />
                  </Field>
                </div>
              </EditorSection>
            </div>
          </details>

          {bookEntries > 0 && (
            <div className="flex items-start gap-3 rounded-2xl border border-accent-2/25 bg-accent-2/[0.06] p-4 text-sm">
              <BookOpen size={18} className="mt-0.5 shrink-0 text-accent-2" />
              <p className="text-muted">
                This card comes with an embedded lorebook ({bookEntries} {bookEntries === 1 ? "entry" : "entries"}). It's kept safe and exported with the card, and
                it'll come to life when lorebooks land.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Save bar */}
      <div
        className={clsx(
          "pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center p-4 transition-all duration-300 lg:left-72",
          dirty || !character ? "translate-y-0 opacity-100" : "translate-y-full opacity-0",
        )}
      >
        <div className="glass pointer-events-auto flex items-center gap-3 rounded-2xl border border-line py-2 pr-2 pl-5 shadow-2xl shadow-black/20">
          <span className="text-sm text-muted">{character ? "Unsaved changes" : "New character"}</span>
          {character && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCard(initial);
                setPendingAvatar(null);
              }}
            >
              Discard
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={save} disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {character ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditorSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState(tags.join(", "));
  useEffect(() => setText(tags.join(", ")), [tags.join("\u0000")]);
  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() =>
        onChange(
          text
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        )
      }
      placeholder="fantasy, cozy, mystery"
    />
  );
}
