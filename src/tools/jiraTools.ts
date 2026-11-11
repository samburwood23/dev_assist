import * as vscode from "vscode";
import { JiraClient } from "../clients/jira";

const text = (s: string) => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(s)]);
const MAX = 20_000; // keep results small, since huge outputs blow the context window

export function registerJiraTools(ctx: vscode.ExtensionContext, jira: JiraClient) {
  ctx.subscriptions.push(
    vscode.lm.registerTool<{ key: string }>("devassist_getJiraIssue", {
      prepareInvocation({ input }) {
        return { invocationMessage: `Fetching ${input.key}…` };
      },
      async invoke({ input }) {
        try {
          const i = await jira.getIssue(input.key);
          let description = i.description ?? "(none)";
          if (description.length > MAX) { description = description.slice(0, MAX) + "\n…(truncated)"; }
          return text(
            `[${i.key}](${i.url}): ${i.summary}\nStatus: ${i.status}\nAssignee: ${i.assignee ?? "Unassigned"}\n\n` +
            `Description:\n${description}`,
          );
        } catch (e) {
          // Errors go back as text so the model can recover.
          return text(`Could not fetch ${input.key}: ${(e as Error).message}`);
        }
      },
    }),

    vscode.lm.registerTool<{ jql: string }>("devassist_searchJira", {
      prepareInvocation({ input }) {
        return { invocationMessage: `Searching Jira: ${input.jql}` };
      },
      async invoke({ input }) {
        try {
          const rows = await jira.search(input.jql);
          return text(rows.length ? rows.map((r) => `- ${r.key} [${r.status}] ${r.summary}`).join("\n") : "No issues matched.");
        } catch (e) {
          return text(`Search failed: ${(e as Error).message}`);
        }
      },
    }),

    vscode.lm.registerTool<{ key: string; body: string }>("devassist_addJiraComment", {
      // Writes: show a confirmation before running.
      prepareInvocation({ input }) {
        return {
          invocationMessage: `Commenting on ${input.key}…`,
          confirmationMessages: {
            title: `Post comment to ${input.key}?`,
            message: new vscode.MarkdownString(input.body),
          },
        };
      },
      async invoke({ input }) {
        try {
          await jira.addComment(input.key, input.body);
          return text(`Comment posted to ${input.key}.`);
        } catch (e) {
          return text(`Comment failed: ${(e as Error).message}`);
        }
      },
    }),
  );
}
