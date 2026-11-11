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

// Records every request and answers from a path → body table.
function router(routes: Record<string, unknown>, calls: string[] = [], textBody?: string): FetchFn {
  return (async (url: string) => {
    calls.push(url);
    const path = url.replace(/^https:\/\/g\/api\/v4/, "").split("?")[0];
    if (textBody !== undefined) { return new Response(textBody, { status: 200 }); }
    if (!(path in routes)) { return new Response(JSON.stringify({ message: "404 Not Found" }), { status: 404, statusText: "Not Found" }); }
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  }) as unknown as FetchFn;
}

const mr = {
  iid: 7, project_id: 1, title: "Add thing", state: "opened", draft: true, author: { username: "sam" },
  source_branch: "feat", target_branch: "main", updated_at: "2026-11-10T09:00:00Z",
  web_url: "https://g/grp/app/-/merge_requests/7", references: { full: "grp/app!7" },
};

test("projectFromRemote handles https, scp-style and ssh:// remotes", async () => {
  const { projectFromRemote } = await import("../src/clients/gitlab.ts");
  assert.equal(projectFromRemote("https://gitlab.com/grp/sub/app.git", "https://gitlab.com"), "grp/sub/app");
  assert.equal(projectFromRemote("git@gitlab.company.com:grp/app.git", "https://gitlab.company.com/"), "grp/app");
  assert.equal(projectFromRemote("ssh://git@gitlab.company.com:2222/grp/app.git", "https://gitlab.company.com"), "grp/app");
  assert.equal(projectFromRemote("https://host/gitlab/grp/app.git", "https://host/gitlab"), "grp/app");
  assert.equal(projectFromRemote("git@github.com:grp/app.git", "https://gitlab.com"), undefined);
  assert.equal(projectFromRemote("https://gitlab.com/justone", "https://gitlab.com"), undefined);
});

test("listMergeRequests: project path is URL-encoded, no scope by default", async () => {
  const calls: string[] = [];
  const gl = new GitLabClient(() => "https://g", async () => "t", router({ "/projects/grp%2Fapp/merge_requests": [mr] }, calls));
  const rows = await gl.listMergeRequests({ project: "grp/app" });
  assert.equal(rows[0].project, "grp/app");
  assert.equal(rows[0].draft, true);
  const q = new URL(calls[0]).searchParams;
  assert.equal(q.get("state"), "opened");
  assert.equal(q.get("scope"), null);
});

test("listMergeRequests: global defaults to assigned_to_me; reviews_for_me uses reviewer_username", async () => {
  const calls: string[] = [];
  const gl = new GitLabClient(() => "https://g", async () => "t",
    router({ "/merge_requests": [mr], "/user": { username: "sam", name: "Sam", web_url: "" } }, calls));
  await gl.listMergeRequests();
  assert.equal(new URL(calls[0]).searchParams.get("scope"), "assigned_to_me");
  await gl.listMergeRequests({ scope: "reviews_for_me" });
  const q = new URL(calls.at(-1)!).searchParams;
  assert.equal(q.get("scope"), "all");
  assert.equal(q.get("reviewer_username"), "sam");
});

test("getMergeRequest combines details, pipeline and truncated diffs", async () => {
  const gl = new GitLabClient(() => "https://g", async () => "t", router({
    "/projects/grp%2Fapp/merge_requests/7": { ...mr, description: "why", reviewers: [{ username: "kim" }], assignees: [],
      detailed_merge_status: "ci_must_pass", has_conflicts: false, head_pipeline: { id: 99, status: "failed", web_url: "u" } },
    "/projects/grp%2Fapp/merge_requests/7/changes": { changes: [
      { new_path: "a.ts", old_path: "a.ts", new_file: true, diff: "+".repeat(50) },
      { new_path: "b.ts", old_path: "old.ts", renamed_file: true, diff: "-".repeat(50) },
    ] },
  }));
  const m = await gl.getMergeRequest("grp/app", 7, { includeDiffs: true, maxDiffChars: 60 });
  assert.deepEqual(m.pipeline, { id: 99, status: "failed", url: "u" });
  assert.deepEqual(m.reviewers, ["kim"]);
  assert.equal(m.changes[0].diff, "+".repeat(50));
  assert.match(m.changes[1].diff!, /^-{10}\n…\(truncated\)$/);
  assert.equal(m.changes[1].renamedFrom, "old.ts");
  assert.equal(m.changesTruncated, true);
});

test("job log tail strips ANSI codes and section markers", async () => {
  const log = "section_start:1700000000:step_script\r\x1b[0K\x1b[32;1mRunning\x1b[0;m\nline2\nnpm ERR! boom\nsection_end:1700000001:step_script\r\x1b[0K";
  const gl = new GitLabClient(() => "https://g", async () => "t", router({}, [], log));
  const tail = await gl.getJobLogTail("grp/app", 5, 2);
  assert.equal(tail, "…(1 earlier lines omitted)\nline2\nnpm ERR! boom");
  assert.doesNotMatch(await gl.getJobLogTail("grp/app", 5, 100), /section_|\x1b/);
});

test("404 mentions the project path", async () => {
  const gl = new GitLabClient(() => "https://g", async () => "t", router({}));
  await assert.rejects(gl.listPipelines("nope/nope"), /404.*project path/);
});
