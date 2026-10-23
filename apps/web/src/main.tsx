import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Upload } from "lucide-react";
import { StrictMode, useRef, useState, type DragEvent } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider, useMatch } from "react-router";
import { Sidebar } from "./components/Sidebar";
import { api } from "./lib/api";
import { keys, useImportCharacters } from "./lib/hooks";
import type { LayoutContext } from "./lib/layout";
import { useTheme } from "./lib/theme";
import { ToastProvider } from "./lib/toast";
import { CharacterPage } from "./pages/CharacterPage";
import { ChatPage } from "./pages/ChatPage";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes("Files");

function Layout() {
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const importCharacters = useImportCharacters();
  const chatId = useMatch("/chat/:chatId")?.params.chatId;
  const characterId = useMatch("/characters/:characterId")?.params.characterId;
  const chat = useQuery({ queryKey: keys.chat(chatId ?? ""), queryFn: () => api.chat(chatId!), enabled: Boolean(chatId) });

  // Drop card PNGs or JSON anywhere to import them.
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      dragDepth.current++;
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      if (--dragDepth.current <= 0) setDragging(false);
    },
    onDragOver: (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = [...e.dataTransfer.files].filter((f) => /\.(png|json)$/i.test(f.name));
      if (files.length) importCharacters.mutate(files);
    },
  };

  return (
    <div className="flex h-dvh overflow-hidden" {...dropHandlers}>
      <Sidebar
        activeCharacterId={chatId ? (chat.data?.character.id ?? null) : (characterId ?? null)}
        theme={theme}
        onToggleTheme={toggle}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Outlet context={{ openMenu: () => setMenuOpen(true) } satisfies LayoutContext} />
      </main>
      <div
        className={clsx(
          "pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-6 backdrop-blur-sm transition-opacity",
          dragging ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent/60 px-14 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-accent text-accent-ink">
            <Upload size={26} />
          </div>
          <div className="font-display text-2xl font-semibold">Drop to import</div>
          <div className="text-sm text-muted">Character card PNGs or JSON files</div>
        </div>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "chat/:chatId", element: <ChatPage /> },
      { path: "characters/new", element: <CharacterPage /> },
      { path: "characters/:characterId", element: <CharacterPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
