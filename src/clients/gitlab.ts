// Plain REST client with no VS Code types, so it can be unit-tested with node:test.

import type { FetchFn } from "./jira";

export interface GitLabUser { username: string; name: string; webUrl: string }

export class GitLabClient {
  constructor(
    private readonly baseUrl: () => string,
    private readonly token: () => PromiseLike<string | undefined>,
    private readonly fetchFn: FetchFn = (...args) => fetch(...args),
  ) {}

  private root(): string {
    return (this.baseUrl().trim() || "https://gitlab.com").replace(/\/+$/, "");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
        : "";
      throw new Error(`GitLab returned ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}.${hint}`);
    }
    if (res.status === 204) { return undefined as T; }
    return (await res.json()) as T;
  }

  /** Who the token belongs to; used to verify a newly entered token. */
  async currentUser(): Promise<GitLabUser> {
    const r = await this.request<any>("/user");
    return { username: r.username, name: r.name, webUrl: r.web_url };
  }
}
