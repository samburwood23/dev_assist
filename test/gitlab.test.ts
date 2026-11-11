import { test } from "node:test";
import assert from "node:assert/strict";
import { GitLabClient } from "../src/clients/gitlab.ts";
import type { FetchFn } from "../src/clients/jira.ts";

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): FetchFn {
  return (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify(body), { status, statusText: "X" });
  }) as unknown as FetchFn;
}

test("currentUser hits /api/v4/user with PRIVATE-TOKEN", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const gl = new GitLabClient(() => "https://gitlab.example.com/", async () => "glpat-x",
    fakeFetch(200, { username: "sam", name: "Sam", web_url: "https://gitlab.example.com/sam" }, seen));
  const u = await gl.currentUser();
  assert.deepEqual(u, { username: "sam", name: "Sam", webUrl: "https://gitlab.example.com/sam" });
  assert.equal(seen.url, "https://gitlab.example.com/api/v4/user");
  assert.equal((seen.init!.headers as Record<string, string>)["PRIVATE-TOKEN"], "glpat-x");
});

test("blank base URL defaults to gitlab.com", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const gl = new GitLabClient(() => "  ", async () => "t", fakeFetch(200, { username: "a", name: "A", web_url: "" }, seen));
  await gl.currentUser();
  assert.equal(seen.url, "https://gitlab.com/api/v4/user");
});

test("401 includes GitLab's message and a scope hint", async () => {
  const gl = new GitLabClient(() => "https://g", async () => "t", fakeFetch(401, { message: "401 Unauthorized" }));
  await assert.rejects(gl.currentUser(), /401.*Unauthorized.*read_api/);
});

test("missing token points at the sidebar", async () => {
  const gl = new GitLabClient(() => "https://g", async () => undefined, fakeFetch(200, {}));
  await assert.rejects(gl.currentUser(), /DevAssist sidebar/);
});
