import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/ui/components";
import { formatUsd } from "@/utils/quota";

export default function GroupSection({
  title,
  count,
  balance,
  collapsed,
  onToggle,
  children,
  style,
}: {
  title: string;
  count: number;
  balance: number;
  collapsed: boolean;
  onToggle: (next: boolean) => void;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section className="rise-in mb-1.5" style={style}>
      <button
        onClick={() => onToggle(!collapsed)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-raised/60"
      >
        <span
          className={cn(
            "readout inline-block text-[10px] text-ink-faint transition-transform",
            !collapsed && "rotate-90",
          )}
        >
          ▶
        </span>
        <span className="flex-1 truncate text-[12px] font-medium text-ink-mute">
          {title}
          <span className="ml-1.5 text-[11px] text-ink-faint">{count}</span>
        </span>
        <span className="readout text-[12px] text-ink-mute">{formatUsd(balance)}</span>
      </button>
      {!collapsed && (
        <div className="mt-0.5 space-y-px rounded-lg border border-line bg-panel p-1">
          {count === 0 ? (
            <p className="px-2 py-2 text-center text-[11px] text-ink-faint">组内暂无账号</p>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}
