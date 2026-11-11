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
├─ clients/aws.ts       SigV4 signer + STS GetCallerIdentity check (unit-tested, no AWS SDK)
├─ tools/gitlabTools.ts GitLab LM tools (MRs, pipelines, job logs, issues, projects)
├─ views/connectionsView.ts  sidebar webview: GitLab, Jira and AWS credentials
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

1. Click the **DevAssist** icon in the activity bar. The **Connections** view has a section per service;
   **Save** stores the values and immediately tests them, **Test** re-checks, **Remove** deletes the secret.
   - **GitLab**: URL (defaults to `https://gitlab.com`) and a personal access token with `read_api`
     (`api` if you want the comment tool). Checked against `/api/v4/user`.
   - **Jira**: URL, type (Server/Data Center PAT, or Cloud email + API token), token. Checked against `/rest/api/2/myself`.
   - **AWS**: default region, access key ID, secret access key and, for temporary `ASIA…` keys, the session token.
     Checked with STS `GetCallerIdentity`, which needs no IAM permissions. Prefer temporary or read-only credentials.
     **Open terminal** (or **DevAssist: Open AWS Terminal**) opens a terminal with those credentials in its
     environment only, for running `aws` CLI commands such as the ones the `aws-network-engineer` skill suggests.

   Secrets are stored in the OS keychain (VS Code SecretStorage), never in settings, and are never sent back to the
   webview. URLs, Jira type/email and AWS region are ordinary settings under `devassist.*`. The
   **DevAssist: Set Jira Token** / **Set GitLab Token** commands still work too.
2. In Copilot Chat agent mode, open the tools picker and check the DevAssist tools are listed,
   or type `@assist what's the status of PROJ-123?`, `@assist /standup` or `@assist /reviews`.

### GitLab tools

| Tool | What it does |
|------|--------------|
| `devassist_listGitLabMergeRequests` (`#gitlabMRs`) | MRs in a project or across all projects; filter by state, scope (`assigned_to_me`, `created_by_me`, `reviews_for_me`, `all`), search text, target branch |
| `devassist_getGitLabMergeRequest` (`#gitlabMR`) | One MR: description, reviewers, merge status, conflicts, head pipeline, changed files, optional diffs |
| `devassist_listGitLabPipelines` (`#gitlabPipelines`) | Recent pipelines, filter by branch/tag and status |
| `devassist_getGitLabPipelineJobs` | Jobs in a pipeline with stage, status and failure reason |
| `devassist_getGitLabJobLog` (`#gitlabJobLog`) | Tail of a CI job log, colour codes stripped |
| `devassist_listGitLabIssues` (`#gitlabIssues`) | Issues in a project or across all projects |
| `devassist_searchGitLabProjects` | Find a project's `group/project` path and ID |
| `devassist_commentOnGitLabMergeRequest` | Post an MR comment (write: asks for confirmation, needs `api` scope) |

Tools that take a `project` default to the repo open in the workspace: the `group/project` is read from its git
remote when that remote is on the configured GitLab host. Pass `group/project` or a numeric ID to override.


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
