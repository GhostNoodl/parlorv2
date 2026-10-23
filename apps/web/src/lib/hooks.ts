import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "./api";
import { useToast } from "./toast";

export const keys = {
  settings: ["settings"] as const,
  connections: ["connections"] as const,
  characters: ["characters"] as const,
  personas: ["personas"] as const,
  chats: (characterId: string) => ["chats", characterId] as const,
  chat: (chatId: string) => ["chat", chatId] as const,
};

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings });
export const useConnections = () => useQuery({ queryKey: keys.connections, queryFn: api.connections });
export const useCharacters = () => useQuery({ queryKey: keys.characters, queryFn: api.characters });

export const usePersonas = () => useQuery({ queryKey: keys.personas, queryFn: api.personas });

export function useActivePersona() {
  const settings = useSettings();
  const personas = usePersonas();
  return personas.data?.find((p) => p.id === settings.data?.activePersonaId) ?? personas.data?.[0] ?? null;
}

/** Imports card files and reports how it went. */
export function useImportCharacters() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (files: File[]) => api.importCharacters(files),
    onSuccess: ({ imported, errors }) => {
      queryClient.invalidateQueries({ queryKey: keys.characters });
      if (imported.length) {
        const names = imported.map((c) => c.name);
        toast("success", names.length === 1 ? `Welcome, ${names[0]}! 🎉` : `Imported ${names.length} characters: ${names.join(", ")}`);
      }
      for (const e of errors) toast("error", `${e.file}: ${e.error}`);
    },
    onError: (err) => toast("error", (err as Error).message),
  });
}

export function useActiveConnection() {
  const settings = useSettings();
  const connections = useConnections();
  return connections.data?.find((c) => c.id === settings.data?.activeConnectionId) ?? null;
}

/** Opens a character's most recent chat, starting one if they have none. */
export function useOpenCharacter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useCallback(
    async (characterId: string) => {
      const chats = await queryClient.fetchQuery({ queryKey: keys.chats(characterId), queryFn: () => api.chats(characterId) });
      const chat = chats[0] ?? (await api.createChat(characterId));
      if (!chats[0]) queryClient.invalidateQueries({ queryKey: keys.chats(characterId) });
      navigate(`/chat/${chat.id}`);
    },
    [navigate, queryClient],
  );
}

export function useNewChat() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useCallback(
    async (characterId: string) => {
      const chat = await api.createChat(characterId);
      queryClient.invalidateQueries({ queryKey: keys.chats(characterId) });
      navigate(`/chat/${chat.id}`);
    },
    [navigate, queryClient],
  );
}
