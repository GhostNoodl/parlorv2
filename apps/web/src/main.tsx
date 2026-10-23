import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Outlet, Route, Routes, useMatch } from "react-router";
import { Sidebar } from "./components/Sidebar";
import { api } from "./lib/api";
import { keys } from "./lib/hooks";
import type { LayoutContext } from "./lib/layout";
import { useTheme } from "./lib/theme";
import { ChatPage } from "./pages/ChatPage";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

function Layout() {
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const chatId = useMatch("/chat/:chatId")?.params.chatId;
  const chat = useQuery({ queryKey: keys.chat(chatId ?? ""), queryFn: () => api.chat(chatId!), enabled: Boolean(chatId) });

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        activeCharacterId={chatId ? (chat.data?.character.id ?? null) : null}
        theme={theme}
        onToggleTheme={toggle}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Outlet context={{ openMenu: () => setMenuOpen(true) } satisfies LayoutContext} />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="chat/:chatId" element={<ChatPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
