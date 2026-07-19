import { useMemo, useState } from "react";
import { formatRunSummary } from "@/checkin/helpers";
import { detectCurrentSite } from "@/detect/detectCurrentSite";
import { sendMessage } from "@/messaging/protocol";
import {
  accountsItem,
  checkinResultsItem,
  groupsItem,
  schedulerStateItem,
  tagsItem,
} from "@/storage/items";
import { setGroupCollapsed } from "@/storage/groupsTags";
import type { Account, Group } from "@/types";
import { localDayString } from "@/utils/day";
import { formatUsd, sumBalanceUsd } from "@/utils/quota";
import { AccountFormDialog, fromDetected, mergeDetectedIntoAccount, toForm, type FormState } from "@/ui/AccountFormDialog";
import { Button, cn, EmptyState, Spinner, ToastHost, toast } from "@/ui/components";
import { useStorageItem } from "@/ui/hooks";
import AccountRow from "./components/AccountRow";
import GroupSection from "./components/GroupSection";
import TagFilterBar from "./components/TagFilterBar";

/** 堆叠光条各段的磷光透明度序列 */
const BAR_ALPHAS = [1, 0.72, 0.52, 0.38, 0.28, 0.2];

interface Section {
  key: string;
  group: Group | null;
  accounts: Account[];
  balance: number;
}

export default function App() {
  const accounts = useStorageItem(accountsItem);
  const groups = useStorageItem(groupsItem);
  const tags = useStorageItem(tagsItem);
  const results = useStorageItem(checkinResultsItem);
  const schedulerState = useStorageItem(schedulerStateItem);

  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [ungroupedCollapsed, setUngroupedCollapsed] = useState(false);
  const [busyAll, setBusyAll] = useState<"checkin" | "refresh" | "detect" | null>(null);
  const [formState, setFormState] = useState<FormState | null>(null); // 识别与编辑共用同一个表单弹窗

  const today = localDayString();

  const sections = useMemo<Section[]>(() => {
    if (!accounts || !groups) return [];
    const filtered =
      selectedTagIds.length === 0
        ? accounts
        : accounts.filter((a) => selectedTagIds.some((t) => a.tagIds.includes(t)));

    const grouped: Section[] = [...groups]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => {
        const list = filtered.filter((a) => a.groupId === g.id);
        return { key: g.id, group: g, accounts: list, balance: sumBalanceUsd(list) };
      });
    const ungrouped = filtered.filter((a) => !a.groupId);
    if (ungrouped.length || grouped.length === 0) {
      grouped.push({
        key: "__ungrouped",
        group: null,
        accounts: ungrouped,
        balance: sumBalanceUsd(ungrouped),
      });
    }
    const filtering = selectedTagIds.length > 0;
    return grouped.filter((s) => !filtering || s.accounts.length > 0);
  }, [accounts, groups, selectedTagIds]);

  if (!accounts || !groups || !tags) {
    return <div className="w-[380px] p-6" />;
  }

  const totalUsd = sumBalanceUsd(accounts);
  const [intPart, decPart] = formatUsd(totalUsd).split(".");

  async function checkinAll() {
    setBusyAll("checkin");
    try {
      const res = await sendMessage("runCheckin", {});
      if (res.ok) {
        toast(`签到完成：${formatRunSummary(res.outcome.summary)}`);
      } else {
        toast(res.error, "err");
      }
    } finally {
      setBusyAll(null);
    }
  }

  async function refreshAll() {
    setBusyAll("refresh");
    try {
      const { done, failed } = await sendMessage("refreshAllBalances", undefined);
      if (failed.length) {
        toast(`刷新 ${done} 个成功，${failed.length} 个失败：${failed[0].name} ${failed[0].error}`, "err");
      } else {
        toast(`已刷新 ${done} 个账号余额`);
      }
    } finally {
      setBusyAll(null);
    }
  }

  async function detect() {
    setBusyAll("detect");
    try {
      const result = await detectCurrentSite();
      if (!result.ok) {
        toast(result.reason, "err");
        return;
      }
      // 判重（url + userId，与导入判重同一契约）：已存在则转编辑并载入最新登录态
      const dup = (accounts ?? []).find(
        (a) => a.url === result.account.url && a.userId === result.account.userId,
      );
      if (dup) {
        toast(`「${dup.name}」已存在，已载入最新登录态待确认更新`);
        setFormState(mergeDetectedIntoAccount(dup, result.account));
      } else {
        // 直接在 popup 内弹预填表单，不再跳设置页
        setFormState(fromDetected(result.account));
      }
    } finally {
      setBusyAll(null);
    }
  }

  const nextDaily = schedulerState?.nextDailyAt;

  return (
    <div
      className={cn(
        "flex max-h-[580px] w-[380px] flex-col",
        // 弹窗打开时撑高视口，否则账号少时 popup 太矮、表单被压扁
        formState && "min-h-[560px]",
      )}
    >
      <header className="relative border-b border-line px-4 pb-3 pt-4">
        {/* 仪表背光 */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 20% 0%, color-mix(in srgb, var(--color-phos) 7%, transparent), transparent 60%)",
          }}
        />
        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">
              总余额 · {accounts.filter((a) => !a.disabled).length} 个账号
            </p>
            <p className="readout mt-0.5 text-[28px] leading-tight text-ink">
              {intPart}
              <span className="text-[16px] text-ink-mute">.{decPart}</span>
            </p>
          </div>
          <div className="flex gap-1.5 pt-0.5">
            <Button
              size="sm"
              disabled={busyAll !== null}
              onClick={detect}
              title="识别当前标签页的中转站账号"
            >
              {busyAll === "detect" ? <Spinner /> : "⊕ 识别"}
            </Button>
            <Button size="sm" variant="phos" disabled={busyAll !== null} onClick={checkinAll} title="全部签到">
              {busyAll === "checkin" ? <Spinner /> : "⚡ 全签"}
            </Button>
            <Button size="sm" disabled={busyAll !== null} onClick={refreshAll} title="刷新全部余额">
              {busyAll === "refresh" ? <Spinner /> : "↻"}
            </Button>
            <Button size="sm" onClick={() => void browser.runtime.openOptionsPage()} title="设置">
              ⚙
            </Button>
          </div>
        </div>

        {/* 分组余额占比 · 堆叠光条 */}
        {totalUsd > 0 && (
          <div className="relative mt-2.5 flex h-1 gap-px overflow-hidden rounded-full">
            {sections
              .filter((s) => s.balance > 0)
              .map((s, i) => (
                <div
                  key={s.key}
                  title={`${s.group?.name ?? "未分组"} ${formatUsd(s.balance)}`}
                  style={{
                    width: `${(s.balance / totalUsd) * 100}%`,
                    backgroundColor: `color-mix(in srgb, var(--color-phos) ${Math.round(BAR_ALPHAS[i % BAR_ALPHAS.length] * 100)}%, transparent)`,
                  }}
                />
              ))}
          </div>
        )}
      </header>

      <TagFilterBar tags={tags} selected={selectedTagIds} onChange={setSelectedTagIds} />

      <main className="flex-1 overflow-y-auto px-2 py-2">
        {accounts.length === 0 ? (
          <div className="p-2">
            <EmptyState
              icon="▦"
              text="还没有账号——去设置页添加，或导入 all-api-hub 备份一键迁移"
              action={
                <Button variant="phos" onClick={() => void browser.runtime.openOptionsPage()}>
                  打开设置
                </Button>
              }
            />
          </div>
        ) : (
          sections.map((section, i) => (
            <GroupSection
              key={section.key}
              title={section.group?.name ?? "未分组"}
              count={section.accounts.length}
              balance={section.balance}
              collapsed={section.group ? section.group.collapsed : ungroupedCollapsed}
              onToggle={(next) => {
                if (section.group) {
                  void setGroupCollapsed(section.group.id, next);
                } else {
                  setUngroupedCollapsed(next);
                }
              }}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              {section.accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  results={results ?? {}}
                  today={today}
                  onEdit={(a) => setFormState(toForm(a))}
                />
              ))}
            </GroupSection>
          ))
        )}
      </main>

      <footer className="flex items-center justify-between border-t border-line px-4 py-2">
        <span className="readout text-[10px] uppercase tracking-[0.16em] text-ink-faint">
          APIManager
        </span>
        <span className={cn("text-[11px]", nextDaily ? "text-ink-faint" : "text-ink-faint/60")}>
          {nextDaily
            ? `◔ 下次自动签到 ${new Date(nextDaily).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}`
            : "自动签到未开启"}
        </span>
      </footer>

      {formState && (
        <AccountFormDialog
          initial={formState}
          groups={groups}
          tags={tags}
          onClose={() => setFormState(null)}
        />
      )}

      <ToastHost />
    </div>
  );
}
