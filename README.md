# DevAssist

A VS Code extension that gives Copilot Chat (agent mode) and its own `@assist` participant access to Jira,
plus "skills": folders of markdown procedures the model loads on demand.

## Layout

```
src/
├─ extension.ts         wiring only
├─ auth/secrets.ts      tokens via SecretStorage (OS keychain)
├─ clients/jira.ts      plain REST client, no VS Code types (unit-tested)
├─ clients/gitlab.ts    GitLab REST client (unit-tested)
├─ views/connectionsView.ts  sidebar webview for entering GitLab URL + token
├─ tools/jiraTools.ts   LM tool registrations
├─ chat/participant.ts  @assist chat loop (+ /standup)
└─ skills/              skill loader + devassist_loadSkill tool
skills/                 built-in skills shipped in the .vsix
test/                   node:test unit tests
```

## Develop

```bash
npm install
```

Press **F5** to open an Extension Development Host. Then:

1. Settings → `devassist.jira.baseUrl` (e.g. `https://jira.company.com`).
   For Jira Cloud also set `devassist.jira.authType` to `basic` and `devassist.jira.email`.
2. Run **DevAssist: Set Jira Token**.
3. GitLab: click the **DevAssist** icon in the activity bar. In **Connections**, enter your GitLab URL
   (defaults to `https://gitlab.com`) and a personal access token with the `read_api` scope, then **Save**.
   The token is checked against `/api/v4/user` and stored in the OS keychain (SecretStorage); it is never
   written to settings or sent back to the webview. **DevAssist: Set GitLab Token** does the same from the
   command palette.
4. In Copilot Chat agent mode, open the tools picker and check the DevAssist tools are listed,
   or type `@assist what's the status of PROJ-123?` / `@assist /standup`.

```bash
npm test
```

```bash
npm run compile
```

## Package

```bash
npx vsce package
```

```bash
code --install-extension devassist-0.0.1.vsix
```

## Skills

A skill is a folder with a `SKILL.md`:

```markdown
---
name: release-checklist
description: What it's for and when to use it. This is all the model sees until it loads the skill.
---
# Steps...
```

Built-in skills: `release-checklist`, `incident-triage`, and `aws-network-engineer` (VPC/CIDR design,
Transit Gateway, hybrid connectivity, connectivity troubleshooting and network IaC review).

Skills are loaded from, in increasing priority (later wins on name clash):

1. `skills/` inside the extension (built-ins)
2. `~/.devassist/skills/` (personal)
3. `<workspace>/.devassist/skills/` (per-repo, committed)

Only a one-line index goes into the prompt; the model calls `devassist_loadSkill` for the full text or for
supporting files (`file: "rollback.md"`). Workspace skills reload automatically when edited;
run **DevAssist: Reload Skills** after changing personal skills.

## Adding a service

Each new service (CI, docs, artifact repository) is a client in `src/clients/`, a tools file in `src/tools/`,
and `languageModelTools` entries in `package.json` tagged `devassist` plus `read` or `write`. Give every write
tool a `prepareInvocation` confirmation.
