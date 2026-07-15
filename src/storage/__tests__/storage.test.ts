import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import type { AccountDraft } from "../accounts";
import { accountsItem, groupsItem, tagsItem } from "../items";
import { deleteAccount, patchAccount, saveAccount } from "../accounts";
import {
  deleteGroup,
  deleteTag,
  findOrCreateTagByName,
  saveGroup,
  saveTag,
} from "../groupsTags";

function draft(partial: Partial<AccountDraft> = {}): AccountDraft {
  return {
    name: "测试站",
    url: "https://api.example.com",
    siteType: "new-api",
    authType: "token",
    userId: "1",
    accessToken: "tok",
    groupId: null,
    tagIds: [],
    disabled: false,
    checkinEnabled: true,
    ...partial,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("accounts CRUD", () => {
  it("新建后可列出，patch 更新 updatedAt，删除后消失", async () => {
    const created = await saveAccount(draft());
    expect((await accountsItem.getValue()).map((a) => a.id)).toEqual([created.id]);

    const patched = await patchAccount(created.id, { name: "改名" });
    expect(patched?.name).toBe("改名");
    expect(patched!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

    await deleteAccount(created.id);
    expect(await accountsItem.getValue()).toEqual([]);
  });

  it("saveAccount 带已存在 id 时是更新而非新建", async () => {
    const created = await saveAccount(draft());
    await saveAccount({ ...draft({ name: "更新版" }), id: created.id });
    const all = await accountsItem.getValue();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("更新版");
    expect(all[0].createdAt).toBe(created.createdAt);
  });
});

describe("分组级联", () => {
  it("删除分组后组内账号 groupId 置 null，账号保留", async () => {
    const group = await saveGroup({ name: "常用站" });
    const acc = await saveAccount(draft({ groupId: group.id }));

    await deleteGroup(group.id);

    expect(await groupsItem.getValue()).toEqual([]);
    const after = (await accountsItem.getValue()).find((a) => a.id === acc.id);
    expect(after).toBeDefined();
    expect(after!.groupId).toBeNull();
  });
});

describe("标签级联", () => {
  it("删除标签后账号 tagIds 引用被清理", async () => {
    const tagA = await saveTag({ name: "主力" });
    const tagB = await saveTag({ name: "囤货" });
    const acc = await saveAccount(draft({ tagIds: [tagA.id, tagB.id] }));

    await deleteTag(tagA.id);

    expect((await tagsItem.getValue()).map((t) => t.name)).toEqual(["囤货"]);
    const after = (await accountsItem.getValue()).find((a) => a.id === acc.id);
    expect(after!.tagIds).toEqual([tagB.id]);
  });

  it("findOrCreateTagByName 同名不重复建", async () => {
    const first = await findOrCreateTagByName("免费");
    const second = await findOrCreateTagByName("免费");
    expect(second.id).toBe(first.id);
    expect(await tagsItem.getValue()).toHaveLength(1);
  });
});
