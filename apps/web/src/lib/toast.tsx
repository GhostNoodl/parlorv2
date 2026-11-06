import clsx from "clsx";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  kind: "success" | "error";
  text: string;
}

const ToastContext = createContext<(kind: Toast["kind"], text: string) => void>(() => {});

export const useToast = () => useContext(ToastContext);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((all) => all.filter((t) => t.id !== id));
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = nextId++;
    setToasts((all) => [...all.slice(-3), { id, kind, text }]);
    setTimeout(() => dismiss(id), kind === "error" ? 8000 : 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "animate-rise pointer-events-auto flex max-w-md bg-surface items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl shadow-black/20",
              t.kind === "success" ? "border-success/30" : "border-danger/40",
            )}
          >
            {t.kind === "success" ? (
              <CheckCircle2 size={17} className="mt-px shrink-0 text-success" />
            ) : (
              <CircleAlert size={17} className="mt-px shrink-0 text-danger" />
            )}
            <span className="flex-1 whitespace-pre-line">{t.text}</span>
            <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-faint hover:text-ink">
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
