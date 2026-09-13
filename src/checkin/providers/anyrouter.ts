import { siteFetch } from "@/api/transport";
import type { Account, ProviderResult } from "@/types";
import type { CheckinProvider } from "../types";
import { resolveCheckinPageUrl } from "../helpers";
import { failedFromError, resultFromSuccessMessage } from "./shared";

interface SignInResponse {
  code?: number;
  ret?: number;
  success?: boolean;
  message?: string;
}

/**
 * AnyRouter：强制 Cookie 认证（credentials:include 复用浏览器登录态），
 * 旧版会在加载控制台时自动签到；打开独立页面触发，再以 sign_in 响应确认结果。
 */
export const anyrouterProvider: CheckinProvider = {
  async checkIn(account: Account): Promise<ProviderResult> {
    try {
      const res = await siteFetch<SignInResponse>(account, "/api/user/sign_in", {
        method: "POST",
        body: "{}",
        headers: { "X-Requested-With": "XMLHttpRequest" },
        pageUrl: resolveCheckinPageUrl(account),
        freshPage: true,
      });
      const message = res.message ?? "";

      if (res.success === false) return resultFromSuccessMessage(false, message);
      if (message.includes("签到成功") || /\bsuccess(?:ful|fully)?\b/i.test(message)) {
        return { status: "success", message };
      }
      // AnyRouter 特例：已签到时 message 为空
      if (res.message === "") {
        return { status: "already_checked", message };
      }
      return resultFromSuccessMessage(res.success === true || res.ret === 1, message);
    } catch (e) {
      return failedFromError(e);
    }
  },
};
