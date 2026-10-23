import clsx from "clsx";

/** A stable hue per name, so every character gets their own colour. */
export function nameHue(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function Avatar({ name, src, size = 40, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const hue = nameHue(name);
  const style = { width: size, height: size, fontSize: size * 0.42 };
  if (src) {
    return <img src={src} alt="" style={style} className={clsx("shrink-0 rounded-full object-cover ring-1 ring-line", className)} />;
  }
  return (
    <div
      aria-hidden
      style={{
        ...style,
        background: `linear-gradient(135deg, hsl(${hue} 75% 72%), hsl(${(hue + 50) % 360} 65% 55%))`,
      }}
      className={clsx("flex shrink-0 select-none items-center justify-center rounded-full font-display font-semibold text-white/95 shadow-inner ring-1 ring-white/10", className)}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}
