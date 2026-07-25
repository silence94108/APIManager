import { Monitor } from "lucide-react";
import { uiSettingsItem } from "@/storage/items";
import { ZOOM_OPTIONS } from "@/ui/uiZoom";
import { cn } from "@/ui/components";
import { useStorageItem } from "@/ui/hooks";

export default function GeneralPage() {
  const settings = useStorageItem(uiSettingsItem);
  if (!settings) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="readout mb-1 text-[15px] text-ink">通用</h1>
        <p className="text-[12px] text-ink-faint">界面外观与显示相关的通用设置。</p>
      </div>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="readout mb-1 flex items-center gap-1.5 text-[14px] text-ink">
          <Monitor size={14} /> 界面缩放
        </h2>
        <p className="mb-3 text-[12px] text-ink-faint">
          整体放大文字、图标与间距，弹窗与设置页同时生效，即改即见。
        </p>
        <div className="flex gap-2">
          {ZOOM_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => void uiSettingsItem.setValue({ ...settings, zoom: opt.value })}
              className={cn(
                "readout rounded-md border px-3 py-1.5 text-[13px] transition",
                settings.zoom === opt.value
                  ? "border-phos/50 bg-phos/10 text-phos"
                  : "border-line text-ink-mute hover:border-ink-faint hover:text-ink",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
