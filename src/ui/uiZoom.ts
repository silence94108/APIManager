import { uiSettingsItem } from "@/storage/items";

/** 界面缩放档位（CSS zoom 倍率） */
export const ZOOM_OPTIONS = [
  { value: 1, label: "100%" },
  { value: 1.1, label: "110%" },
  { value: 1.25, label: "125%" },
  { value: 1.4, label: "140%" },
] as const;

/** 应用并跟随界面缩放：popup / options 的 main.tsx 各调一次。
 *  zoom 挂 <html> 上整体生效；--ui-zoom 供需要"物理尺寸不变"的地方
 *  反除（如 popup 的 max-h，避免放大后超出浏览器 600px 弹窗上限）。 */
export function initUiZoom() {
  const apply = (zoom: number) => {
    const root = document.documentElement;
    root.style.setProperty("zoom", String(zoom));
    root.style.setProperty("--ui-zoom", String(zoom));
  };
  void uiSettingsItem.getValue().then((s) => apply(s.zoom));
  uiSettingsItem.watch((s) => apply(s?.zoom ?? 1));
}
