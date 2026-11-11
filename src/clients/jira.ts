// Plain REST client with no VS Code types, so it can be unit-tested with node:test.

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  assignee?: string;
  description?: string;
  url: string;
}

export interface JiraSearchRow { key: string; summary: string; status: string }

export interface JiraAuth {
  /** "bearer" = Server/Data Center PAT, "basic" = Jira Cloud email + API token. */
  type: "bearer" | "basic";
  token: string;
  email?: string;
}

export type FetchFn = typeof fetch;

export class JiraClient {
  constructor(
    private readonly baseUrl: () => string,
    private readonly auth: () => Promise<JiraAuth | undefined>,
    private readonly fetchFn: FetchFn = (...args) => fetch(...args),
  ) {}

  private root(): string {
    return this.baseUrl().trim().replace(/\/+$/, "");
  }

  private async authHeader(): Promise<string> {
    const auth = await this.auth();
    if (!this.root() || !auth?.token) {
      throw new Error("Jira is not configured. Set 'devassist.jira.baseUrl' and run 'DevAssist: Set Jira Token'.");
    }
    if (auth.type === "basic") {
      if (!auth.email) { throw new Error("Jira Cloud auth needs 'devassist.jira.email' to be set."); }
      return `Basic ${Buffer.from(`${auth.email}:${auth.token}`).toString("base64")}`;
    }
    return `Bearer ${auth.token}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const authorization = await this.authHeader();
    const res = await this.fetchFn(`${this.root()}${path}`, {
      ...init,
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      // Surface Jira's own error messages (e.g. bad JQL) so the model can fix its input.
      let detail = "";
      try {
        const body = (await res.json()) as { errorMessages?: string[]; errors?: Record<string, string> };
        detail = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})].join("; ");
      } catch { /* non-JSON error body */ }
      const hint = res.status === 401 || res.status === 403 ? " Check the token with 'DevAssist: Set Jira Token'." : "";
      throw new Error(`Jira returned ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}.${hint}`);
    }
    if (res.status === 204) { return undefined as T; }
    return (await res.json()) as T;
  }

  async getIssue(key: string): Promise<JiraIssue> {
    const r = await this.request<any>(
      `/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary,status,assignee,description`,
    );
    return {
      key: r.key,
      summary: r.fields.summary,
      status: r.fields.status?.name,
      assignee: r.fields.assignee?.displayName,
      description: r.fields.description ?? undefined,
      url: `${this.root()}/browse/${r.key}`,
    };
  }

  async search(jql: string, max = 20): Promise<JiraSearchRow[]> {
    const r = await this.request<any>(`/rest/api/2/search`, {
      method: "POST",
      body: JSON.stringify({ jql, maxResults: max, fields: ["summary", "status"] }),
    });
    return (r.issues ?? []).map((i: any) => ({ key: i.key, summary: i.fields.summary, status: i.fields.status?.name }));
  }

  async addComment(key: string, body: string): Promise<void> {
    await this.request(`/rest/api/2/issue/${encodeURIComponent(key)}/comment`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }
}
