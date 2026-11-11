import * as vscode from "vscode";
import * as crypto from "crypto";
import { Secrets } from "../auth/secrets";
import { GitLabClient } from "../clients/gitlab";
import { JiraClient } from "../clients/jira";
import { AwsClient, AwsCredentials } from "../clients/aws";

export const GITLAB_TOKEN = "gitlab.token";
export const JIRA_TOKEN = "jira.token";
export const AWS_CREDENTIALS = "aws.credentials";

type Service = "gitlab" | "jira" | "aws";

type FromWebview =
  | { type: "ready" }
  | { type: "save"; service: Service; fields: Record<string, string> }
  | { type: "test"; service: Service }
  | { type: "clear"; service: Service }
  | { type: "awsTerminal" };

/** AWS keys are stored together as one JSON secret. */
export async function readAwsCredentials(secrets: Secrets): Promise<AwsCredentials | undefined> {
  const raw = await secrets.get(AWS_CREDENTIALS);
  if (!raw) { return undefined; }
  try {
    const c = JSON.parse(raw) as AwsCredentials;
    return c.accessKeyId && c.secretAccessKey ? c : undefined;
  } catch {
    return undefined;
  }
}

const isUrl = (s: string) => /^https?:\/\/[^\s/]+/i.test(s);

/**
 * Sidebar forms for service credentials. Secrets go straight to SecretStorage (OS keychain) and are
 * never sent back to the webview: it only learns whether one is saved (and the last 4 chars of the
 * AWS access key ID, so users can tell which key is active).
 */
export class ConnectionsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "devassist.connections";
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly secrets: Secrets,
    private readonly clients: { gitlab: GitLabClient; jira: JiraClient; aws: AwsClient },
  ) {}

  register(ctx: vscode.ExtensionContext) {
    ctx.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ConnectionsViewProvider.viewId, this),
      // Stay in sync when values change via commands, settings or another window.
      this.secrets.onDidChange((e) => {
        if ([GITLAB_TOKEN, JIRA_TOKEN, AWS_CREDENTIALS].includes(e.key)) { void this.postState(); }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("devassist")) { void this.postState(); }
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m));
    view.onDidDispose(() => { this.view = undefined; });
  }

  private cfg() {
    return vscode.workspace.getConfiguration("devassist");
  }

  private async setting(key: string, value: string) {
    if (this.cfg().get<string>(key) !== value) {
      await this.cfg().update(key, value, vscode.ConfigurationTarget.Global);
    }
  }

  private async postState() {
    if (!this.view) { return; }
    const aws = await readAwsCredentials(this.secrets);
    await this.view.webview.postMessage({
      type: "state",
      gitlab: {
        baseUrl: this.cfg().get<string>("gitlab.baseUrl", "https://gitlab.com"),
        hasSecret: await this.secrets.has(GITLAB_TOKEN),
      },
      jira: {
        baseUrl: this.cfg().get<string>("jira.baseUrl", ""),
        authType: this.cfg().get<string>("jira.authType", "bearer"),
        email: this.cfg().get<string>("jira.email", ""),
        hasSecret: await this.secrets.has(JIRA_TOKEN),
      },
      aws: {
        region: this.cfg().get<string>("aws.region", "us-east-1"),
        hasSecret: !!aws,
        keyHint: aws ? `…${aws.accessKeyId.slice(-4)}` : "",
        temporary: !!aws?.sessionToken,
      },
    });
  }

  private status(service: Service, kind: "ok" | "error" | "info", text: string) {
    void this.view?.webview.postMessage({ type: "status", service, kind, text });
  }

  private async onMessage(m: FromWebview) {
    try {
      switch (m.type) {
        case "ready": return await this.postState();
        case "save": return await this.save(m.service, m.fields);
        case "test": return await this.test(m.service, "");
        case "clear": return await this.clear(m.service);
        case "awsTerminal": return await vscode.commands.executeCommand("devassist.openAwsTerminal");
      }
    } catch (e) {
      if ("service" in m) { this.status(m.service, "error", (e as Error).message); }
      else { void vscode.window.showErrorMessage(`DevAssist: ${(e as Error).message}`); }
    }
  }

  private async save(service: Service, f: Record<string, string>) {
    const v = (k: string) => (f[k] ?? "").trim();
    let hasSecret = false;

    if (service === "gitlab") {
      const baseUrl = v("baseUrl").replace(/\/+$/, "") || "https://gitlab.com";
      if (!isUrl(baseUrl)) { return this.status(service, "error", "GitLab URL must start with https://"); }
      await this.setting("gitlab.baseUrl", baseUrl);
      if (v("token")) { await this.secrets.set(GITLAB_TOKEN, v("token")); }
      hasSecret = await this.secrets.has(GITLAB_TOKEN);
    } else if (service === "jira") {
      const baseUrl = v("baseUrl").replace(/\/+$/, "");
      if (!isUrl(baseUrl)) { return this.status(service, "error", "Jira URL must start with https://"); }
      const authType = v("authType") === "basic" ? "basic" : "bearer";
      if (authType === "basic" && !v("email")) {
        return this.status(service, "error", "Jira Cloud needs the email address of the account the API token belongs to.");
      }
      await this.setting("jira.baseUrl", baseUrl);
      await this.setting("jira.authType", authType);
      await this.setting("jira.email", v("email"));
      if (v("token")) { await this.secrets.set(JIRA_TOKEN, v("token")); }
      hasSecret = await this.secrets.has(JIRA_TOKEN);
    } else {
      const region = v("region") || "us-east-1";
      if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) {
        return this.status(service, "error", `"${region}" doesn't look like an AWS region (e.g. eu-west-2).`);
      }
      await this.setting("aws.region", region);
      const accessKeyId = v("accessKeyId");
      const secretAccessKey = v("secretAccessKey");
      const sessionToken = v("sessionToken");
      if (accessKeyId || secretAccessKey || sessionToken) {
        // Replace the whole set: a session token only makes sense with the key pair it was issued with.
        if (!accessKeyId || !secretAccessKey) {
          return this.status(service, "error", "Enter both the access key ID and the secret access key to change keys.");
        }
        if (!/^(AKIA|ASIA)[A-Z0-9]{12,}$/.test(accessKeyId)) {
          return this.status(service, "error", "Access key IDs start with AKIA (long-term) or ASIA (temporary).");
        }
        if (accessKeyId.startsWith("ASIA") && !sessionToken) {
          return this.status(service, "error", "ASIA… keys are temporary and need their session token too.");
        }
        const creds: AwsCredentials = { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) };
        await this.secrets.set(AWS_CREDENTIALS, JSON.stringify(creds));
      }
      hasSecret = !!(await readAwsCredentials(this.secrets));
    }

    await this.postState();
    // Verify straight away so a typo shows up here rather than mid-chat.
    if (hasSecret) { await this.test(service, "Saved. "); }
    else { this.status(service, "info", "Settings saved. Add credentials to connect."); }
  }

  private async test(service: Service, prefix: string) {
    this.status(service, "info", "Checking…");
    try {
      if (service === "gitlab") {
        const u = await this.clients.gitlab.currentUser();
        this.status(service, "ok", `${prefix}Connected as ${u.name} (@${u.username}).`);
      } else if (service === "jira") {
        const u = await this.clients.jira.myself();
        this.status(service, "ok", `${prefix}Connected as ${u.displayName}.`);
      } else {
        const id = await this.clients.aws.getCallerIdentity();
        this.status(service, "ok", `${prefix}Account ${id.account}\n${id.arn}`);
      }
    } catch (e) {
      this.status(service, "error", `${prefix}${(e as Error).message}`);
    }
  }

  private async clear(service: Service) {
    const label = { gitlab: "GitLab token", jira: "Jira token", aws: "AWS credentials" }[service];
    const ok = await vscode.window.showWarningMessage(`Remove the saved ${label}?`, { modal: true }, "Remove");
    if (ok !== "Remove") { return; }
    await this.secrets.delete({ gitlab: GITLAB_TOKEN, jira: JIRA_TOKEN, aws: AWS_CREDENTIALS }[service]);
    await this.postState();
    this.status(service, "info", `${label} removed.`);
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    const buttons = (service: Service, extra = "") => /* html */ `
      <div class="row">
        <button type="submit">Save</button>
        <button type="button" class="secondary" data-action="test" data-service="${service}">Test</button>
        <button type="button" class="secondary" data-action="clear" data-service="${service}">Remove</button>
        ${extra}
      </div>
      <div class="status" id="status-${service}" role="status" aria-live="polite"></div>`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body { padding: 0 12px 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  details { border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, transparent)); padding-bottom: 12px; }
  summary { cursor: pointer; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; padding: 12px 0 4px; }
  label { display: block; margin: 10px 0 4px; }
  input, select { box-sizing: border-box; width: 100%; padding: 4px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; font: inherit; }
  select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border-color: var(--vscode-dropdown-border, transparent); }
  input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .hint { margin-top: 4px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .row { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
  button { padding: 4px 10px; border: none; border-radius: 2px; cursor: pointer; font: inherit;
           color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: .5; cursor: default; }
  .badge { margin-left: 6px; padding: 0 6px; border-radius: 8px; font-size: 10px; font-weight: normal; text-transform: none;
           color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); }
  .status { margin-top: 10px; white-space: pre-wrap; word-break: break-word; }
  .status.ok { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
  .status.error { color: var(--vscode-errorForeground); }
  .status.info { color: var(--vscode-descriptionForeground); }
  [hidden] { display: none !important; }
</style>
</head>
<body>
  <details open>
    <summary>GitLab <span class="badge" id="badge-gitlab" hidden>connected</span></summary>
    <form data-service="gitlab">
      <label for="gitlab-baseUrl">GitLab URL</label>
      <input id="gitlab-baseUrl" name="baseUrl" type="url" placeholder="https://gitlab.com" spellcheck="false" autocomplete="off">
      <div class="hint">Self-managed? Use e.g. https://gitlab.company.com</div>
      <label for="gitlab-token">Personal access token</label>
      <input id="gitlab-token" name="token" type="password" data-secret placeholder="glpat-…" spellcheck="false" autocomplete="off">
      <div class="hint">Needs the <code>read_api</code> scope (<code>api</code> for write tools).</div>
      ${buttons("gitlab")}
    </form>
  </details>

  <details open>
    <summary>Jira <span class="badge" id="badge-jira" hidden>connected</span></summary>
    <form data-service="jira">
      <label for="jira-baseUrl">Jira URL</label>
      <input id="jira-baseUrl" name="baseUrl" type="url" placeholder="https://jira.company.com" spellcheck="false" autocomplete="off">
      <label for="jira-authType">Jira type</label>
      <select id="jira-authType" name="authType">
        <option value="bearer">Server / Data Center (personal access token)</option>
        <option value="basic">Cloud (email + API token)</option>
      </select>
      <div id="jira-emailRow" hidden>
        <label for="jira-email">Account email</label>
        <input id="jira-email" name="email" type="email" spellcheck="false" autocomplete="off">
      </div>
      <label for="jira-token" id="jira-tokenLabel">Personal access token</label>
      <input id="jira-token" name="token" type="password" data-secret spellcheck="false" autocomplete="off">
      ${buttons("jira")}
    </form>
  </details>

  <details open>
    <summary>AWS <span class="badge" id="badge-aws" hidden>connected</span></summary>
    <form data-service="aws">
      <label for="aws-region">Default region</label>
      <input id="aws-region" name="region" placeholder="us-east-1" spellcheck="false" autocomplete="off">
      <label for="aws-accessKeyId">Access key ID</label>
      <input id="aws-accessKeyId" name="accessKeyId" data-secret placeholder="AKIA… / ASIA…" spellcheck="false" autocomplete="off">
      <label for="aws-secretAccessKey">Secret access key</label>
      <input id="aws-secretAccessKey" name="secretAccessKey" type="password" data-secret spellcheck="false" autocomplete="off">
      <label for="aws-sessionToken">Session token <span class="hint">(temporary credentials only)</span></label>
      <input id="aws-sessionToken" name="sessionToken" type="password" data-secret spellcheck="false" autocomplete="off">
      <div class="hint">Prefer temporary credentials (SSO / assumed role) or a read-only IAM user.
        Leave the key fields blank to keep the saved keys.</div>
      ${buttons("aws", `<button type="button" class="secondary" data-action="awsTerminal" data-service="aws">Open terminal</button>`)}
    </form>
  </details>

  <p class="hint">Secrets are stored in your OS keychain via VS Code SecretStorage and are never shown again here.</p>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  for (const form of document.querySelectorAll("form")) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fields = {};
      for (const el of form.elements) { if (el.name) { fields[el.name] = el.value; } }
      vscode.postMessage({ type: "save", service: form.dataset.service, fields });
      // Never keep secrets in the webview.
      for (const el of form.querySelectorAll("[data-secret]")) { el.value = ""; }
    });
  }
  for (const btn of document.querySelectorAll("button[data-action]")) {
    btn.addEventListener("click", () => vscode.postMessage({ type: btn.dataset.action, service: btn.dataset.service }));
  }

  function syncJiraType() {
    const cloud = $("jira-authType").value === "basic";
    $("jira-emailRow").hidden = !cloud;
    $("jira-tokenLabel").textContent = cloud ? "API token" : "Personal access token";
  }
  $("jira-authType").addEventListener("change", syncJiraType);

  // Don't overwrite what the user is typing when state arrives.
  const setValue = (id, value) => { if (document.activeElement !== $(id)) { $(id).value = value || ""; } };
  const keep = "•••••••• (leave blank to keep)";

  window.addEventListener("message", ({ data }) => {
    if (data.type === "state") {
      for (const s of ["gitlab", "jira", "aws"]) {
        const has = data[s].hasSecret;
        $("badge-" + s).hidden = !has;
        for (const b of document.querySelectorAll('[data-service="' + s + '"][data-action]')) { b.disabled = !has; }
      }
      setValue("gitlab-baseUrl", data.gitlab.baseUrl);
      $("gitlab-token").placeholder = data.gitlab.hasSecret ? keep : "glpat-…";

      setValue("jira-baseUrl", data.jira.baseUrl);
      setValue("jira-authType", data.jira.authType);
      setValue("jira-email", data.jira.email);
      $("jira-token").placeholder = data.jira.hasSecret ? keep : "";
      syncJiraType();

      setValue("aws-region", data.aws.region);
      $("aws-accessKeyId").placeholder = data.aws.hasSecret ? "Saved key " + data.aws.keyHint + " (leave blank to keep)" : "AKIA… / ASIA…";
      $("aws-secretAccessKey").placeholder = data.aws.hasSecret ? keep : "";
      $("aws-sessionToken").placeholder = data.aws.temporary ? keep : "";
    } else if (data.type === "status") {
      const el = $("status-" + data.service);
      el.className = "status " + data.kind;
      el.textContent = data.text;
    }
  });

  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }
}
