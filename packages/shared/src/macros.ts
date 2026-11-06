export interface MacroContext {
  char: string;
  user: string;
  /** Defaults to now; pass a fixed date in tests. */
  now?: Date;
}

/**
 * Replaces SillyTavern-style macros, case-insensitively:
 * {{char}}, {{user}} (plus the legacy <BOT> / <USER> tags), {{date}},
 * {{time}}, {{weekday}}, {{random:a,b,c}}, {{newline}} and {{// comments}}.
 */
export function applyMacros(text: string, ctx: MacroContext): string {
  const now = ctx.now ?? new Date();
  return text
    .replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, "")
    .replace(/\{\{\s*char\s*\}\}|<BOT>/gi, ctx.char)
    .replace(/\{\{\s*user\s*\}\}|<USER>/gi, ctx.user)
    .replace(/\{\{\s*date\s*\}\}/gi, now.toLocaleDateString("en-US", { dateStyle: "long" }))
    .replace(/\{\{\s*time\s*\}\}/gi, now.toLocaleTimeString("en-US", { timeStyle: "short" }))
    .replace(/\{\{\s*weekday\s*\}\}/gi, now.toLocaleDateString("en-US", { weekday: "long" }))
    .replace(/\{\{\s*newline\s*\}\}/gi, "\n")
    .replace(/\{\{\s*random\s*::?([^}]*)\}\}/gi, (_, list: string) => {
      const options = (list.includes("::") ? list.split("::") : list.split(",")).map((o) => o.trim());
      return options[Math.floor(Math.random() * options.length)] ?? "";
    });
}
