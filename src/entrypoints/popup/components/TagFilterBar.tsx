import type { Tag } from "@/types";
import { cn } from "@/ui/components";

export default function TagFilterBar({
  tags,
  selected,
  onChange,
}: {
  tags: Tag[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-1.5">
      {tags.map((tag) => {
        const active = selected.includes(tag.id);
        return (
          <button
            key={tag.id}
            onClick={() =>
              onChange(active ? selected.filter((id) => id !== tag.id) : [...selected, tag.id])
            }
            className={cn(
              "rounded-full border px-2 py-px text-[11px] transition",
              active
                ? "border-phos/50 bg-phos/10 text-phos"
                : "border-line text-ink-faint hover:border-ink-faint hover:text-ink-mute",
            )}
          >
            #{tag.name}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="ml-auto text-[11px] text-ink-faint transition hover:text-ink-mute"
        >
          × 清除
        </button>
      )}
    </div>
  );
}
