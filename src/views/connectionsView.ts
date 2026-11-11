import * as vscode from "vscode";
import * as crypto from "crypto";
import { Secrets } from "../auth/secrets";
import { GitLabClient } from "../clients/gitlab";

export const GITLAB_TOKEN = "gitlab.token";

type FromWebview =
  | { type: "ready" }
  | { type: "save"; baseUrl: string; token: string }
  | { type: "test" }
  | { type: "clear" };

interface ViewState { baseUrl: string; hasToken: boolean }

/**
 * Sidebar form for GitLab credentials. The token goes straight to SecretStorage
 * and is never sent back to the webview; the view only learns whether one is saved.
 */
export class ConnectionsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "devassist.connections";
  private view: vscode.WebviewView | undefined;

  constructor(private readonly secrets: Secrets, private readonly gitlab: GitLabClient) {}

  register(ctx: vscode.ExtensionContext) {
    ctx.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ConnectionsViewProvider.viewId, this),
      // Keep the view in sync when the token or URL is changed via a command, settings or another window.
      this.secrets.onDidChange((e) => { if (e.key === GITLAB_TOKEN) { void this.postState(); } }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("devassist.gitlab.baseUrl")) { void this.postState(); }
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

  private async state(): Promise<ViewState> {
    return {
      baseUrl: this.cfg().get<string>("gitlab.baseUrl", "https://gitlab.com"),
      hasToken: await this.secrets.has(GITLAB_TOKEN),
    };
  }

  private async postState() {
    await this.view?.webview.postMessage({ type: "state", ...(await this.state()) });
  }

  private status(kind: "ok" | "error" | "info", text: string) {
    void this.view?.webview.postMessage({ type: "status", kind, text });
  }

  private async onMessage(m: FromWebview) {
    try {
      switch (m.type) {
        case "ready":
          await this.postState();
          return;
        case "save": {
          const baseUrl = m.baseUrl.trim().replace(/\/+$/, "");
          if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
            this.status("error", "GitLab URL must start with https:// (or http://).");
            return;
          }
          if (baseUrl !== this.cfg().get<string>("gitlab.baseUrl")) {
            await this.cfg().update("gitlab.baseUrl", baseUrl || "https://gitlab.com", vscode.ConfigurationTarget.Global);
          }
          if (m.token.trim()) { await this.secrets.set(GITLAB_TOKEN, m.token); }
          await this.postState();
          // Verify straight away so a typo shows up here rather than mid-chat.
          if (await this.secrets.has(GITLAB_TOKEN)) { await this.test("Saved. "); }
          else { this.status("info", "URL saved. Add a token to connect."); }
          return;
        }
        case "test":
          await this.test("");
          return;
        case "clear": {
          const ok = await vscode.window.showWarningMessage(
            "Remove the saved GitLab token?", { modal: true }, "Remove",
          );
          if (ok !== "Remove") { return; }
          await this.secrets.delete(GITLAB_TOKEN);
          await this.postState();
          this.status("info", "Token removed.");
          return;
        }
      }
    } catch (e) {
      this.status("error", (e as Error).message);
    }
  }

  private async test(prefix: string) {
    this.status("info", "Checking token…");
    try {
      const u = await this.gitlab.currentUser();
      this.status("ok", `${prefix}Connected as ${u.name} (@${u.username}).`);
    } catch (e) {
      this.status("error", `${prefix}${(e as Error).message}`);
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body { padding: 0 12px 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin: 16px 0 8px; color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground)); }
  label { display: block; margin: 10px 0 4px; }
  input { box-sizing: border-box; width: 100%; padding: 4px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; font: inherit; }
  input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .hint { margin-top: 4px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .row { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
  button { padding: 4px 10px; border: none; border-radius: 2px; cursor: pointer; font: inherit;
           color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: .5; cursor: default; }
  .badge { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 8px; font-size: 10px; vertical-align: middle;
           color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); }
  #status { margin-top: 12px; white-space: pre-wrap; word-break: break-word; }
  #status.ok { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
  #status.error { color: var(--vscode-errorForeground); }
  #status.info { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <h2>GitLab <span id="badge" class="badge" hidden>token saved</span></h2>
  <form id="form">
    <label for="baseUrl">GitLab URL</label>
    <input id="baseUrl" type="url" placeholder="https://gitlab.com" spellcheck="false" autocomplete="off">
    <div class="hint">Use your self-managed URL, e.g. https://gitlab.company.com</div>

    <label for="token">Personal access token</label>
    <input id="token" type="password" placeholder="glpat-…" spellcheck="false" autocomplete="off">
    <div class="hint" id="tokenHint">Needs the <code>read_api</code> scope (<code>api</code> for write tools). Stored in your OS keychain.</div>

    <div class="row">
      <button type="submit" id="save">Save</button>
      <button type="button" class="secondary" id="test">Test</button>
      <button type="button" class="secondary" id="clear">Remove token</button>
    </div>
  </form>
  <div id="status" role="status" aria-live="polite"></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    vscode.postMessage({ type: "save", baseUrl: $("baseUrl").value, token: $("token").value });
    $("token").value = ""; // never keep the token in the webview
  });
  $("test").addEventListener("click", () => vscode.postMessage({ type: "test" }));
  $("clear").addEventListener("click", () => vscode.postMessage({ type: "clear" }));

  window.addEventListener("message", ({ data }) => {
    if (data.type === "state") {
      if (document.activeElement !== $("baseUrl")) { $("baseUrl").value = data.baseUrl || ""; }
      $("badge").hidden = !data.hasToken;
      $("test").disabled = !data.hasToken;
      $("clear").disabled = !data.hasToken;
      $("token").placeholder = data.hasToken ? "•••••••• (leave blank to keep)" : "glpat-…";
    } else if (data.type === "status") {
      $("status").className = data.kind;
      $("status").textContent = data.text;
    }
  });

  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }
}
