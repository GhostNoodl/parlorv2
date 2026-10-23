import {
  CONNECTION_PRESETS,
  DEFAULT_GENERATION_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  type Connection,
  type Effort,
  type GenerationSettings,
  type ProviderKind,
} from "@parlor/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, CircleAlert, Loader2, Menu, Pencil, Plus, RotateCcw, Trash2, Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, Field, IconButton, Input, Textarea } from "../components/ui";
import { api, type ConnectionInput, type ProbeResult } from "../lib/api";
import { keys, useConnections, useSettings } from "../lib/hooks";
import { useLayout } from "../lib/layout";

export function SettingsPage() {
  const { openMenu } = useLayout();
  return (
    <div className="flex-1 overflow-y-auto">
      <header className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4 sm:h-24 sm:px-8">
        <IconButton label="Open menu" onClick={openMenu} className="lg:hidden">
          <Menu size={20} />
        </IconButton>
        <h1 className="font-display text-2xl font-semibold">Settings</h1>
      </header>
      <div className="mx-auto max-w-3xl space-y-10 px-4 pb-20 sm:px-8">
        <ConnectionsSection />
        <PersonaSection />
        <PromptSection />
      </div>
    </div>
  );
}

function Section({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="animate-rise">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Connections

function ConnectionsSection() {
  const connections = useConnections();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Connection | "new" | null>(null);

  useEffect(() => {
    if (connections.isSuccess && connections.data.length === 0) setEditing("new");
  }, [connections.isSuccess, connections.data?.length]);

  const activate = useMutation({
    mutationFn: (id: string) => api.updateSettings({ activeConnectionId: id }),
    onSuccess: (data) => queryClient.setQueryData(keys.settings, data),
  });

  const remove = async (connection: Connection) => {
    if (!confirm(`Delete the "${connection.name}" connection?`)) return;
    await api.deleteConnection(connection.id);
    queryClient.invalidateQueries({ queryKey: keys.connections });
    queryClient.invalidateQueries({ queryKey: keys.settings });
  };

  return (
    <Section
      title="Connections"
      description="Where replies come from. Keys are encrypted and stay on this computer."
      action={
        editing === null && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus size={15} /> Add
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {editing === "new" && <ConnectionForm onDone={() => setEditing(null)} />}
        {connections.data?.map((connection) =>
          editing !== "new" && editing?.id === connection.id ? (
            <ConnectionForm key={connection.id} existing={connection} onDone={() => setEditing(null)} />
          ) : (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              active={settings.data?.activeConnectionId === connection.id}
              onActivate={() => activate.mutate(connection.id)}
              onEdit={() => setEditing(connection)}
              onDelete={() => remove(connection)}
            />
          ),
        )}
      </div>
    </Section>
  );
}

function ProviderBadge({ provider }: { provider: ProviderKind }) {
  return (
    <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
      {provider === "anthropic" ? "Claude" : "OpenAI-compatible"}
    </span>
  );
}

function ConnectionRow({
  connection,
  active,
  onActivate,
  onEdit,
  onDelete,
}: {
  connection: Connection;
  active: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={clsx(
        "flex items-center gap-4 rounded-2xl border p-4 transition-colors",
        active ? "border-accent/40 bg-accent/[0.05]" : "border-line bg-surface/70",
      )}
    >
      <button
        onClick={onActivate}
        aria-label={active ? "Active connection" : `Use ${connection.name}`}
        title={active ? "Active" : "Use this connection"}
        className={clsx(
          "flex size-10 shrink-0 items-center justify-center rounded-xl transition-all",
          active ? "bg-gradient-accent text-accent-ink" : "border border-line bg-surface-2 text-faint hover:text-ink",
        )}
      >
        <Zap size={18} className={active ? "fill-current" : ""} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{connection.name}</span>
          <ProviderBadge provider={connection.provider} />
          {active && <span className="text-xs font-medium text-accent">Active</span>}
        </div>
        <div className="mt-0.5 truncate text-sm text-muted">
          {connection.model || <span className="text-danger">No model picked</span>}
          <span className="text-faint"> · {connection.baseUrl}</span>
        </div>
      </div>
      <IconButton label="Edit" onClick={onEdit}>
        <Pencil size={16} />
      </IconButton>
      <IconButton label="Delete" onClick={onDelete} className="hover:text-danger">
        <Trash2 size={16} />
      </IconButton>
    </div>
  );
}

function ConnectionForm({ existing, onDone }: { existing?: Connection; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: existing?.name ?? "Claude",
    provider: existing?.provider ?? ("anthropic" as ProviderKind),
    baseUrl: existing?.baseUrl ?? "https://api.anthropic.com",
    model: existing?.model ?? "claude-opus-5-5",
    apiKey: "",
  });
  const [gen, setGen] = useState<GenerationSettings>(existing?.settings ?? { ...DEFAULT_GENERATION_SETTINGS, maxTokens: 8192 });
  const [preset, setPreset] = useState(existing ? -1 : 0);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const pickPreset = (i: number) => {
    const p = CONNECTION_PRESETS[i]!;
    setPreset(i);
    setProbe(null);
    set({ name: p.label.replace(/ \(.*\)$/, ""), provider: p.provider, baseUrl: p.baseUrl, model: p.model });
    setGen((g) => ({ ...g, maxTokens: p.provider === "anthropic" ? 8192 : DEFAULT_GENERATION_SETTINGS.maxTokens }));
  };

  const test = async () => {
    setProbing(true);
    setProbe(null);
    try {
      const result = await api.probe({ provider: form.provider, baseUrl: form.baseUrl, apiKey: form.apiKey || undefined, connectionId: existing?.id });
      setProbe(result);
      if (result.ok && !form.model && result.models[0]) set({ model: result.models[0] });
    } catch (err) {
      setProbe({ ok: false, models: [], error: (err as Error).message });
    } finally {
      setProbing(false);
    }
  };

  const save = useMutation({
    mutationFn: () => {
      const input: ConnectionInput = { ...form, settings: gen, apiKey: form.apiKey || undefined };
      return existing ? api.updateConnection(existing.id, input) : api.createConnection(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.connections });
      queryClient.invalidateQueries({ queryKey: keys.settings });
      onDone();
    },
    onError: (err) => setError((err as Error).message),
  });

  const isClaude = form.provider === "anthropic";

  return (
    <Card className="animate-rise space-y-5 border-accent-2/30">
      {!existing && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Quick start</div>
          <div className="flex flex-wrap gap-2">
            {CONNECTION_PRESETS.map((p, i) => (
              <button
                key={p.label}
                onClick={() => pickPreset(i)}
                className={clsx(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  preset === i ? "border-accent/50 bg-accent/10 text-ink" : "border-line text-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="API type">
          <select
            value={form.provider}
            onChange={(e) => set({ provider: e.target.value as ProviderKind })}
            className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink focus:border-accent-2/60 focus:outline-none"
          >
            <option value="anthropic">Claude (Anthropic)</option>
            <option value="openai">OpenAI-compatible</option>
          </select>
        </Field>
        <Field label="Base URL" hint={isClaude ? "Leave as is unless you use a proxy." : "Usually ends in /v1."}>
          <Input value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="http://localhost:11434/v1" />
        </Field>
        <Field label="API key" hint={existing?.hasApiKey ? "A key is saved. Leave blank to keep it." : isClaude ? "Required." : "Optional for local servers."}>
          <Input
            type="password"
            autoComplete="off"
            value={form.apiKey}
            onChange={(e) => set({ apiKey: e.target.value })}
            placeholder={existing?.hasApiKey ? "••••••••••••" : isClaude ? "sk-ant-…" : "sk-…"}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <Field label="Model">
          <div className="flex gap-2">
            <Input
              list="model-options"
              value={form.model}
              onChange={(e) => set({ model: e.target.value })}
              placeholder={isClaude ? "claude-opus-5-5" : "Pick or type a model id"}
            />
            <datalist id="model-options">
              {probe?.models.map((m) => <option key={m} value={m} />)}
            </datalist>
            <Button onClick={test} disabled={probing || !form.baseUrl} className="shrink-0">
              {probing ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
              Test
            </Button>
          </div>
        </Field>
        {probe && (
          <div className={clsx("flex items-start gap-2 text-sm", probe.ok ? "text-success" : "text-danger")}>
            {probe.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <CircleAlert size={16} className="mt-0.5 shrink-0" />}
            <span>{probe.ok ? `Connected! Found ${probe.models.length} models. Pick one above.` : probe.error}</span>
          </div>
        )}
      </div>

      <details className="group rounded-xl border border-line bg-surface-2/50 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-muted select-none group-open:mb-4">Generation settings</summary>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Max reply tokens" hint={isClaude ? "Includes Claude's thinking." : undefined}>
            <Input type="number" value={gen.maxTokens} onChange={(e) => setGen({ ...gen, maxTokens: Number(e.target.value) })} />
          </Field>
          <Field label="Context size (tokens)" hint="Older messages are trimmed to fit.">
            <Input type="number" value={gen.contextSize} onChange={(e) => setGen({ ...gen, contextSize: Number(e.target.value) })} />
          </Field>
          {isClaude ? (
            <Field label="Effort" hint="How hard Claude thinks. Low is snappy, high is deeper.">
              <select
                value={gen.effort}
                onChange={(e) => setGen({ ...gen, effort: e.target.value as Effort })}
                className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink focus:outline-none"
              >
                {["low", "medium", "high", "xhigh", "max"].map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <>
              <Field label={`Temperature · ${gen.temperature.toFixed(2)}`}>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={gen.temperature}
                  onChange={(e) => setGen({ ...gen, temperature: Number(e.target.value) })}
                  className="w-full accent-[var(--accent)]"
                />
              </Field>
              <Field label={`Top P · ${gen.topP.toFixed(2)}`}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={gen.topP}
                  onChange={(e) => setGen({ ...gen, topP: Number(e.target.value) })}
                  className="w-full accent-[var(--accent)]"
                />
              </Field>
            </>
          )}
        </div>
      </details>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending || !form.name.trim()}>
          {save.isPending && <Loader2 size={15} className="animate-spin" />}
          {existing ? "Save changes" : "Add connection"}
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Persona and prompt

function useSettingsDraft<K extends "userName" | "userDescription" | "systemPrompt">(key: K) {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [value, setValue] = useState<string>("");
  const saved = settings.data?.[key] ?? "";
  useEffect(() => setValue(saved), [saved]);
  const save = useMutation({
    mutationFn: (v: string) => api.updateSettings({ [key]: v }),
    onSuccess: (data) => queryClient.setQueryData(keys.settings, data),
  });
  return { value, setValue, dirty: value !== saved, save: () => save.mutate(value), saving: save.isPending };
}

function SaveBar({ dirty, saving, onSave, extra }: { dirty: boolean; saving: boolean; onSave: () => void; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2">
      {extra}
      <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={onSave}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : null}
        {dirty ? "Save" : "Saved"}
      </Button>
    </div>
  );
}

function PersonaSection() {
  const name = useSettingsDraft("userName");
  const description = useSettingsDraft("userDescription");
  const dirty = name.dirty || description.dirty;
  return (
    <Section title="You" description="Who you are in the story. Characters see this as {{user}}.">
      <Card className="space-y-4">
        <Field label="Your name">
          <Input value={name.value} onChange={(e) => name.setValue(e.target.value)} />
        </Field>
        <Field label="About you" hint="Optional. Appearance, personality, anything characters should know.">
          <Textarea rows={3} value={description.value} onChange={(e) => description.setValue(e.target.value)} placeholder="A wandering bard with a borrowed lute and a talent for trouble." />
        </Field>
        <SaveBar
          dirty={dirty}
          saving={name.saving || description.saving}
          onSave={() => {
            if (name.dirty && name.value.trim()) name.save();
            if (description.dirty) description.save();
          }}
        />
      </Card>
    </Section>
  );
}

function PromptSection() {
  const prompt = useSettingsDraft("systemPrompt");
  return (
    <Section title="System prompt" description="The instructions sent before every chat. {{char}} and {{user}} are filled in for you.">
      <Card className="space-y-4">
        <Textarea rows={7} value={prompt.value} onChange={(e) => prompt.setValue(e.target.value)} className="font-mono text-[13px]" />
        <SaveBar
          dirty={prompt.dirty}
          saving={prompt.saving}
          onSave={prompt.save}
          extra={
            prompt.value !== DEFAULT_SYSTEM_PROMPT && (
              <Button variant="ghost" size="sm" onClick={() => prompt.setValue(DEFAULT_SYSTEM_PROMPT)}>
                <RotateCcw size={14} /> Reset to default
              </Button>
            )
          }
        />
      </Card>
    </Section>
  );
}
