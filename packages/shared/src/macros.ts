export interface MacroContext {
  char: string;
  user: string;
}

/**
 * Replaces SillyTavern-style macros. Supports {{char}}, {{user}} and the
 * legacy <BOT> / <USER> tags, case-insensitively.
 */
export function applyMacros(text: string, ctx: MacroContext): string {
  return text
    .replace(/\{\{\s*char\s*\}\}|<BOT>/gi, ctx.char)
    .replace(/\{\{\s*user\s*\}\}|<USER>/gi, ctx.user);
}
