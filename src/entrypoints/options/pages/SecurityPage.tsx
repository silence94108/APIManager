import { useState } from "react";
import { accountsItem, vaultKeyItem, vaultMetaItem } from "@/storage/items";
import {
  changeVaultPassword,
  lockVault,
  resetVault,
  setupVault,
  unlockVault,
} from "@/vault/vault";
import { Badge, Button, ConfirmDialog, Field, Input, toast } from "@/ui/components";
import { useStorageItem } from "@/ui/hooks";

const MIN_LENGTH = 8;

export default function SecurityPage() {
  const meta = useStorageItem(vaultMetaItem);
  const sessionKey = useStorageItem(vaultKeyItem);
  const accounts = useStorageItem(accountsItem);

  if (meta === undefined) return null;
  const passwordCount = (accounts ?? []).filter((a) => a.credential?.kind === "password").length;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="readout mb-1 text-[15px] text-ink">安全</h1>
        <p className="text-[12px] text-ink-faint">
          账号密码以主密码派生密钥（PBKDF2 + AES-GCM）加密后存本地；主密码与密钥不落盘，浏览器关闭后自动上锁。
        </p>
      </div>

      {meta === null ? (
        <SetupCard />
      ) : (
        <>
          <StatusCard unlocked={!!sessionKey} />
          <ChangePasswordCard />
          <ResetCard passwordCount={passwordCount} />
        </>
      )}
    </div>
  );
}

function SetupCard() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (password.length < MIN_LENGTH) {
      setError(`至少 ${MIN_LENGTH} 位`);
      return;
    }
    if (password !== confirm) {
      setError("两次输入不一致");
      return;
    }
    setBusy(true);
    try {
      await setupVault(password);
      toast("主密码已设置，保险库已解锁");
    } catch (e) {
      toast(e instanceof Error ? e.message : "设置失败", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="readout mb-1 text-[14px] text-ink">设置主密码</h2>
      <p className="mb-3 text-[12px] text-ink-faint">
        设置后才能为账号保存登录密码。主密码没有找回途径——忘记只能重置保险库并丢弃所有已存密码，请牢记。
      </p>
      <div className="grid max-w-md grid-cols-1 gap-3">
        <Field label="主密码">
          <Input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
            placeholder={`至少 ${MIN_LENGTH} 位`}
            autoComplete="new-password"
          />
        </Field>
        <Field label="确认主密码">
          <Input
            type="password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            autoComplete="new-password"
          />
          {error && <span className="text-[11px] text-signal">{error}</span>}
        </Field>
        <div>
          <Button variant="phos" disabled={busy || !password || !confirm} onClick={() => void submit()}>
            设置主密码
          </Button>
        </div>
      </div>
    </section>
  );
}

function StatusCard({ unlocked }: { unlocked: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function unlock() {
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
    toast("保险库已解锁");
  }

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="readout text-[14px] text-ink">保险库状态</h2>
        <Badge tone={unlocked ? "phos" : "mute"}>{unlocked ? "已解锁" : "已锁定"}</Badge>
      </div>
      {unlocked ? (
        <Button
          onClick={async () => {
            await lockVault();
            toast("保险库已锁定");
          }}
        >
          立即锁定
        </Button>
      ) : (
        <div className="flex max-w-md items-start gap-2">
          <div className="flex-1">
            <Input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && void unlock()}
              placeholder="输入主密码解锁"
              autoComplete="off"
            />
            {error && <span className="mt-1 block text-[11px] text-signal">{error}</span>}
          </div>
          <Button variant="phos" disabled={!password || busy} onClick={() => void unlock()}>
            {busy ? "解锁中…" : "解锁"}
          </Button>
        </div>
      )}
    </section>
  );
}

function ChangePasswordCard() {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (newPw.length < MIN_LENGTH) {
      setError(`新密码至少 ${MIN_LENGTH} 位`);
      return;
    }
    if (newPw !== confirm) {
      setError("两次输入不一致");
      return;
    }
    setBusy(true);
    const ok = await changeVaultPassword(oldPw, newPw);
    setBusy(false);
    if (!ok) {
      setError("当前主密码不正确");
      return;
    }
    setOldPw("");
    setNewPw("");
    setConfirm("");
    setError("");
    toast("主密码已修改，所有已存密码已重新加密");
  }

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="readout mb-3 text-[14px] text-ink">修改主密码</h2>
      <div className="grid max-w-md grid-cols-1 gap-3">
        <Field label="当前主密码">
          <Input
            type="password"
            value={oldPw}
            onChange={(e) => {
              setOldPw(e.target.value);
              setError("");
            }}
            autoComplete="off"
          />
        </Field>
        <Field label="新主密码">
          <Input
            type="password"
            value={newPw}
            onChange={(e) => {
              setNewPw(e.target.value);
              setError("");
            }}
            placeholder={`至少 ${MIN_LENGTH} 位`}
            autoComplete="new-password"
          />
        </Field>
        <Field label="确认新主密码">
          <Input
            type="password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            autoComplete="new-password"
          />
          {error && <span className="text-[11px] text-signal">{error}</span>}
        </Field>
        <div>
          <Button
            variant="phos"
            disabled={busy || !oldPw || !newPw || !confirm}
            onClick={() => void submit()}
          >
            {busy ? "重新加密中…" : "修改主密码"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function ResetCard({ passwordCount }: { passwordCount: number }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="rounded-lg border border-signal/30 bg-panel p-4">
      <h2 className="readout mb-1 text-[14px] text-signal">重置保险库</h2>
      <p className="mb-3 text-[12px] text-ink-faint">
        忘记主密码时的兜底：清除主密码并删除所有已保存的账号密码（OAuth 记录与 Token 不受影响）。
      </p>
      <Button variant="danger" onClick={() => setConfirming(true)}>
        重置保险库
      </Button>

      <ConfirmDialog
        open={confirming}
        title="重置保险库"
        message={
          <>
            将清除主密码并删除{" "}
            <span className="text-signal">{passwordCount}</span> 个账号的已存密码，该操作不可恢复。确定重置？
          </>
        }
        confirmText="重置"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          const stripped = await resetVault();
          setConfirming(false);
          toast(`保险库已重置，删除了 ${stripped} 个已存密码`);
        }}
      />
    </section>
  );
}
