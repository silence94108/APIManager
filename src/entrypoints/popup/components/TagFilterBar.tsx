import type { Tag } from "@/types";
import { TagChip } from "@/ui/components";

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
          <TagChip
            key={tag.id}
            pill
            active={active}
            onClick={() =>
              onChange(active ? selected.filter((id) => id !== tag.id) : [...selected, tag.id])
            }
          >
            #{tag.name}
          </TagChip>
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
