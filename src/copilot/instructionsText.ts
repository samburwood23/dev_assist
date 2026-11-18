// No VS Code types here so it can be unit-tested.

export interface SkillSummary { name: string; description: string }

export const INSTRUCTIONS_FILE = "devassist.instructions.md";

/** One-line-per-skill index, also returned by devassist_loadSkill when called without a name. */
export function skillIndex(skills: SkillSummary[]): string {
  if (!skills.length) { return "No DevAssist skills are installed."; }
  return "DevAssist skills (load one with devassist_loadSkill before following it):\n" +
    skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}

/** The .instructions.md file Copilot Chat attaches to every request. */
export function buildInstructions(skills: SkillSummary[]): string {
  return [
    "---",
    'applyTo: "**"',
    "description: How to use the DevAssist tools (Jira, GitLab) and skills.",
    "---",
    "# DevAssist",
    "",
    "The DevAssist extension provides `devassist_*` tools for Jira and GitLab and a library of team procedures (skills).",
    "",
    "- Use the tools to look things up rather than guessing. Cite Jira keys, merge requests (group/project!123) and pipelines as links.",
    "- For GitLab tools, omit `project` to use the GitLab repo open in the workspace.",
    "- Only call write tools (Jira/GitLab comments) when the user explicitly asks.",
    "- If a tool says credentials are missing, tell the user to open the DevAssist sidebar (Connections).",
    "- When a request matches a skill below, call `devassist_loadSkill` with its name and follow it.",
    "",
    skillIndex(skills),
    "",
  ].join("\n");
}
