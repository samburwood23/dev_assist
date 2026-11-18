import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { SkillLibrary } from "../skills/skills";
import { buildInstructions, INSTRUCTIONS_FILE } from "./instructionsText";

const LOCATIONS = "instructionsFilesLocations"; // chat.instructionsFilesLocations

/**
 * Copilot Chat has no API for an extension to add to its prompt, but it reads *.instructions.md files from the
 * folders listed in chat.instructionsFilesLocations. We keep one file in the extension's storage, regenerate it
 * when skills change, and register its folder in the user's settings (removed again if the feature is turned off).
 */
export function registerCopilotInstructions(ctx: vscode.ExtensionContext, skills: SkillLibrary) {
  const dir = path.join(ctx.globalStorageUri.fsPath, "instructions");
  const enabled = () => vscode.workspace.getConfiguration("devassist").get<boolean>("copilotInstructions", true);

  const setLocation = async (on: boolean) => {
    const chat = vscode.workspace.getConfiguration("chat");
    const current = { ...(chat.inspect<Record<string, boolean>>(LOCATIONS)?.globalValue ?? {}) };
    if (on === (current[dir] === true)) { return; }
    if (on) { current[dir] = true; } else { delete current[dir]; }
    await chat.update(LOCATIONS, current, vscode.ConfigurationTarget.Global);
  };

  const sync = async () => {
    try {
      if (!enabled()) {
        await setLocation(false);
        await fs.rm(path.join(dir, INSTRUCTIONS_FILE), { force: true });
        return;
      }
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, INSTRUCTIONS_FILE), buildInstructions(skills.list()), "utf8");
      await setLocation(true);
    } catch (e) {
      console.error("DevAssist: could not update Copilot instructions", e);
    }
  };

  ctx.subscriptions.push(
    skills.onDidChange(() => { void sync(); }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("devassist.copilotInstructions")) { void sync(); }
    }),
  );
}
