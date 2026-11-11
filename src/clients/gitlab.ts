// Plain REST client with no VS Code types, so it can be unit-tested with node:test.

import type { FetchFn } from "./jira";

export interface GitLabUser { username: string; name: string; webUrl: string }

export interface MergeRequestRow {
  project: string; iid: number; title: string; state: string; draft: boolean;
  author: string; sourceBranch: string; targetBranch: string; updatedAt: string; url: string;
}

export interface MergeRequest extends MergeRequestRow {
  description: string;
  assignees: string[];
  reviewers: string[];
  mergeStatus: string;
  hasConflicts: boolean;
  pipeline?: { id: number; status: string; url: string };
  changes: { path: string; newFile: boolean; deletedFile: boolean; renamedFrom?: string; diff?: string }[];
  changesTruncated: boolean;
}

export interface PipelineRow { id: number; status: string; ref: string; sha: string; source: string; createdAt: string; url: string }
export interface JobRow { id: number; name: string; stage: string; status: string; failureReason?: string; allowFailure: boolean; url: string }
export interface IssueRow { project: string; iid: number; title: string; state: string; labels: string[]; assignees: string[]; url: string }
export interface ProjectRow { id: number; path: string; description: string; defaultBranch: string; url: string }

export type MrState = "opened" | "closed" | "merged" | "all";
export type MrScope = "assigned_to_me" | "created_by_me" | "reviews_for_me" | "all";

/**
 * Extract "group/subgroup/project" from a git remote URL if it points at the configured GitLab host.
 * Handles https://host/group/proj(.git), git@host:group/proj.git and ssh://git@host[:port]/group/proj.git.
 */
export function projectFromRemote(remoteUrl: string, baseUrl: string): string | undefined {
  let host: string;
  try { host = new URL(baseUrl.trim() || "https://gitlab.com").hostname.toLowerCase(); } catch { return undefined; }
  const url = remoteUrl.trim();
  let remoteHost: string | undefined;
  let path: string | undefined;
  const scp = /^[^@/\s]+@([^:/\s]+):(?!\/)(.+)$/.exec(url); // git@host:group/proj.git
  if (scp) {
    [, remoteHost, path] = scp;
  } else {
    try {
      const u = new URL(url);
      remoteHost = u.hostname;
      path = u.pathname;
    } catch { return undefined; }
  }
  if (remoteHost.toLowerCase() !== host) { return undefined; }
  // Strip the base URL's own path for GitLab installed under a sub-path (https://host/gitlab).
  const basePath = new URL(baseUrl.trim() || "https://gitlab.com").pathname.replace(/\/+$/, "");
  path = path.replace(/^\/+/, "");
  if (basePath && path.startsWith(basePath.replace(/^\/+/, "") + "/")) { path = path.slice(basePath.length); }
  const project = path.replace(/^\/+/, "").replace(/\.git\/?$/, "").replace(/\/+$/, "");
  return project.includes("/") ? project : undefined;
}

export class GitLabClient {
  constructor(
    private readonly baseUrl: () => string,
    private readonly token: () => PromiseLike<string | undefined>,
    private readonly fetchFn: FetchFn = (...args) => fetch(...args),
  ) {}

  root(): string {
    return (this.baseUrl().trim() || "https://gitlab.com").replace(/\/+$/, "");
  }

  private async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.token();
    if (!token) {
      throw new Error("GitLab is not configured. Add a token in the DevAssist sidebar or run 'DevAssist: Set GitLab Token'.");
    }
    const res = await this.fetchFn(`${this.root()}/api/v4${path}`, {
      ...init,
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { message?: unknown; error?: string; error_description?: string };
        const msg = body.message ?? body.error_description ?? body.error;
        detail = typeof msg === "string" ? msg : msg ? JSON.stringify(msg) : "";
      } catch { /* non-JSON error body */ }
      const hint = res.status === 401 || res.status === 403
        ? " Check the token and that it has the read_api (or api) scope."
        : res.status === 404 ? " Check the project path (group/project) or ID; the token may also lack access." : "";
      throw new Error(`GitLab returned ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}.${hint}`);
    }
    return res;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.raw(path, init);
    if (res.status === 204) { return undefined as T; }
    return (await res.json()) as T;
  }

  private static project(p: string | number): string {
    return encodeURIComponent(String(p).trim().replace(/^\/+|\/+$/g, ""));
  }

  private static qs(params: Record<string, string | number | boolean | undefined>): string {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) { if (v !== undefined && v !== "") { q.set(k, String(v)); } }
    return q.toString();
  }

  private static mrRow(m: any): MergeRequestRow {
    return {
      project: m.references?.full?.split("!")[0] ?? String(m.project_id),
      iid: m.iid,
      title: m.title,
      state: m.state,
      draft: !!(m.draft ?? m.work_in_progress),
      author: m.author?.username,
      sourceBranch: m.source_branch,
      targetBranch: m.target_branch,
      updatedAt: m.updated_at,
      url: m.web_url,
    };
  }

  /** Who the token belongs to; used to verify a newly entered token. */
  async currentUser(): Promise<GitLabUser> {
    const r = await this.request<any>("/user");
    return { username: r.username, name: r.name, webUrl: r.web_url };
  }

  /** MRs in one project, or across every project the user can see when `project` is omitted. */
  async listMergeRequests(opts: {
    project?: string; state?: MrState; scope?: MrScope; search?: string; targetBranch?: string; limit?: number;
  } = {}): Promise<MergeRequestRow[]> {
    // "reviews_for_me" isn't a GitLab scope: it's reviewer_username, which needs our username.
    const reviewer = opts.scope === "reviews_for_me" ? (await this.currentUser()).username : undefined;
    const scope = reviewer || opts.scope === "all"
      ? (opts.project ? undefined : "all")
      : opts.scope ?? (opts.project ? undefined : "assigned_to_me"); // GitLab's global default is created_by_me
    const q = GitLabClient.qs({
      state: opts.state ?? "opened",
      scope,
      reviewer_username: reviewer,
      search: opts.search,
      target_branch: opts.targetBranch,
      order_by: "updated_at",
      per_page: Math.min(opts.limit ?? 20, 50),
    });
    const path = opts.project
      ? `/projects/${GitLabClient.project(opts.project)}/merge_requests?${q}`
      : `/merge_requests?${q}`;
    return (await this.request<any[]>(path)).map(GitLabClient.mrRow);
  }

  async getMergeRequest(project: string, iid: number, opts: { includeDiffs?: boolean; maxDiffChars?: number } = {}): Promise<MergeRequest> {
    const base = `/projects/${GitLabClient.project(project)}/merge_requests/${iid}`;
    const [m, ch] = await Promise.all([this.request<any>(base), this.request<any>(`${base}/changes`)]);
    let budget = opts.maxDiffChars ?? 30_000;
    let truncated = false;
    const changes = (ch.changes ?? []).map((c: any) => {
      let diff: string | undefined;
      if (opts.includeDiffs && c.diff) {
        if (budget > 0) {
          diff = c.diff.length > budget ? c.diff.slice(0, budget) + "\n…(truncated)" : c.diff;
          budget -= c.diff.length;
        }
        if (budget <= 0) { truncated = true; }
      }
      return {
        path: c.new_path,
        newFile: !!c.new_file,
        deletedFile: !!c.deleted_file,
        renamedFrom: c.renamed_file ? c.old_path : undefined,
        diff,
      };
    });
    const pipeline = m.head_pipeline ?? m.pipeline;
    return {
      ...GitLabClient.mrRow(m),
      description: m.description ?? "",
      assignees: (m.assignees ?? []).map((a: any) => a.username),
      reviewers: (m.reviewers ?? []).map((a: any) => a.username),
      mergeStatus: m.detailed_merge_status ?? m.merge_status,
      hasConflicts: !!m.has_conflicts,
      pipeline: pipeline ? { id: pipeline.id, status: pipeline.status, url: pipeline.web_url } : undefined,
      changes,
      changesTruncated: truncated || ch.overflow === true,
    };
  }

  async listPipelines(project: string, opts: { ref?: string; status?: string; limit?: number } = {}): Promise<PipelineRow[]> {
    const q = GitLabClient.qs({ ref: opts.ref, status: opts.status, order_by: "id", sort: "desc", per_page: Math.min(opts.limit ?? 10, 50) });
    const rows = await this.request<any[]>(`/projects/${GitLabClient.project(project)}/pipelines?${q}`);
    return rows.map((p) => ({ id: p.id, status: p.status, ref: p.ref, sha: p.sha?.slice(0, 8), source: p.source, createdAt: p.created_at, url: p.web_url }));
  }

  async listPipelineJobs(project: string, pipelineId: number): Promise<JobRow[]> {
    const rows = await this.request<any[]>(
      `/projects/${GitLabClient.project(project)}/pipelines/${pipelineId}/jobs?per_page=100&include_retried=false`);
    return rows.map((j) => ({
      id: j.id, name: j.name, stage: j.stage, status: j.status,
      failureReason: j.failure_reason ?? undefined, allowFailure: !!j.allow_failure, url: j.web_url,
    }));
  }

  /** Last `lines` lines of a job log, with ANSI colour codes and GitLab section markers removed. */
  async getJobLogTail(project: string, jobId: number, lines = 200): Promise<string> {
    const res = await this.raw(`/projects/${GitLabClient.project(project)}/jobs/${jobId}/trace`, { headers: { Accept: "text/plain" } });
    const text = (await res.text())
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
      .replace(/section_(?:start|end):\d+:[\w.\-[\]=,]+\r?/g, "")
      .replace(/\r(?!\n)/g, "\n")
      .trimEnd();
    const all = text.split(/\r?\n/);
    return (all.length > lines ? `…(${all.length - lines} earlier lines omitted)\n` : "") + all.slice(-lines).join("\n");
  }

  async listIssues(opts: { project?: string; state?: "opened" | "closed" | "all"; scope?: "assigned_to_me" | "created_by_me" | "all"; search?: string; labels?: string; limit?: number } = {}): Promise<IssueRow[]> {
    const q = GitLabClient.qs({
      state: opts.state ?? "opened",
      scope: opts.project ? (opts.scope === "all" ? undefined : opts.scope) : (opts.scope ?? "assigned_to_me"),
      search: opts.search,
      labels: opts.labels,
      order_by: "updated_at",
      per_page: Math.min(opts.limit ?? 20, 50),
    });
    const path = opts.project ? `/projects/${GitLabClient.project(opts.project)}/issues?${q}` : `/issues?${q}`;
    return (await this.request<any[]>(path)).map((i) => ({
      project: i.references?.full?.split("#")[0] ?? String(i.project_id),
      iid: i.iid, title: i.title, state: i.state, labels: i.labels ?? [],
      assignees: (i.assignees ?? []).map((a: any) => a.username), url: i.web_url,
    }));
  }

  async searchProjects(search: string, limit = 20): Promise<ProjectRow[]> {
    const q = GitLabClient.qs({ search, membership: true, simple: true, order_by: "last_activity_at", per_page: Math.min(limit, 50) });
    return (await this.request<any[]>(`/projects?${q}`)).map((p) => ({
      id: p.id, path: p.path_with_namespace, description: p.description ?? "", defaultBranch: p.default_branch, url: p.web_url,
    }));
  }

  async addMergeRequestNote(project: string, iid: number, body: string): Promise<string> {
    const r = await this.request<any>(`/projects/${GitLabClient.project(project)}/merge_requests/${iid}/notes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    return r?.id ? `note_${r.id}` : "";
  }
}
