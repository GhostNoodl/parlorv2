import { BLOCK_LABELS, estimateTokens, newTextBlock, type PromptBlock, type PromptBlockKind, type PromptPreset } from "@parlor/shared";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  Download,
  GripVertical,
  History,
  Loader2,
  Menu,
  MessagesSquare,
  Pin,
  Plus,
  ScrollText,
  Smile,
  StickyNote,
  Trash2,
  Upload,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Card, IconButton, Input, Switch, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { keys, useActivePreset, usePresets, useSettings, useUnsavedGuard } from "../lib/hooks";
import { useLayout } from "../lib/layout";
import { useToast } from "../lib/toast";

const ICONS: Record<PromptBlockKind, LucideIcon> = {
  main: ScrollText,
  character: UserRound,
  persona: Smile,
  examples: MessagesSquare,
  history: History,
  postHistory: Pin,
  text: StickyNote,
};

const DESCRIPTIONS: Partial<Record<PromptBlockKind, string>> = {
  main: "Your core instructions. A card with its own system prompt replaces this, and {{original}} in that prompt brings this back.",
  character: "{{char}}'s description, personality and scenario, straight from their card.",
  persona: "The description of the persona you're playing as.",
  examples: "The card's example dialogue, so the model can pick up {{char}}'s voice.",
  postHistory: "The card's own post-history instructions, when it has some.",
};

const MACROS = ["{{char}}", "{{user}}", "{{date}}", "{{time}}", "{{weekday}}", "{{random:a,b,c}}", "{{// note to self}}"];

export function PromptsPage() {
  const presets = usePresets();
  const active = useActivePreset();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = presets.data?.find((p) => p.id === selectedId) ?? active;
  if (!selected || !presets.data) return <div className="flex-1" />;
  return <PresetEditor key={selected.id} preset={selected} presets={presets.data} onSelect={setSelectedId} />;
}

function PresetEditor({ preset, presets, onSelect }: { preset: PromptPreset; presets: PromptPreset[]; onSelect: (id: string) => void }) {
  const { openMenu } = useLayout();
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useSettings();
  const fileInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(preset.name);
  const [blocks, setBlocks] = useState<PromptBlock[]>(preset.blocks);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const dirty = name !== preset.name || JSON.stringify(blocks) !== JSON.stringify(preset.blocks);
  useUnsavedGuard(dirty && !saving);
  const isActive = settings.data?.activePresetId === preset.id || (!settings.data?.activePresetId && presets[0]?.id === preset.id);

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.presets });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  const switchTo = (id: string) => {
    if (dirty && !confirm("Discard your unsaved changes?")) return;
    onSelect(id);
  };

  const activate = () =>
    run(async () => {
      queryClient.setQueryData(keys.settings, await api.updateSettings({ activePresetId: preset.id }));
      toast("success", `Now using "${preset.name}" for every chat.`);
    });

  const save = () =>
    run(async () => {
      if (!name.trim()) throw new Error("Give the preset a name.");
      setSaving(true);
      try {
        const saved = await api.updatePreset(preset.id, { name: name.trim(), blocks });
        queryClient.setQueryData<PromptPreset[]>(keys.presets, (all) => all?.map((p) => (p.id === saved.id ? saved : p)));
        setBlocks(saved.blocks);
        setName(saved.name);
      } finally {
        setSaving(false);
      }
    });

  const create = () =>
    run(async () => {
      if (dirty && !confirm("Discard your unsaved changes?")) return;
      const created = await api.createPreset("New preset");
      await refresh();
      onSelect(created.id);
    });

  const duplicate = () =>
    run(async () => {
      if (dirty && !confirm("The copy won't include unsaved changes. Copy anyway?")) return;
      const copy = await api.duplicatePreset(preset.id);
      await refresh();
      onSelect(copy.id);
    });

  const remove = () =>
    run(async () => {
      if (!confirm(`Delete the preset "${preset.name}"?`)) return;
      await api.deletePreset(preset.id);
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: keys.settings })]);
      onSelect(presets.find((p) => p.id !== preset.id)!.id);
    });

  const importFiles = (files: File[]) =>
    run(async () => {
      let last: PromptPreset | null = null;
      for (const file of files) {
        try {
          last = await api.importPreset(file);
          toast("success", `Imported "${last.name}" ✨`);
        } catch (err) {
          toast("error", `${file.name}: ${(err as Error).message}`);
        }
      }
      if (last) {
        await refresh();
        if (!dirty) onSelect(last.id);
      }
    });

  // ---- block editing ----
  const update = (id: string, patch: Partial<PromptBlock>) => setBlocks((all) => all.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const move = (from: number, to: number) =>
    setBlocks((all) => {
      if (to < 0 || to >= all.length || from === to) return all;
      const next = [...all];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  const addAt = (index: number) => {
    const block = newTextBlock();
    setBlocks((all) => [...all.slice(0, index), block, ...all.slice(index)]);
    setOpen(block.id);
  };

  const historyAt = blocks.findIndex((b) => b.kind === "history");
  const enabledTokens = useMemo(
    () =>
      blocks.filter((b) => b.enabled && (b.kind === "text" || b.kind === "main")).reduce((sum, b) => sum + estimateTokens(b.content), 0),
    [blocks],
  );

  const row = (block: PromptBlock, index: number) => (
    <BlockRow
      key={block.id}
      block={block}
      expanded={open === block.id}
      onToggleOpen={() => setOpen(open === block.id ? null : block.id)}
      onChange={(patch) => update(block.id, patch)}
      onRemove={block.kind === "text" ? () => setBlocks((all) => all.filter((b) => b.id !== block.id)) : undefined}
      onMove={(delta) => move(index, index + delta)}
      canMoveUp={index > 0}
      canMoveDown={index < blocks.length - 1}
      drag={{
        dragging: dragFrom === index,
        over: dragOver === index && dragFrom !== null && dragFrom !== index,
        onStart: () => setDragFrom(index),
        onOver: () => setDragOver(index),
        onEnd: () => {
          if (dragFrom !== null && dragOver !== null) move(dragFrom, dragOver);
          setDragFrom(null);
          setDragOver(null);
        },
      }}
    />
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4 sm:h-24 sm:px-8">
        <IconButton label="Open menu" onClick={openMenu} className="lg:hidden">
          <Menu size={20} />
        </IconButton>
        <div>
          <h1 className="font-display text-2xl font-semibold">Prompts</h1>
          <p className="hidden text-sm text-muted sm:block">Decide what the model reads, and in what order.</p>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 px-4 pb-32 sm:px-8">
        {/* Preset picker */}
        <Card className="animate-rise space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <select
                value={preset.id}
                onChange={(e) => switchTo(e.target.value)}
                aria-label="Preset"
                className="h-10 w-full appearance-none rounded-xl border border-line bg-surface-2 pr-9 pl-3.5 font-display text-[15px] font-medium focus:border-accent-2/60 focus:outline-none"
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === settings.data?.activePresetId ? "  (active)" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-faint" />
            </div>
            {isActive ? (
              <span className="rounded-full bg-accent/12 px-3 py-1 text-xs font-medium text-accent">In use</span>
            ) : (
              <Button size="sm" variant="primary" onClick={activate}>
                Use this preset
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1 border-t border-line pt-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Preset name"
              className="h-8 min-w-0 flex-1 py-1 sm:max-w-64 text-[13px]"
            />
            <div className="hidden flex-1 sm:block" />
            <IconButton label="New preset" onClick={create}>
              <Plus size={16} />
            </IconButton>
            <IconButton label="Duplicate" onClick={duplicate}>
              <Copy size={15} />
            </IconButton>
            <IconButton label="Import a Parlor or SillyTavern preset" onClick={() => fileInput.current?.click()}>
              <Upload size={15} />
            </IconButton>
            <a href={api.presetExportUrl(preset.id)} download>
              <IconButton label="Export" tabIndex={-1}>
                <Download size={15} />
              </IconButton>
            </a>
            <IconButton label="Delete preset" onClick={remove} disabled={presets.length <= 1} className="hover:text-danger">
              <Trash2 size={15} />
            </IconButton>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                if (files.length) importFiles(files);
                e.target.value = "";
              }}
            />
          </div>
        </Card>

        <Zone
          title="Before the chat"
          hint="Joined together into the system prompt."
          onAdd={() => addAt(historyAt < 0 ? blocks.length : historyAt)}
        >
          {blocks.map((b, i) => (historyAt < 0 || i < historyAt ? row(b, i) : null))}
        </Zone>

        {historyAt >= 0 && (
          <HistoryDivider
            block={blocks[historyAt]!}
            onChange={(patch) => update(blocks[historyAt]!.id, patch)}
            onMove={(delta) => move(historyAt, historyAt + delta)}
            canMoveUp={historyAt > 0}
            canMoveDown={historyAt < blocks.length - 1}
          />
        )}

        {historyAt >= 0 && (
          <Zone
            title="After the chat"
            hint="Tucked onto the end of your latest message, where models pay the most attention. Great for reminders and author's notes."
            onAdd={() => addAt(blocks.length)}
          >
            {blocks.map((b, i) => (i > historyAt ? row(b, i) : null))}
          </Zone>
        )}

        <p className="text-center text-xs text-faint">
          About {enabledTokens.toLocaleString()} tokens of your own text. Open the inspector in any chat to see the full prompt.
        </p>
      </div>

      {/* Save bar */}
      <div
        className={clsx(
          "pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center p-4 transition-all duration-300 lg:left-72",
          dirty ? "translate-y-0 opacity-100" : "translate-y-full opacity-0",
        )}
      >
        <div className="glass pointer-events-auto flex items-center gap-3 rounded-2xl border border-line py-2 pr-2 pl-5 shadow-2xl shadow-black/20">
          <span className="text-sm text-muted">Unsaved changes</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setName(preset.name);
              setBlocks(preset.blocks);
            }}
          >
            Discard
          </Button>
          <Button size="sm" variant="primary" onClick={save} disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function Zone({ title, hint, onAdd, children }: { title: string; hint: string; onAdd: () => void; children: ReactNode }) {
  return (
    <section className="animate-rise space-y-2">
      <div className="px-1">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted">{hint}</p>
      </div>
      <div className="space-y-2">{children}</div>
      <button
        onClick={onAdd}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-2.5 text-sm text-faint transition-colors hover:border-accent-2/50 hover:text-ink"
      >
        <Plus size={15} /> Add a text block
      </button>
    </section>
  );
}

function MoveButtons({ onMove, canMoveUp, canMoveDown }: { onMove: (delta: number) => void; canMoveUp: boolean; canMoveDown: boolean }) {
  return (
    <div className="flex">
      <IconButton label="Move up" className="size-7" disabled={!canMoveUp} onClick={() => onMove(-1)}>
        <ArrowUp size={14} />
      </IconButton>
      <IconButton label="Move down" className="size-7" disabled={!canMoveDown} onClick={() => onMove(1)}>
        <ArrowDown size={14} />
      </IconButton>
    </div>
  );
}

function HistoryDivider({
  block,
  onChange,
  ...move
}: {
  block: PromptBlock;
  onChange: (patch: Partial<PromptBlock>) => void;
  onMove: (delta: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-3 transition-opacity",
        block.enabled ? "border-accent-2/35 bg-accent-2/[0.05]" : "border-line opacity-60",
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-accent text-accent-ink">
        <History size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display font-semibold">{block.name}</div>
        <div className="text-xs text-muted">
          {block.enabled
            ? "The conversation so far, oldest messages trimmed to fit the context."
            : "Off: the model won't see any messages."}
        </div>
      </div>
      <MoveButtons {...move} />
      <Switch checked={block.enabled} onChange={(enabled) => onChange({ enabled })} label="Send chat history" />
    </div>
  );
}

function BlockRow({
  block,
  expanded,
  onToggleOpen,
  onChange,
  onRemove,
  drag,
  ...move
}: {
  block: PromptBlock;
  expanded: boolean;
  onToggleOpen: () => void;
  onChange: (patch: Partial<PromptBlock>) => void;
  onRemove?: () => void;
  onMove: (delta: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  drag: { dragging: boolean; over: boolean; onStart: () => void; onOver: () => void; onEnd: () => void };
}) {
  const Icon = ICONS[block.kind];
  const editable = block.kind === "text" || block.kind === "main";
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [draggable, setDraggable] = useState(false);

  const insert = (macro: string) => {
    const el = textarea.current;
    const at = el?.selectionStart ?? block.content.length;
    const end = el?.selectionEnd ?? at;
    onChange({ content: block.content.slice(0, at) + macro + block.content.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + macro.length, at + macro.length);
    });
  };

  useEffect(() => {
    if (expanded && editable) textarea.current?.focus({ preventScroll: true });
  }, [expanded, editable]);

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        drag.onStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        drag.onOver();
      }}
      onDragEnd={() => {
        setDraggable(false);
        drag.onEnd();
      }}
      className={clsx(
        "rounded-2xl border bg-surface/80 transition-all",
        drag.dragging && "opacity-40",
        drag.over ? "border-accent-2/60 ring-2 ring-accent-2/20" : expanded ? "border-line-strong" : "border-line",
        !block.enabled && "opacity-55",
      )}
    >
      <div className="flex items-center gap-2 py-2 pr-3 pl-1.5">
        <span
          className="hidden cursor-grab touch-none p-1 text-faint hover:text-ink active:cursor-grabbing sm:block"
          onPointerDown={() => setDraggable(true)}
          onPointerUp={() => setDraggable(false)}
          title="Drag to reorder"
        >
          <GripVertical size={16} />
        </span>
        <button onClick={onToggleOpen} className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left max-sm:pl-1.5">
          <span
            className={clsx(
              "flex size-8 shrink-0 items-center justify-center rounded-lg",
              editable ? "bg-accent/12 text-accent" : "bg-surface-3 text-muted",
            )}
          >
            <Icon size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium">{block.name}</span>
            <span className="block truncate text-xs text-faint">
              {editable
                ? block.content.replace(/\s+/g, " ").trim() || "Empty"
                : block.kind === "persona"
                  ? "From your persona"
                  : "From the character card"}
            </span>
          </span>
          {editable && block.content && <span className="hidden text-xs text-faint sm:inline">~{estimateTokens(block.content)} tok</span>}
          <ChevronDown size={16} className={clsx("shrink-0 text-faint transition-transform", expanded && "rotate-180")} />
        </button>
        <Switch checked={block.enabled} onChange={(enabled) => onChange({ enabled })} label={block.enabled ? "Turn off" : "Turn on"} />
      </div>

      {expanded && (
        <div className="animate-rise space-y-3 border-t border-line px-4 pt-3 pb-4">
          {DESCRIPTIONS[block.kind] && <p className="text-sm text-muted">{DESCRIPTIONS[block.kind]}</p>}
          {block.kind === "text" && (
            <Input value={block.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Block name" className="py-2" />
          )}
          {editable && (
            <>
              <Textarea
                ref={textarea}
                rows={Math.min(14, Math.max(4, block.content.split("\n").length + 1))}
                value={block.content}
                onChange={(e) => onChange({ content: e.target.value })}
                placeholder={block.kind === "text" ? "[Write in short, punchy sentences.]" : "You are {{char}}…"}
                className="font-mono text-[13px]"
              />
              <div className="flex flex-wrap gap-1.5">
                {MACROS.map((macro) => (
                  <button
                    key={macro}
                    onClick={() => insert(macro)}
                    className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-accent-2/50 hover:text-ink"
                  >
                    {macro}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="flex items-center gap-2">
            <MoveButtons {...move} />
            <div className="flex-1" />
            {block.kind !== "text" && <span className="text-xs text-faint">{BLOCK_LABELS[block.kind]} · built in</span>}
            {onRemove && (
              <Button size="sm" variant="danger" onClick={onRemove}>
                <Trash2 size={14} /> Remove
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
