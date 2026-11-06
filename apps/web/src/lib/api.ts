import type {
  AppSettings,
  Character,
  Chat,
  Connection,
  GenerateEvent,
  GenerateMode,
  GenerationSettings,
  Message,
  Persona,
  ProviderKind,
  CharacterCard,
} from "@parlor/shared";

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: isForm ? init?.headers : { "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export interface ConnectionInput {
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey?: string;
  settings?: Partial<GenerationSettings>;
}

export interface ProbeResult {
  ok: boolean;
  models: string[];
  error?: string;
}

export interface ImportResult {
  imported: Character[];
  errors: { file: string; error: string }[];
}

function filesForm(files: Iterable<File | Blob>, name = "file"): FormData {
  const form = new FormData();
  for (const file of files) form.append(name, file, file instanceof File ? file.name : "avatar.png");
  return form;
}

export interface ChatDetail {
  chat: Chat;
  character: Character;
  messages: Message[];
}

export const api = {
  settings: () => request<AppSettings>("/settings"),
  updateSettings: (patch: Partial<AppSettings>) => send<AppSettings>("PATCH", "/settings", patch),

  connections: () => request<Connection[]>("/connections"),
  createConnection: (input: ConnectionInput) => send<Connection>("POST", "/connections", input),
  updateConnection: (id: string, input: Partial<ConnectionInput>) => send<Connection>("PATCH", `/connections/${id}`, input),
  deleteConnection: (id: string) => send<void>("DELETE", `/connections/${id}`),
  probe: (input: { provider: ProviderKind; baseUrl: string; apiKey?: string; connectionId?: string }) =>
    send<ProbeResult>("POST", "/connections/probe", input),

  personas: () => request<Persona[]>("/personas"),
  createPersona: (input: { name: string; description: string }) => send<Persona>("POST", "/personas", input),
  updatePersona: (id: string, patch: { name?: string; description?: string }) => send<Persona>("PATCH", `/personas/${id}`, patch),
  deletePersona: (id: string) => send<void>("DELETE", `/personas/${id}`),

  characters: () => request<Character[]>("/characters"),
  character: (id: string) => request<Character>(`/characters/${id}`),
  createCharacter: (card: Partial<CharacterCard>) => send<Character>("POST", "/characters", card),
  updateCharacter: (id: string, card: Partial<CharacterCard>) => send<Character>("PATCH", `/characters/${id}`, card),
  deleteCharacter: (id: string) => send<void>("DELETE", `/characters/${id}`),
  duplicateCharacter: (id: string) => send<Character>("POST", `/characters/${id}/duplicate`),
  importCharacters: async (files: File[]): Promise<ImportResult> => {
    // A 400 still carries per-file errors, so read the body either way.
    const res = await fetch("/api/characters/import", { method: "POST", body: filesForm(files) });
    const body = await res.json().catch(() => ({}));
    if (!body.imported) throw new ApiError(body.error ?? `Import failed (${res.status})`);
    return body as ImportResult;
  },
  exportUrl: (id: string, format: "png" | "json") => `/api/characters/${id}/export?format=${format}`,

  setAvatar: (kind: "characters" | "personas", id: string, png: Blob) =>
    request<{ avatar: string }>(`/${kind}/${id}/avatar`, { method: "PUT", body: filesForm([png]) }),
  removeAvatar: (kind: "characters" | "personas", id: string) => send<void>("DELETE", `/${kind}/${id}/avatar`),

  chats: (characterId: string) => request<Chat[]>(`/characters/${characterId}/chats`),
  createChat: (characterId: string) => send<Chat>("POST", `/characters/${characterId}/chats`),

  chat: (chatId: string) => request<ChatDetail>(`/chats/${chatId}`),
  renameChat: (chatId: string, title: string) => send<void>("PATCH", `/chats/${chatId}`, { title }),
  deleteChat: (chatId: string) => send<void>("DELETE", `/chats/${chatId}`),

  updateMessage: (id: number, patch: { swipeId?: number; content?: string }) => send<Message>("PATCH", `/messages/${id}`, patch),
  deleteMessage: (id: number) => send<void>("DELETE", `/messages/${id}`),
};

/**
 * Starts a generation and calls `onEvent` for each streamed event.
 * Resolves when the stream ends; abort the signal to stop early.
 */
export async function generate(
  chatId: string,
  body: { mode: GenerateMode; text?: string },
  onEvent: (event: GenerateEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/chats/${chatId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(err.error ?? `Generation failed (${res.status})`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let split: number;
    while ((split = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data:")) onEvent(JSON.parse(line.slice(5)) as GenerateEvent);
      }
    }
  }
}
