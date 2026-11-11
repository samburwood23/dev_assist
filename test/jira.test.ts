import { test } from "node:test";
import assert from "node:assert/strict";
import { JiraClient, type FetchFn } from "../src/clients/jira.ts";

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): FetchFn {
  return (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(status === 204 ? null : JSON.stringify(body), { status, statusText: "X" });
  }) as unknown as FetchFn;
}

test("getIssue maps fields and builds browse URL", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const jira = new JiraClient(() => "https://jira.example.com/", async () => ({ type: "bearer", token: "t" }),
    fakeFetch(200, { key: "PROJ-1", fields: { summary: "S", status: { name: "Open" }, assignee: null, description: null } }, seen));
  const i = await jira.getIssue("PROJ-1");
  assert.equal(i.url, "https://jira.example.com/browse/PROJ-1");
  assert.equal(i.status, "Open");
  assert.equal(i.assignee, undefined);
  assert.match(seen.url!, /\/rest\/api\/2\/issue\/PROJ-1\?/);
  assert.equal((seen.init!.headers as Record<string, string>).Authorization, "Bearer t");
});

test("basic auth for Jira Cloud", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const jira = new JiraClient(() => "https://x.atlassian.net", async () => ({ type: "basic", token: "tok", email: "a@b.c" }),
    fakeFetch(200, { issues: [] }, seen));
  assert.deepEqual(await jira.search("project = X"), []);
  const auth = (seen.init!.headers as Record<string, string>).Authorization;
  assert.equal(auth, `Basic ${Buffer.from("a@b.c:tok").toString("base64")}`);
});

test("HTTP errors include Jira's message", async () => {
  const jira = new JiraClient(() => "https://j", async () => ({ type: "bearer", token: "t" }),
    fakeFetch(400, { errorMessages: ["Bad JQL"] }));
  await assert.rejects(jira.search("nonsense"), /400.*Bad JQL/);
});

test("not configured gives a hint", async () => {
  const jira = new JiraClient(() => "", async () => undefined, fakeFetch(200, {}));
  await assert.rejects(jira.getIssue("A-1"), /Set Jira Token/);
});

test("204 resolves", async () => {
  const jira = new JiraClient(() => "https://j", async () => ({ type: "bearer", token: "t" }), fakeFetch(204, null));
  await jira.addComment("A-1", "hi");
});
