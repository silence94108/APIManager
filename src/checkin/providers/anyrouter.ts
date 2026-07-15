import { siteFetch } from "@/api/transport";
import type { Account, ProviderResult } from "@/types";
import type { CheckinProvider } from "../types";
import { failedFromError, isAlreadyCheckedMessage } from "./shared";

interface SignInResponse {
  code?: number;
  ret?: number;
  success?: boolean;
  message?: string;
}

/**
 * AnyRouter：强制 Cookie 认证（credentials:include 复用浏览器登录态），
 * 无独立状态查询接口——今日是否已签只能靠本地签到记录。
 */
export const anyrouterProvider: CheckinProvider = {
  async checkIn(account: Account): Promise<ProviderResult> {
    try {
      const res = await siteFetch<SignInResponse>(account, "/api/user/sign_in", {
        method: "POST",
        body: "{}",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      const message = res.message ?? "";

      if (message.includes("签到成功") || message.toLowerCase().includes("success")) {
        return { status: "success", message };
      }
      // AnyRouter 特例：已签到时 message 为空
      if (message === "" || isAlreadyCheckedMessage(message)) {
        return { status: "already_checked", message };
      }
      if (res.success === true || res.ret === 1) {
        return { status: "success", message };
      }
      return { status: "failed", message: message || "签到失败（站点未返回原因）" };
    } catch (e) {
      return failedFromError(e);
    }
  },
};
