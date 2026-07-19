import { useState } from "react";
import { canCheckin, resolveCheckinPageUrl } from "@/checkin/helpers";
import { sendMessage } from "@/messaging/protocol";
import { checkinResultsItem } from "@/storage/items";
import { BALANCE_SITE_TYPES, type Account, type CheckinResults } from "@/types";
import { formatUsd } from "@/utils/quota";
import { cn, dotStatus, SiteAvatar, Spinner, StatusDot, toast } from "@/ui/components";

export default function AccountRow({
  account,
  results,
  today,
  onEdit,
}: {
  account: Account;
  results: CheckinResults;
  today: string;
  onEdit: (account: Account) => void;
}) {
  const [busy, setBusy] = useState<"checkin" | "refresh" | null>(null);
  const [pulse, setPulse] = useState(false);

  const status = dotStatus(account, results, today);
  const eligible = canCheckin(account);
  const hasBalance = BALANCE_SITE_TYPES.includes(account.siteType);

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
      } else if (record.status === "needs_verification") {
        // 人机验证只能真人在站点完成——直接打开签到页，把"勾一下"交还用户
        toast(`${account.name} 需完成人机验证，已为你打开签到页`, "err");
        window.open(resolveCheckinPageUrl(account));
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
      <SiteAvatar name={account.name} faviconUrl={account.faviconUrl} size="sm" />
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
            {eligible && (
              <RowAction title="签到" onClick={checkin}>
                ⚡
              </RowAction>
            )}
            {hasBalance && (
              <RowAction title="刷新余额" onClick={refresh}>
                ↻
              </RowAction>
            )}
            <RowAction title="编辑账号" onClick={() => onEdit(account)}>
              ✎
            </RowAction>
            {/* 不参与自动签到但配了自定义签到链接的账号（如仅记录型）也给手动入口 */}
            {(eligible || !!account.checkinPageUrl?.trim()) && (
              <RowAction title="去签到页" onClick={() => window.open(resolveCheckinPageUrl(account))}>
                ✋
              </RowAction>
            )}
            <RowAction title="打开站点" onClick={() => window.open(account.url)}>
              ↗
            </RowAction>
          </>
        )}
      </div>

      {/* 非 hover 态：失败/待验证时余额位让给快捷操作——问题账号不该藏在 hover 后面 */}
      {status === "failed" && !busy ? (
        <button
          title={`签到失败${results[account.id]?.message ? `：${results[account.id].message}` : ""}，点击重试`}
          onClick={checkin}
          className="shrink-0 rounded border border-signal/40 px-1.5 py-px text-[11px] text-signal transition hover:bg-carbon group-hover:hidden"
        >
          ↯ 重试
        </button>
      ) : status === "verify" && !busy ? (
        <button
          title="需人机验证——去签到页手动完成后再签"
          onClick={() => window.open(resolveCheckinPageUrl(account))}
          className="shrink-0 rounded border border-amber/40 px-1.5 py-px text-[11px] text-amber transition hover:bg-carbon group-hover:hidden"
        >
          ⚠ 验证
        </button>
      ) : (
        <span className="flex shrink-0 flex-col items-end group-hover:hidden">
          <span className="readout text-[13px] text-ink-mute">
            {account.balance ? formatUsd(account.balance.usd) : "—"}
          </span>
          {/* 行高有限只显一个口径：今日消耗优先（更常看），站点拿不到今日再退累计 */}
          {account.usage?.todayUsd !== undefined ? (
            <span className="readout text-[9px] leading-tight text-ink-faint">
              今日 {formatUsd(account.usage.todayUsd)}
            </span>
          ) : account.usage?.totalUsd !== undefined ? (
            <span className="readout text-[9px] leading-tight text-ink-faint">
              累计 {formatUsd(account.usage.totalUsd)}
            </span>
          ) : null}
        </span>
      )}
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
