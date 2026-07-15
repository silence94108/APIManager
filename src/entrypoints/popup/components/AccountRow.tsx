import { useState } from "react";
import { sendMessage } from "@/messaging/protocol";
import { checkinResultsItem } from "@/storage/items";
import type { Account, CheckinResults } from "@/types";
import { formatUsd } from "@/utils/quota";
import { cn, Spinner, StatusDot, toast, type DotStatus } from "@/ui/components";

function dotStatus(account: Account, results: CheckinResults, today: string): DotStatus {
  if (account.disabled) return "disabled";
  if (account.tokenState === "expired") return "expired";
  const r = results[account.id];
  if (r?.date === today) {
    if (r.status === "success" || r.status === "already_checked") return "checked";
    if (r.status === "failed") return "failed";
  }
  return "unchecked";
}

export default function AccountRow({
  account,
  results,
  today,
}: {
  account: Account;
  results: CheckinResults;
  today: string;
}) {
  const [busy, setBusy] = useState<"checkin" | "refresh" | null>(null);
  const [pulse, setPulse] = useState(false);

  const status = dotStatus(account, results, today);
  const canCheckin = !account.disabled && account.checkinEnabled && account.tokenState !== "expired";

  async function checkin() {
    setBusy("checkin");
    try {
      const res = await sendMessage("runCheckin", { accountIds: [account.id] });
      if (!res.ok) {
        toast(res.error, "err");
        return;
      }
      // 不用返回的整体 summary 判断——若撞上正在跑的全量签到会复用其结果；
      // 以存储里本账号的今日记录为准
      const record = (await checkinResultsItem.getValue())[account.id];
      if (record?.date !== today) {
        toast(`${account.name} 被跳过（未启用签到或 Token 过期）`, "err");
        return;
      }
      if (record.status === "success") {
        setPulse(true);
        setTimeout(() => setPulse(false), 800);
        toast(`${account.name} 签到成功`);
      } else if (record.status === "already_checked") {
        toast(`${account.name} 今天已经签过啦`);
      } else {
        toast(`${account.name} 签到失败${record.message ? `：${record.message}` : ""}`, "err");
      }
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy("refresh");
    try {
      const res = await sendMessage("refreshBalance", account.id);
      if (res.ok) toast(`${account.name} 余额已更新：${formatUsd(res.usd)}`);
      else toast(`${account.name}：${res.error}`, "err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-raised",
        account.disabled && "opacity-45",
      )}
    >
      <StatusDot status={status} pulse={pulse} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] leading-tight text-ink">{account.name}</p>
        {account.username && (
          <p className="truncate text-[10px] leading-tight text-ink-faint">{account.username}</p>
        )}
      </div>

      {/* hover 操作：签到 / 刷余额 / 打开站点 */}
      <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        {busy ? (
          <Spinner className="mx-1.5" />
        ) : (
          <>
            {canCheckin && (
              <RowAction title="签到" onClick={checkin}>
                ⚡
              </RowAction>
            )}
            <RowAction title="刷新余额" onClick={refresh}>
              ↻
            </RowAction>
            <RowAction title="打开站点" onClick={() => window.open(account.url)}>
              ↗
            </RowAction>
          </>
        )}
      </div>

      <span className="readout shrink-0 text-[13px] text-ink-mute group-hover:hidden">
        {account.balance ? formatUsd(account.balance.usd) : "—"}
      </span>
    </div>
  );
}

function RowAction({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="rounded px-1.5 py-0.5 text-[12px] text-ink-mute transition hover:bg-carbon hover:text-phos"
    >
      {children}
    </button>
  );
}
