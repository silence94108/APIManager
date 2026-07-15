import { useRef, useState } from "react";
import {
  executeAllApiHubImport,
  parseAllApiHubBackup,
  type ImportPreview,
} from "@/importExport/fromAllApiHub";
import { exportOwnBackup, importOwnBackup } from "@/importExport/ownBackup";
import { SITE_TYPE_LABELS } from "@/types";
import { localDayString } from "@/utils/day";
import { Badge, Button, toast } from "@/ui/components";

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}

export default function ImportExportPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <AllApiHubImportCard />
      <OwnBackupCard />
    </div>
  );
}

function AllApiHubImportCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  async function pick(file: File) {
    try {
      setPreview(parseAllApiHubBackup(await readJsonFile(file)));
    } catch (e) {
      toast(e instanceof Error ? e.message : "文件解析失败", "err");
    }
  }

  async function run() {
    if (!preview) return;
    setBusy(true);
    try {
      const report = await executeAllApiHubImport(preview, { overwriteExisting: overwrite });
      toast(
        `导入完成：${report.imported} 个账号、${report.tagsImported} 个标签` +
          (report.skippedExisting ? `，跳过已存在 ${report.skippedExisting} 个` : ""),
      );
      setPreview(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "导入失败", "err");
    } finally {
      setBusy(false);
    }
  }

  const typeSummary = preview
    ? Object.entries(
        preview.importable.reduce<Record<string, number>>((acc, a) => {
          acc[a.siteType] = (acc[a.siteType] ?? 0) + 1;
          return acc;
        }, {}),
      )
        .map(([t, n]) => `${SITE_TYPE_LABELS[t as keyof typeof SITE_TYPE_LABELS]}×${n}`)
        .join("、")
    : "";

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="readout mb-1 text-[14px] text-ink">从 all-api-hub 迁移</h2>
      <p className="mb-3 text-[12px] text-ink-faint">
        在 all-api-hub 的「导入导出」页导出备份 JSON，然后在这里导入。账号、Token、标签会一并迁移；分组需导入后自行归类。
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = "";
        }}
      />
      <Button variant="phos" onClick={() => fileRef.current?.click()}>
        选择备份文件…
      </Button>

      {preview && (
        <div className="mt-4 space-y-3 rounded-md border border-line p-3">
          <p className="text-[13px]">
            将导入 <span className="readout text-phos">{preview.importable.length}</span> 个账号
            {typeSummary && <span className="text-ink-faint">（{typeSummary}）</span>}、
            <span className="readout text-phos">{preview.tags.length}</span> 个标签
          </p>

          {preview.skipped.length > 0 && (
            <div className="max-h-36 space-y-1 overflow-y-auto rounded border border-amber/30 bg-amber/5 p-2">
              <p className="text-[12px] text-amber">跳过 {preview.skipped.length} 个：</p>
              {preview.skipped.map((s, i) => (
                <p key={i} className="truncate text-[11px] text-ink-faint">
                  {s.name} — {s.reason}
                </p>
              ))}
            </div>
          )}

          <label className="flex items-center gap-2 text-[12px] text-ink-mute">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="accent-[#c8f542]"
            />
            覆盖已存在的账号（按 站点 URL + 用户 ID 判重）
          </label>

          <div className="flex justify-end gap-2">
            <Button onClick={() => setPreview(null)}>取消</Button>
            <Button variant="phos" disabled={busy || preview.importable.length === 0} onClick={run}>
              执行导入
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function OwnBackupCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<"replace" | "merge">("merge");

  async function doImport(file: File) {
    try {
      const report = await importOwnBackup(await readJsonFile(file), modeRef.current);
      toast(
        `${modeRef.current === "replace" ? "覆盖" : "合并"}导入完成：账号 ${report.accounts} · 分组 ${report.groups} · 标签 ${report.tags}`,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "导入失败", "err");
    }
  }

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="readout mb-1 text-[14px] text-ink">APIManager 自身备份</h2>
      <p className="mb-3 text-[12px] text-ink-faint">
        备份包含账号（含 Token）、分组、标签与签到设置——文件含敏感信息，请妥善保管。
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void doImport(f);
          e.target.value = "";
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="phos"
          onClick={async () => {
            downloadJson(await exportOwnBackup(), `api-manager-backup-${localDayString()}.json`);
          }}
        >
          导出备份
        </Button>
        <Button
          onClick={() => {
            modeRef.current = "merge";
            fileRef.current?.click();
          }}
        >
          合并导入
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            modeRef.current = "replace";
            fileRef.current?.click();
          }}
        >
          覆盖导入
        </Button>
        <Badge tone="mute">合并 = 按 id 去重，新数据胜；覆盖 = 现有数据全部替换</Badge>
      </div>
    </section>
  );
}
