import { describe, expect, it } from "vitest";
import type { DetectedAccount } from "@/detect/types";
import type { Account } from "@/types";
import { fromDetected, mergeDetectedIntoAccount, toForm } from "../AccountFormDialog";

const sessionAuth = { sessionId: "browser-session", accessExpiresAt: 2000000000 };
const detected: DetectedAccount = {
  url: "https://api.example.com",
  siteType: "new-api",
  userId: "12",
  username: "current-user",
  accessToken: "session-token",
  sessionAuth,
};
const existing: Account = {
  id: "account",
  name: "自定义站名",
  url: detected.url,
  siteType: "new-api",
  authType: "token",
  userId: "12",
  accessToken: "old-token",
  sessionAuth,
  groupId: "group",
  tagIds: ["tag"],
  disabled: false,
  checkinEnabled: true,
  createdAt: 1,
  updatedAt: 1,
};

describe("账号表单的会话信息", () => {
  it("识别新增与编辑已有账号时保留续期信息", () => {
    expect(fromDetected(detected)).toMatchObject({ accessToken: "session-token", sessionAuth });
    expect(toForm(existing)).toMatchObject({ accessToken: "old-token", sessionAuth });
  });

  it("重新识别时更新会话，同时保留自定义分组与名称", () => {
    const nextSession = { sessionId: "next-session", accessExpiresAt: 2000000900 };
    expect(mergeDetectedIntoAccount(existing, { ...detected, sessionAuth: nextSession })).toMatchObject({
      id: "account",
      name: "自定义站名",
      groupId: "group",
      tagIds: ["tag"],
      accessToken: "session-token",
      sessionAuth: nextSession,
    });
  });

  it("重新识别为旧版长期 Token 时清除原会话关联", () => {
    expect(mergeDetectedIntoAccount(existing, { ...detected, sessionAuth: undefined })).toMatchObject({
      accessToken: "session-token",
      sessionAuth: undefined,
    });
  });

  it("未取得新 Token 时保留已有 Token 及配套会话", () => {
    expect(mergeDetectedIntoAccount(existing, { ...detected, accessToken: undefined, sessionAuth: undefined })).toMatchObject({
      accessToken: "old-token",
      sessionAuth,
    });
  });

  it.each([{ userId: "99" }, { url: "https://other.example.com" }])("另一账号的识别结果不能覆盖已有凭据：%j", (patch) => {
    expect(mergeDetectedIntoAccount(existing, { ...detected, ...patch })).toEqual(toForm(existing));
  });
});
