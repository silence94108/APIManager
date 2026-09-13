import { siteFetch } from "@/api/transport";
import type { Account, ProviderResult } from "@/types";
import type { CheckinProvider } from "../types";
import { resolveCheckinPageUrl } from "../helpers";
import { prepareCheckinSubmission } from "../execution";
import { failedFromError, resultFromSuccessMessage, uncertainCheckin } from "./shared";

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
  async checkIn(account: Account, options = {}): Promise<ProviderResult> {
    if (options.reconcileOnly) return uncertainCheckin("该站点没有独立的签到状态接口，请到站点核对，今日不再自动提交");
    const blocked = await prepareCheckinSubmission(options);
    if (blocked) return blocked;
    try {
      const res = await siteFetch<SignInResponse>(account, "/api/user/sign_in", {
        method: "POST",
        body: "{}",
        headers: { "X-Requested-With": "XMLHttpRequest" },
        pageUrl: resolveCheckinPageUrl(account),
        freshPage: true,
      });
      const message = typeof res?.message === "string" ? res.message : "";

      if (res?.success === false) {
        const result = resultFromSuccessMessage(false, message);
        return result.status === "already_checked" ? result : { ...result, uncertain: true, retryable: false };
      }
      if (message.includes("签到成功") || /\bsuccess(?:ful|fully)?\b/i.test(message)) {
        return { status: "success", message, capability: "supported" };
      }
      // AnyRouter 特例：已签到时 message 为空
      if (res?.message === "") {
        return { status: "already_checked", message, capability: "supported" };
      }
      const result = resultFromSuccessMessage(res?.success === true || res?.ret === 1 ? true : undefined, message);
      return result.reason === "invalid_response" ? uncertainCheckin() : result;
    } catch (e) {
      // 页面加载本身可能已自动签到；即使确认接口被限流，也不能再开页重做。
      const result = failedFromError(e);
      return { ...uncertainCheckin(), retryAt: result.retryAt };
    }
  },
};
