import { ApiError, siteFetch, type SiteFetchOptions } from "@/api/transport";
import type { Account, ProviderResult } from "@/types";
import type { CheckinExecutionOptions, CheckinObservation } from "./types";
import { checkinFailure, failedFromError, uncertainCheckin } from "./providers/shared";

export const invalidCheckinStatus = (): CheckinObservation => ({
  blocked: checkinFailure("invalid_response", "站点未返回有效签到状态，已停止提交，请到站点核对"),
});

/** 能力失效只采信签到状态接口自身的明确响应，不采信会话刷新或 HTML 错误页。 */
export async function readCheckinStatus<T>(
  account: Account,
  endpoint: string,
  parse: (data: T) => CheckinObservation,
  options: SiteFetchOptions = {},
): Promise<CheckinObservation> {
  try {
    return parse(await siteFetch<T>(account, endpoint, options));
  } catch (error) {
    const blocked = failedFromError(error, "read");
    if (error instanceof ApiError && blocked.reason === "unsupported") {
      if (error.requestUrl === account.url + endpoint) blocked.capability = "unsupported";
      else return { blocked: checkinFailure("invalid_response", "登录检查接口不可用，请登录后重新识别账号") };
    }
    return { blocked };
  }
}

export async function prepareCheckinSubmission(options: CheckinExecutionOptions): Promise<ProviderResult | undefined> {
  try {
    await options.beforeSubmit?.();
  } catch {
    return checkinFailure("storage", "账号状态已变化或提交记录无法保存，已停止签到，请重新检查账号");
  }
}

/** 有状态接口的站点先查后签；不确定的写请求只读复核，不再次提交。 */
export async function executeStatusFirst(
  observe: () => Promise<CheckinObservation>,
  submit: () => Promise<ProviderResult>,
  options: CheckinExecutionOptions = {},
  confirmSuccess = false,
  submitUrl?: string,
): Promise<ProviderResult> {
  const observation = await observe();
  if ("blocked" in observation) {
    if (observation.blocked.status === "already_checked") {
      return { ...observation.blocked, capability: "supported" };
    }
    return options.reconcileOnly ? {
      ...uncertainCheckin(), retryAt: observation.blocked.retryAt,
      capability: observation.blocked.capability,
    } : observation.blocked;
  }
  if (observation.checked) return { status: "already_checked", message: "今天已经签到（已由站点确认）", capability: "supported" };
  if (options.reconcileOnly) return { ...uncertainCheckin(), capability: "supported" };

  const blocked = await prepareCheckinSubmission(options);
  if (blocked) return blocked;

  let result: ProviderResult;
  let mayHaveSubmitted = true;
  try {
    result = await submit();
  } catch (error) {
    // 若失败来自续期/身份接口，签到写请求尚未发送，可以按只读阶段归类。
    const beforeWrite = error instanceof ApiError && error.beforeRequest === true;
    mayHaveSubmitted = !beforeWrite;
    result = failedFromError(error, beforeWrite ? "read" : "submit");
    if (result.reason === "unsupported") {
      if (beforeWrite) result = checkinFailure("authentication", "登录检查接口不可用，请登录后重新识别账号");
      else if (error instanceof ApiError && error.requestUrl === submitUrl) result.capability = "unsupported";
    }
  }
  if (result.reason === "invalid_response" && mayHaveSubmitted) result = uncertainCheckin();
  const needsConfirmation = result.uncertain || (confirmSuccess && result.status === "success");
  if (needsConfirmation) {
    const confirmed = await observe();
    if ("checked" in confirmed && confirmed.checked) {
      return { status: "success", message: "签到结果已由站点确认", capability: "supported" };
    }
    const capability = "blocked" in confirmed ? confirmed.blocked.capability : "supported";
    return { ...uncertainCheckin(), capability,
      retryAt: "blocked" in confirmed ? confirmed.blocked.retryAt : undefined };
  }
  return { ...result, capability: result.capability ?? "supported" };
}
