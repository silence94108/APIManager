import { describe, expect, it } from "vitest";
import {
  isVerificationRequiredMessage,
  resultFromSuccessMessage,
} from "../providers/shared";

describe("resultFromSuccessMessage 分类", () => {
  it("success 为真 → success", () => {
    expect(resultFromSuccessMessage(true, "签到成功").status).toBe("success");
  });

  it("已签到文案 → already_checked", () => {
    expect(resultFromSuccessMessage(false, "今天已经签到").status).toBe("already_checked");
    expect(resultFromSuccessMessage(false, "You have already checked in").status).toBe(
      "already_checked",
    );
  });

  it("人机验证 token 缺失 → needs_verification（不计失败、不重试）", () => {
    expect(resultFromSuccessMessage(false, "Turnstile token 为空").status).toBe(
      "needs_verification",
    );
    expect(resultFromSuccessMessage(false, "请完成人机验证").status).toBe("needs_verification");
    expect(resultFromSuccessMessage(false, "captcha verification failed").status).toBe(
      "needs_verification",
    );
  });

  it("其他失败文案 → failed", () => {
    expect(resultFromSuccessMessage(false, "余额不足").status).toBe("failed");
    expect(resultFromSuccessMessage(false, "").message).toBe("签到失败（站点未返回原因）");
  });
});

describe("isVerificationRequiredMessage", () => {
  it("大小写不敏感命中验证类关键词", () => {
    expect(isVerificationRequiredMessage("TURNSTILE token 为空")).toBe(true);
    expect(isVerificationRequiredMessage("验证码错误")).toBe(true);
    expect(isVerificationRequiredMessage("网络超时")).toBe(false);
  });
});
