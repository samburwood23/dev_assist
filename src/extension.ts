import * as vscode from "vscode";
import { Secrets } from "./auth/secrets";
import { JiraClient } from "./clients/jira";
import { GitLabClient } from "./clients/gitlab";
import { AwsClient } from "./clients/aws";
import {
  ConnectionsViewProvider, GITLAB_TOKEN, JIRA_TOKEN, readAwsCredentials,
} from "./views/connectionsView";
import { registerJiraTools } from "./tools/jiraTools";
import { registerGitLabTools } from "./tools/gitlabTools";
import { registerParticipant } from "./chat/participant";
import { SkillLibrary } from "./skills/skills";

// Wiring only: each service is a client file + a tools file + manifest entries.
export async function activate(ctx: vscode.ExtensionContext) {
  const secrets = new Secrets(ctx.secrets);
  const cfg = () => vscode.workspace.getConfiguration("devassist");

  const jira = new JiraClient(
    () => cfg().get<string>("jira.baseUrl", ""),
    async () => {
      const token = await secrets.get(JIRA_TOKEN);
      if (!token) { return undefined; }
      return {
        type: cfg().get<"bearer" | "basic">("jira.authType", "bearer"),
        email: cfg().get<string>("jira.email", ""),
        token,
      };
    },
  );

  const gitlab = new GitLabClient(
    () => cfg().get<string>("gitlab.baseUrl", "https://gitlab.com"),
    () => secrets.get(GITLAB_TOKEN),
  );

  const awsRegion = () => cfg().get<string>("aws.region", "us-east-1");
  const aws = new AwsClient(awsRegion, () => readAwsCredentials(secrets));

  const skills = new SkillLibrary(ctx);

  ctx.subscriptions.push(
    vscode.commands.registerCommand("devassist.openConnections", () =>
      vscode.commands.executeCommand(`${ConnectionsViewProvider.viewId}.focus`)),
    vscode.commands.registerCommand("devassist.setJiraToken", async () => {
      const basic = cfg().get("jira.authType") === "basic";
      if (await secrets.prompt(JIRA_TOKEN, basic ? "Jira Cloud API token" : "Jira personal access token")) {
        vscode.window.showInformationMessage("DevAssist: Jira token saved.");
      }
    }),
    vscode.commands.registerCommand("devassist.setGitLabToken", async () => {
      if (await secrets.prompt(GITLAB_TOKEN, "GitLab personal access token (read_api scope)")) {
        vscode.window.showInformationMessage("DevAssist: GitLab token saved.");
      }
    }),
    vscode.commands.registerCommand("devassist.openAwsTerminal", async () => {
      const creds = await readAwsCredentials(secrets);
      if (!creds) {
        const pick = await vscode.window.showWarningMessage("DevAssist: no AWS credentials saved.", "Open sidebar");
        if (pick) { await vscode.commands.executeCommand("devassist.openConnections"); }
        return;
      }
      // Credentials go only into this one terminal's environment (not every terminal), and the terminal
      // is transient so VS Code doesn't persist it, or its environment, across restarts.
      const terminal = vscode.window.createTerminal({
        name: "AWS (DevAssist)",
        isTransient: true,
        env: {
          AWS_ACCESS_KEY_ID: creds.accessKeyId,
          AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
          AWS_SESSION_TOKEN: creds.sessionToken ?? null,
          AWS_REGION: awsRegion(),
          AWS_DEFAULT_REGION: awsRegion(),
          AWS_PROFILE: null, // otherwise a profile in the user's shell could shadow these keys
        },
      });
      terminal.show();
    }),
    vscode.commands.registerCommand("devassist.reloadSkills", async () => {
      await skills.reload();
      vscode.window.showInformationMessage(`DevAssist: ${skills.names().length} skill(s) loaded.`);
    }),
  );

  // Register tools before any await-heavy work so they're always available.
  registerJiraTools(ctx, jira);
  registerGitLabTools(ctx, gitlab);
  skills.registerTools();
  registerParticipant(ctx, skills);
  new ConnectionsViewProvider(secrets, { gitlab, jira, aws }).register(ctx);

  await skills.reload();
}

export function deactivate() {}
