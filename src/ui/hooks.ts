import { useEffect, useState } from "react";
import type { WxtStorageItem } from "wxt/utils/storage";

/** 订阅一个 storage item：首次读 + watch 增量更新。fallback 已在 defineItem 声明，返回值加载完成前为 undefined */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- WxtStorageItem 的 metadata 泛型是不变的，any 才能同时接受 {} 与具体 metadata
export function useStorageItem<T>(item: WxtStorageItem<T, any>): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    item.getValue().then((v) => {
      if (mounted) setValue(v);
    });
    const unwatch = item.watch((v) => setValue(v ?? undefined));
    return () => {
      mounted = false;
      unwatch();
    };
  }, [item]);

  return value;
}
