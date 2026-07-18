import { useState } from "react";
import { cn, ToastHost } from "@/ui/components";
import AccountsPage from "./pages/AccountsPage";
import CheckinPage from "./pages/CheckinPage";
import GroupsTagsPage from "./pages/GroupsTagsPage";
import ImportExportPage from "./pages/ImportExportPage";
import SecurityPage from "./pages/SecurityPage";

const NAV = [
  { key: "accounts", icon: "▦", label: "账号", page: AccountsPage },
  { key: "groups", icon: "▣", label: "分组与标签", page: GroupsTagsPage },
  { key: "checkin", icon: "◔", label: "自动签到", page: CheckinPage },
  { key: "security", icon: "◈", label: "安全", page: SecurityPage },
  { key: "data", icon: "⇅", label: "数据", page: ImportExportPage },
] as const;

type NavKey = (typeof NAV)[number]["key"];

export default function App() {
  // 支持 options.html#security 之类的锚点直达（popup 表单引导设置主密码用）
  const [active, setActive] = useState<NavKey>(() => {
    const hash = location.hash.slice(1);
    return NAV.some((n) => n.key === hash) ? (hash as NavKey) : "accounts";
  });
  const ActivePage = NAV.find((n) => n.key === active)!.page;

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl">
      <aside className="w-48 shrink-0 border-r border-line p-4">
        <p className="readout mb-6 text-[15px] tracking-wide text-phos">
          API<span className="text-ink">Manager</span>
        </p>
        <nav className="space-y-1">
          {NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => setActive(item.key)}
              className={cn(
                "relative flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] transition",
                active === item.key
                  ? "bg-raised text-ink"
                  : "text-ink-mute hover:bg-raised/50 hover:text-ink",
              )}
            >
              {active === item.key && (
                <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-phos" />
              )}
              <span className="readout text-[12px]">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 p-6">
        <ActivePage />
      </main>

      <ToastHost />
    </div>
  );
}
