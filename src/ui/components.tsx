import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { isCheckedToday } from "@/checkin/helpers";
import type { Account, CheckinResults } from "@/types";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ── Button ────────────────────────────────────────────

type ButtonVariant = "phos" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  phos: "bg-phos text-carbon font-semibold hover:brightness-110 active:scale-[0.97]",
  ghost:
    "border border-line text-ink-mute hover:text-ink hover:border-ink-faint active:scale-[0.97]",
  danger: "border border-signal/30 text-signal hover:bg-signal/10 active:scale-[0.97]",
};

export function Button({
  variant = "ghost",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return (
    <button
      className={cn(
        "rounded-md transition disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "px-2 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

// ── 表单件 ────────────────────────────────────────────

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-faint">{hint}</span>}
    </label>
  );
}

const CONTROL_CLASS =
  "w-full rounded-md border border-line bg-carbon px-2.5 py-1.5 text-[13px] text-ink outline-none transition focus:border-phos/50 placeholder:text-ink-faint";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL_CLASS, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL_CLASS, "appearance-none", className)} {...props} />;
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2"
    >
      <span
        className={cn(
          "relative h-[18px] w-8 rounded-full border transition",
          checked ? "border-phos/50 bg-phos/25" : "border-line bg-raised",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] h-3 w-3 rounded-full transition-all",
            checked ? "left-[16px] bg-phos" : "left-[2px] bg-ink-faint",
          )}
        />
      </span>
      {label && <span className="text-[13px] text-ink-mute">{label}</span>}
    </button>
  );
}

// ── 状态件 ────────────────────────────────────────────

export type DotStatus = "checked" | "unchecked" | "failed" | "expired" | "verify" | "disabled";

const DOT_CLASS: Record<DotStatus, string> = {
  checked: "bg-phos dot-phos",
  unchecked: "bg-ink-faint",
  failed: "bg-signal",
  expired: "bg-amber",
  verify: "bg-amber",
  disabled: "bg-ink-faint/40",
};

export const DOT_TITLE: Record<DotStatus, string> = {
  checked: "今日已签到",
  unchecked: "今日未签到",
  failed: "签到失败",
  expired: "Token 已过期",
  verify: "需完成人机验证",
  disabled: "已禁用",
};

export function StatusDot({ status, pulse }: { status: DotStatus; pulse?: boolean }) {
  return (
    <span
      title={DOT_TITLE[status]}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT_CLASS[status], pulse && "dot-pulse")}
    />
  );
}

/** account → 状态点的推导（disabled > expired > 今日签到态），popup 与 options 共用 */
export function dotStatus(account: Account, results?: CheckinResults, today?: string): DotStatus {
  if (account.disabled) return "disabled";
  if (account.tokenState === "expired") return "expired";
  if (results && today) {
    const record = results[account.id];
    if (isCheckedToday(record, today)) return "checked";
    if (record?.date === today && record.status === "failed") return "failed";
    if (record?.date === today && record.status === "needs_verification") return "verify";
  }
  return "unchecked";
}

/** 标签 chip（选中态磷光）——options 表单与 popup 筛选栏共用同一视觉语言 */
export function TagChip({
  active,
  onClick,
  pill,
  children,
}: {
  active: boolean;
  onClick: () => void;
  pill?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border transition",
        pill ? "rounded-full px-2 py-px text-[11px]" : "rounded px-2 py-0.5 text-[12px]",
        active
          ? "border-phos/50 bg-phos/10 text-phos"
          : "border-line text-ink-mute hover:border-ink-faint hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function Badge({ tone, children }: { tone: "phos" | "amber" | "signal" | "mute"; children: ReactNode }) {
  const tones = {
    phos: "border-phos/40 text-phos",
    amber: "border-amber/40 text-amber",
    signal: "border-signal/40 text-signal",
    mute: "border-line text-ink-faint",
  };
  return (
    <span className={cn("rounded border px-1.5 py-px text-[11px]", tones[tone])}>{children}</span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-phos/20 border-t-phos",
        className,
      )}
    />
  );
}

export function EmptyState({ icon, text, action }: { icon: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <span className="readout text-2xl text-ink-faint">{icon}</span>
      <p className="text-[13px] text-ink-mute">{text}</p>
      {action}
    </div>
  );
}

// ── Dialog ────────────────────────────────────────────

/** 打开顺序栈：嵌套弹窗（如表单里弹解锁框）时 ESC 只关最上层 */
const dialogStack: symbol[] = [];

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const id = Symbol();
    dialogStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dialogStack[dialogStack.length - 1] === id) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      dialogStack.splice(dialogStack.indexOf(id), 1);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={cn(
          "max-h-[85vh] w-full overflow-y-auto rounded-xl border border-line bg-panel p-5 shadow-2xl",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <h2 className="readout mb-4 text-[15px] text-phos">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** 危险操作确认弹窗：统一"取消 / danger 确认"的按钮对与交互 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "删除",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmText?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      <p className="text-[13px] text-ink-mute">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onCancel}>取消</Button>
        <Button variant="danger" onClick={onConfirm}>
          {confirmText}
        </Button>
      </div>
    </Dialog>
  );
}

// ── Toast（模块级 pub/sub，避免为一个提示上 context） ──

interface ToastMsg {
  id: number;
  text: string;
  tone: "ok" | "err";
}

let toastListeners: Array<(t: ToastMsg) => void> = [];
let toastSeq = 0;

export function toast(text: string, tone: "ok" | "err" = "ok") {
  const msg = { id: ++toastSeq, text, tone };
  toastListeners.forEach((l) => l(msg));
}

export function ToastHost() {
  const [items, setItems] = useState<ToastMsg[]>([]);

  useEffect(() => {
    const on = (t: ToastMsg) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 3200);
    };
    toastListeners.push(on);
    return () => {
      toastListeners = toastListeners.filter((l) => l !== on);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-[60] flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            "rise-in max-w-xs rounded-md border px-3 py-2 text-[12px] shadow-lg",
            t.tone === "ok"
              ? "border-phos/40 bg-panel text-phos"
              : "border-signal/40 bg-panel text-signal",
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
