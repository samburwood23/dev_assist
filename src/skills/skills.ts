import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { isInside, parseFrontmatter } from "./frontmatter";

interface Skill { name: string; description: string; dir: string; body: string }

/**
 * Skills are folders with a SKILL.md. Only a short index goes in the prompt;
 * the model loads full text on demand with devassist_loadSkill.
 */
export class SkillLibrary {
  private skills = new Map<string, Skill>();
  private reloading: Promise<void> | undefined;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  private roots(): string[] {
    const ws = vscode.workspace.workspaceFolders?.map((f) => path.join(f.uri.fsPath, ".devassist", "skills")) ?? [];
    // Later roots win: repo skills override personal ones, personal skills override built-ins.
    return [path.join(this.ctx.extensionPath, "skills"), path.join(os.homedir(), ".devassist", "skills"), ...ws];
  }

  reload(): Promise<void> {
    // Coalesce bursts of file-watcher events into one reload.
    this.reloading ??= this.doReload().finally(() => { this.reloading = undefined; });
    return this.reloading;
  }

  private async doReload() {
    const next = new Map<string, Skill>();
    for (const root of this.roots()) {
      let entries: string[] = [];
      try { entries = await fs.readdir(root); } catch { continue; }
      for (const entry of entries) {
        const dir = path.join(root, entry);
        try {
          const { meta, body } = parseFrontmatter(await fs.readFile(path.join(dir, "SKILL.md"), "utf8"));
          const name = meta.name || entry;
          next.set(name, { name, description: meta.description ?? "", dir, body });
        } catch { /* not a skill folder */ }
      }
    }
    this.skills = next; // swap atomically so readers never see a half-loaded map
  }

  names(): string[] {
    return [...this.skills.keys()];
  }

  indexForPrompt(): string {
    if (!this.skills.size) { return ""; }
    return "Available skills (call devassist_loadSkill to read one before following it):\n" +
      [...this.skills.values()].map((s) => `- ${s.name}: ${s.description}`).join("\n");
  }

  registerTools() {
    const out = (s: string) => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(s)]);

    this.ctx.subscriptions.push(
      vscode.lm.registerTool<{ name: string; file?: string }>("devassist_loadSkill", {
        prepareInvocation: ({ input }) => ({
          invocationMessage: input.file ? `Loading ${input.name}/${input.file}…` : `Loading skill ${input.name}…`,
        }),
        invoke: async ({ input }) => {
          const skill = this.skills.get(input.name);
          if (!skill) { return out(`No skill "${input.name}". Known: ${this.names().join(", ") || "(none)"}`); }
          if (!input.file) { return out(skill.body); }
          const target = path.resolve(skill.dir, input.file);
          if (!isInside(skill.dir, target, path.sep)) { return out("File must be inside the skill folder."); }
          try {
            return out(await fs.readFile(target, "utf8"));
          } catch {
            return out(`No file ${input.file} in ${skill.name}.`);
          }
        },
      }),
    );

    // Pick up skills edited in the workspace without a reload.
    const watcher = vscode.workspace.createFileSystemWatcher("**/.devassist/skills/**");
    const reload = () => { void this.reload(); };
    watcher.onDidChange(reload);
    watcher.onDidCreate(reload);
    watcher.onDidDelete(reload);
    this.ctx.subscriptions.push(watcher, vscode.workspace.onDidChangeWorkspaceFolders(reload));
  }
}
