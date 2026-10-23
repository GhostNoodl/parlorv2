import type { ReactNode } from "react";

// Roleplay text styling: *actions* in italics, "speech" highlighted,
// **bold** kept bold. Builds React nodes, so model output is never HTML.
const TOKEN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|"[^"\n]*"?|“[^”\n]*”?)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(TOKEN).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <em key={key} className="text-action">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith('"') || part.startsWith("“")) {
      return (
        <span key={key} className="text-speech font-medium">
          {part}
        </span>
      );
    }
    return part;
  });
}

export function RpText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div className="space-y-3 leading-relaxed">
      {paragraphs.map((para, p) => (
        <p key={p} className={`whitespace-pre-wrap ${streaming && p === paragraphs.length - 1 ? "typing-caret" : ""}`}>
          {renderInline(para, String(p))}
        </p>
      ))}
    </div>
  );
}
