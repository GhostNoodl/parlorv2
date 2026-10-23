import clsx from "clsx";
import { ImagePlus, Trash2 } from "lucide-react";
import { useRef } from "react";
import { nameHue } from "./Avatar";

/** A portrait-shaped image slot. Calls onPick with the chosen file. */
export function AvatarPicker({
  name,
  src,
  onPick,
  onRemove,
  shape = "portrait",
  className,
}: {
  name: string;
  src: string | null;
  onPick: (file: File) => void;
  onRemove?: () => void;
  shape?: "portrait" | "square";
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hue = nameHue(name || "?");
  return (
    <div className={clsx("group relative overflow-hidden rounded-2xl border border-line shadow-xl shadow-black/10", shape === "portrait" ? "aspect-[2/3]" : "aspect-square", className)}>
      {src ? (
        <img src={src} alt="" className="size-full object-cover object-top" />
      ) : (
        <div
          className="flex size-full items-center justify-center font-display text-7xl font-semibold text-white/90"
          style={{ background: `linear-gradient(150deg, hsl(${hue} 75% 72%), hsl(${(hue + 50) % 360} 60% 45%))` }}
        >
          {name.trim().charAt(0).toUpperCase() || "?"}
        </div>
      )}
      <div className="absolute inset-0 flex items-end justify-center gap-2 bg-gradient-to-t from-black/60 via-black/0 to-black/0 p-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-black shadow hover:bg-white"
        >
          <ImagePlus size={14} /> {src ? "Change" : "Add image"}
        </button>
        {src && onRemove && (
          <button
            type="button"
            aria-label="Remove image"
            onClick={onRemove}
            className="flex items-center rounded-lg bg-black/60 px-2 py-1.5 text-xs text-white hover:bg-black/80"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
