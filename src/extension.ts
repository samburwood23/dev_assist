import * as vscode from "vscode";
import { Secrets } from "./auth/secrets";
import { JiraClient } from "./clients/jira";
import { registerJiraTools } from "./tools/jiraTools";
import { registerParticipant } from "./chat/participant";
import { SkillLibrary } from "./skills/skills";

// Wiring only: each service is a client file + a tools file + manifest entries.
export async function activate(ctx: vscode.ExtensionContext) {
  const secrets = new Secrets(ctx.secrets);
  const cfg = () => vscode.workspace.getConfiguration("devassist");

  const jira = new JiraClient(
    () => cfg().get<string>("jira.baseUrl", ""),
    async () => {
      const token = await secrets.get("jira.token");
      if (!token) { return undefined; }
      return {
        type: cfg().get<"bearer" | "basic">("jira.authType", "bearer"),
        email: cfg().get<string>("jira.email", ""),
        token,
      };
    },
  );

  const skills = new SkillLibrary(ctx);

  ctx.subscriptions.push(
    vscode.commands.registerCommand("devassist.setJiraToken", async () => {
      const basic = cfg().get("jira.authType") === "basic";
      if (await secrets.prompt("jira.token", basic ? "Jira Cloud API token" : "Jira personal access token")) {
        vscode.window.showInformationMessage("DevAssist: Jira token saved.");
      }
    }),
    vscode.commands.registerCommand("devassist.reloadSkills", async () => {
      await skills.reload();
      vscode.window.showInformationMessage(`DevAssist: ${skills.names().length} skill(s) loaded.`);
    }),
  );

  // Register tools before any await-heavy work so they're always available.
  registerJiraTools(ctx, jira);
  skills.registerTools();
  registerParticipant(ctx, skills);

  await skills.reload();
}

export function deactivate() {}
