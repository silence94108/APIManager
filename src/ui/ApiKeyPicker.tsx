import type { Account, ApiKeyEntry } from "@/types";
import { decryptSecret } from "@/vault/vault";
import { Dialog, toast } from "@/ui/components";

/** 解密并复制一条 API 密钥——需 vault 已解锁（配合 useVaultGate 调用） */
export async function copyApiKey(key: ApiKeyEntry): Promise<void> {
  try {
    const plain = await decryptSecret(key.keyEnc);
    await navigator.clipboard.writeText(plain);
    toast(`已复制 API 密钥${key.name ? `「${key.name}」` : ""}`);
  } catch {
    toast("解密失败，密文可能来自其他主密码", "err");
  }
}

/** 多条密钥的选择弹窗——options 卡片与 popup 账号行共用 */
export function ApiKeyPickerDialog({
  account,
  onPick,
  onClose,
}: {
  account: Account;
  onPick: (key: ApiKeyEntry) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title={`复制 API 密钥 · ${account.name}`}>
      <div className="space-y-1.5">
        {(account.apiKeys ?? []).map((k, i) => (
          <button
            key={k.id}
            onClick={() => onPick(k)}
            className="flex w-full items-center justify-between rounded-md border border-line px-3 py-2 text-left text-[13px] text-ink transition hover:border-phos/40 hover:bg-raised"
          >
            <span className="truncate">{k.name || `密钥 ${i + 1}`}</span>
            <span className="shrink-0 text-[11px] text-ink-faint">复制</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
