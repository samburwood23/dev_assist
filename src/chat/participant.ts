import * as vscode from "vscode";
import { SkillLibrary } from "../skills/skills";

const MAX_ROUNDS = 12;

const COMMAND_PROMPTS: Record<string, string> = {
  standup:
    "Find my unresolved Jira issues (assignee = currentUser() AND resolution = Unresolved) and write a 3-bullet " +
    "standup: yesterday, today, blockers. Link every ticket key.",
};

export function registerParticipant(ctx: vscode.ExtensionContext, skills: SkillLibrary) {
  const handler: vscode.ChatRequestHandler = async (request, chatContext, stream, token) => {
    const model = request.model; // whatever model the user picked in the chat dropdown
    const tools = vscode.lm.tools.filter((t) => t.tags.includes("devassist"));

    const system =
      "You are DevAssist, a developer assistant. Use tools to look things up rather than guessing. " +
      "Cite ticket keys as links. Only call write tools when the user explicitly asks.\n\n" +
      skills.indexForPrompt();

    const messages: vscode.LanguageModelChatMessage[] = [vscode.LanguageModelChatMessage.User(system)];

    // Earlier turns as text only: simple, and avoids orphaned tool results.
    for (const turn of chatContext.history) {
      if (turn instanceof vscode.ChatRequestTurn) {
        messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
      } else if (turn instanceof vscode.ChatResponseTurn) {
        const t = turn.response
          .filter((p): p is vscode.ChatResponseMarkdownPart => p instanceof vscode.ChatResponseMarkdownPart)
          .map((p) => p.value.value)
          .join("");
        if (t) { messages.push(vscode.LanguageModelChatMessage.Assistant(t)); }
      }
    }

    const commandPrompt = request.command ? COMMAND_PROMPTS[request.command] : undefined;
    const prompt = commandPrompt ? `${commandPrompt}\n\n${request.prompt}`.trim() : request.prompt;
    messages.push(vscode.LanguageModelChatMessage.User(prompt));

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (token.isCancellationRequested) { return; }
      const response = await model.sendRequest(messages, { tools }, token);

      const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
      const calls: vscode.LanguageModelToolCallPart[] = [];
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          stream.markdown(part.value);
          parts.push(part);
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          calls.push(part);
          parts.push(part);
        }
      }
      if (calls.length === 0) { return; } // the model answered, so we're done

      // The assistant message with the tool calls MUST come before the results.
      messages.push(vscode.LanguageModelChatMessage.Assistant(parts));

      const results: vscode.LanguageModelToolResultPart[] = [];
      for (const call of calls) {
        stream.progress(`Running ${call.name}…`);
        try {
          const r = await vscode.lm.invokeTool(
            call.name,
            { input: call.input, toolInvocationToken: request.toolInvocationToken },
            token,
          );
          results.push(new vscode.LanguageModelToolResultPart(call.callId, r.content));
        } catch (e) {
          results.push(new vscode.LanguageModelToolResultPart(call.callId, [
            new vscode.LanguageModelTextPart(`Tool failed: ${(e as Error).message}`),
          ]));
        }
      }
      // Exactly one result per call, same callId, in the very next message.
      messages.push(vscode.LanguageModelChatMessage.User(results));
    }
    stream.markdown("\n\n_Stopped after the maximum number of tool rounds._");
  };

  const participant = vscode.chat.createChatParticipant("devassist.chat", handler);
  participant.iconPath = new vscode.ThemeIcon("sparkle");
  ctx.subscriptions.push(participant);
}
