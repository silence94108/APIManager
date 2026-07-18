import { useState } from "react";
import { unlockVault } from "@/vault/vault";
import { Button, Dialog, Field, Input } from "@/ui/components";

/** 共用解锁弹窗——popup 与 options 共用；解锁成功后由调用方回调继续原操作 */
export function UnlockDialog({
  open,
  onClose,
  onUnlocked,
}: {
  open: boolean;
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!password || busy) return;
    setBusy(true);
    const ok = await unlockVault(password);
    setBusy(false);
    if (!ok) {
      setError("主密码不正确");
      return;
    }
    setPassword("");
    setError("");
    onClose();
    onUnlocked();
  }

  return (
    <Dialog open={open} onClose={onClose} title="解锁保险库">
      <Field label="主密码" hint="本次浏览器会话内解锁一次即可，关闭浏览器后自动上锁">
        <Input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          autoComplete="off"
        />
        {error && <span className="text-[11px] text-signal">{error}</span>}
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>取消</Button>
        <Button variant="phos" disabled={!password || busy} onClick={() => void submit()}>
          {busy ? "解锁中…" : "解锁"}
        </Button>
      </div>
    </Dialog>
  );
}
