import { useEffect, useRef, useState } from "react";
import type { WxtStorageItem } from "wxt/utils/storage";
import { isVaultUnlocked } from "@/vault/vault";

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

/** 页面级"解锁后执行"门控：gate(action) 已解锁直接跑，锁着先弹 UnlockDialog、解锁成功续跑。
 *  用法：const { gate, unlockDialogProps } = useVaultGate(); … <UnlockDialog {...unlockDialogProps} /> */
export function useVaultGate() {
  const [showUnlock, setShowUnlock] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);

  function gate(action: () => void) {
    void isVaultUnlocked().then((unlocked) => {
      if (unlocked) {
        action();
      } else {
        pendingRef.current = action;
        setShowUnlock(true);
      }
    });
  }

  return {
    gate,
    unlockDialogProps: {
      open: showUnlock,
      onClose: () => setShowUnlock(false),
      onUnlocked: () => {
        const fn = pendingRef.current;
        pendingRef.current = null;
        fn?.();
      },
    },
  };
}
