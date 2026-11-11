# DevAssist

**Your Jira, GitLab and AWS context, inside VS Code chat.**

DevAssist is a VS Code extension that gives GitHub Copilot (agent mode) and its own `@assist` chat participant
tools for Jira and GitLab, a sidebar for connecting your accounts, and **skills**: markdown procedures
(release checklist, incident triage, AWS network engineering) the model loads when they're relevant.

It uses whichever model you've picked in VS Code chat. No extra API keys, no server: everything runs locally
in VS Code, and credentials stay in your OS keychain.

```text
@assist why is the pipeline on my MR failing?
@assist /reviews
@assist what's the status of PROJ-123?
Help me design a VPC with three AZs and a Transit Gateway attachment   (agent mode loads aws-network-engineer)
```

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Connect your accounts](#connect-your-accounts)
- [Using it](#using-it)
- [Tools reference](#tools-reference)
- [Skills](#skills)
- [Settings and commands](#settings-and-commands)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Architecture](#architecture)

## Features

| Area | What you get |
|------|--------------|
| **GitLab** | List and inspect merge requests (including diffs, conflicts and pipeline status), pipelines, jobs, CI job logs, issues and projects; comment on an MR. Works with gitlab.com and self-managed instances, and detects the project from your workspace's git remote. |
| **Jira** | Fetch an issue, search with JQL, comment on an issue. Server/Data Center (personal access token) and Cloud (email + API token). |
| **AWS** | Store credentials securely, verify them (account and ARN), and open a terminal that's already signed in for `aws` CLI work. |
| **`@assist`** | A chat participant with DevAssist's tools and skills built in, plus `/standup` and `/reviews`. |
| **Skills** | Markdown procedures the model loads on demand. Ship your own per repo or per person, no code required. |
| **Connections sidebar** | One place to add, test and remove credentials for every service. |

## Requirements

- VS Code **1.99** or later
- GitHub Copilot Chat (or another chat model provider) enabled in VS Code
- Accounts and tokens for the services you want to use:
  - **GitLab**: a [personal access token](https://docs.gitlab.com/user/profile/personal_access_tokens/) with
    `read_api` (or `api` to let it post MR comments)
  - **Jira Server / Data Center**: a personal access token
  - **Jira Cloud**: your account email and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens)
  - **AWS**: an access key ID and secret access key, ideally temporary (`ASIA…` with a session token) or for a read-only role

## Install

From a packaged build:

```bash
code --install-extension devassist-0.0.1.vsix
```

Or build it yourself; see [Development](#development).

## Connect your accounts

1. Click the **DevAssist** icon (✦) in the activity bar to open **Connections**.
2. Fill in the section for each service you use and press **Save**. DevAssist saves the values and immediately
   tests them; a green message shows who you're connected as.

| Section | Fields | Verified by |
|---------|--------|-------------|
| **GitLab** | URL (default `https://gitlab.com`), personal access token | `GET /api/v4/user` |
| **Jira** | URL, type (Server/Data Center or Cloud), email (Cloud only), token | `GET /rest/api/2/myself` |
| **AWS** | Default region, access key ID, secret access key, session token (temporary keys only) | STS `GetCallerIdentity` (needs no IAM permissions) |

- Leave a secret field blank to keep the saved value. The sidebar never shows saved secrets, only a
  "connected" badge (and the last 4 characters of your AWS key ID so you can tell which key is active).
- **Test** re-checks a connection; **Remove** deletes the stored secret (after you confirm).
- Temporary AWS credentials expire. When the check reports `ExpiredToken`, paste fresh ones.

## Using it

### In Copilot agent mode

Open Copilot Chat, switch to **Agent** mode and check the DevAssist tools are enabled in the tools picker.
Then just ask; Copilot decides when to call them:

- "What merge requests are waiting for my review?"
- "Summarise !42 and tell me if it's safe to merge."
- "Why did the latest pipeline on `main` fail?"
- "Find unresolved Jira bugs in project PAY assigned to me."

You can also reference a tool directly with `#`, for example `#gitlabMR 42` or `#jiraIssue PROJ-123`.

### With `@assist`

`@assist` is DevAssist's own participant. It has all DevAssist tools and the skills index built in.

| Command | What it does |
|---------|--------------|
| `@assist /standup` | Your unresolved Jira tickets as a yesterday / today / blockers update |
| `@assist /reviews` | MRs waiting for your review and your own open MRs, with pipeline and merge blockers |
| `@assist <anything>` | Free-form questions using Jira, GitLab and skills |

### AWS terminal

**Open terminal** in the AWS section (or **DevAssist: Open AWS Terminal**) opens a terminal with your saved
credentials and region set in **that terminal only**. Use it for `aws` CLI commands, for example the
read-only checks the `aws-network-engineer` skill suggests:

```bash
aws sts get-caller-identity
```

## Tools reference

Write tools always show what they're about to post and wait for your confirmation.

### GitLab

| Tool | `#` reference | What it does |
|------|---------------|--------------|
| `devassist_listGitLabMergeRequests` | `#gitlabMRs` | MRs in a project or across all your projects. Filter by state, scope (`assigned_to_me`, `created_by_me`, `reviews_for_me`, `all`), search text, target branch |
| `devassist_getGitLabMergeRequest` | `#gitlabMR` | One MR: description, reviewers, merge status, conflicts, head pipeline, changed files, optional diffs |
| `devassist_listGitLabPipelines` | `#gitlabPipelines` | Recent pipelines, filter by branch/tag and status |
| `devassist_getGitLabPipelineJobs` | | Jobs in a pipeline with stage, status and failure reason |
| `devassist_getGitLabJobLog` | `#gitlabJobLog` | The end of a CI job log, colour codes stripped |
| `devassist_listGitLabIssues` | `#gitlabIssues` | Issues in a project or across all your projects |
| `devassist_searchGitLabProjects` | | Find a project's `group/project` path and ID |
| `devassist_commentOnGitLabMergeRequest` | | **Write.** Comment on an MR (needs `api` scope) |

**Which project?** Tools that take a `project` use the repository open in your workspace when you don't name one:
DevAssist reads its git remote (preferring `origin`) and matches it against your GitLab URL. Name another project
as `group/project` or by numeric ID.

### Jira

| Tool | `#` reference | What it does |
|------|---------------|--------------|
| `devassist_getJiraIssue` | `#jiraIssue` | Summary, status, assignee and description of one issue |
| `devassist_searchJira` | `#jiraSearch` | JQL search, up to 20 results |
| `devassist_addJiraComment` | | **Write.** Comment on an issue |

### Skills

| Tool | What it does |
|------|--------------|
| `devassist_loadSkill` | Loads a skill's full instructions, or a supporting file inside it |

## Skills

A skill is a folder containing a `SKILL.md`. Only each skill's one-line description is in the prompt; the model
loads the full text when the description matches what you're asking.

```markdown
---
name: release-checklist
description: Steps to cut and verify a production release. Use when the user asks to release, deploy to prod, or prepare release notes.
---

# Release checklist

1. ...
See `rollback.md` if anything fails.
```

### Built-in skills

| Skill | Use it for |
|-------|-----------|
| `release-checklist` | Cutting a release: fix version checks, release notes template, rollback procedure |
| `incident-triage` | First response to an outage: severity, owners, comms cadence, incident ticket |
| `aws-network-engineer` | VPC and CIDR design, Transit Gateway, peering, PrivateLink, VPN / Direct Connect, Route 53; packet-path troubleshooting; network Terraform/CloudFormation review |

### Your own skills

Skills are loaded from three places. If two have the same name, the later one wins:

1. Built in: `skills/` inside the extension
2. Personal: `~/.devassist/skills/<name>/SKILL.md`
3. Team: `<repo>/.devassist/skills/<name>/SKILL.md`, committed with the code

Workspace skills reload automatically when edited. After changing personal skills, run **DevAssist: Reload Skills**.

Tips for writing skills:

- The `description` decides whether the skill ever gets used: say what it does **and** when to use it.
- Keep `SKILL.md` to the procedure; put long reference material in supporting files and name them in the steps.
- Refer to DevAssist tools by name (for example `devassist_searchJira with fixVersion = "1.4"`).

## Settings and commands

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `devassist.gitlab.baseUrl` | `https://gitlab.com` | GitLab URL |
| `devassist.jira.baseUrl` | | Jira URL |
| `devassist.jira.authType` | `bearer` | `bearer` for Server/Data Center, `basic` for Cloud |
| `devassist.jira.email` | | Account email (Cloud only) |
| `devassist.aws.region` | `us-east-1` | Default AWS region |

The sidebar saves these as user settings. Override any of them per project in `.vscode/settings.json`.

### Commands

| Command | |
|---------|--|
| **DevAssist: Manage Connections** | Open the Connections sidebar |
| **DevAssist: Set GitLab Token** | Enter a GitLab token without the sidebar |
| **DevAssist: Set Jira Token** | Enter a Jira token without the sidebar |
| **DevAssist: Open AWS Terminal** | Terminal with your saved AWS credentials |
| **DevAssist: Reload Skills** | Re-scan skill folders |

## Security

- **Secrets live in your OS keychain** (VS Code SecretStorage), never in `settings.json`, and are never sent back
  to the sidebar or to the model.
- **Writes need your confirmation.** Every tool that posts something shows the exact content first.
- **The AWS terminal is isolated.** Credentials are set for that one terminal and it isn't restored after restart.
- **Use least privilege.** A `read_api` GitLab token and temporary or read-only AWS credentials cover everything
  except posting MR comments.
- **Tool output is untrusted.** Ticket descriptions, MR text and CI logs come from other people; the confirmation
  step protects against content that tries to steer the model into writing something.

Check your organisation's policy on personal access tokens and AI tools before connecting work accounts.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| DevAssist tools don't appear in Copilot | Use **Agent** mode and enable them in the tools picker. Reload the window after installing. |
| `GitLab returned 401` | Token expired or wrong. Create a new one with `read_api` and save it in the sidebar. |
| `GitLab returned 404 … Check the project path` | Use the full `group/subgroup/project` path, or check your token can see that project. |
| "Couldn't detect a GitLab project from the workspace" | The workspace remote isn't on your configured GitLab host. Check `devassist.gitlab.baseUrl` or name the project. |
| `Jira returned 401` on Cloud | Set the type to **Cloud**, and use your account email with an API token, not your password. |
| `AWS STS returned 403 ExpiredToken` | Temporary credentials expired. Paste fresh ones (all three fields). |
| `SignatureDoesNotMatch` / `InvalidClientTokenId` | The key ID and secret don't match. Re-enter both. |
| Skill isn't used | Make its `description` clearer about when to use it, or ask for it by name. Run **DevAssist: Reload Skills**. |
| Requests fail behind a corporate proxy or with TLS errors | Check VS Code's proxy settings (`http.proxy`, `http.proxySupport`). If your company uses its own certificate authority, point `NODE_EXTRA_CA_CERTS` at its certificate before starting VS Code. |

## Development

### Setup

```bash
npm install
```

Press **F5** to launch an Extension Development Host with DevAssist loaded (the `watch` build runs automatically).

### Scripts

| Script | |
|--------|--|
| `npm test` | Unit tests (`node:test`, TypeScript run directly, no build) |
| `npm run check-types` | Type-check `src/` and `test/` |
| `npm run compile` | Type-check and build `dist/extension.js` |
| `npm run watch` | Rebuild on change |
| `npm run vsix` | Package a `.vsix` |

```bash
npm test
```

```bash
npx vsce package
```

### Project layout

```
src/
├─ extension.ts              composition root: clients, commands, tools, views
├─ auth/secrets.ts           SecretStorage wrapper
├─ clients/                  REST clients: no vscode import, unit-tested
│  ├─ jira.ts
│  ├─ gitlab.ts
│  └─ aws.ts                 SigV4 signer + STS check (no AWS SDK)
├─ tools/                    language model tool registrations
│  ├─ jiraTools.ts
│  └─ gitlabTools.ts
├─ chat/participant.ts       @assist and its tool loop
├─ skills/                   skill loader and devassist_loadSkill
└─ views/connectionsView.ts  Connections sidebar webview
skills/                      built-in skills shipped in the .vsix
test/                        unit tests
docs/ARCHITECTURE.md         architecture and design decisions
```

### Contributing

- Keep `src/clients/` free of `vscode` imports so it stays unit-testable; add tests with every client change.
- New tools need a `package.json` `languageModelTools` entry tagged `devassist` plus `read` or `write`, and a
  `modelDescription` that says what the tool returns and when to use it.
- Every write tool must implement `prepareInvocation` with `confirmationMessages`.
- Return errors from tools as text so the model can recover.

Step-by-step guides for adding a service, a skill or an `@assist` command are in
[docs/ARCHITECTURE.md § Extending DevAssist](docs/ARCHITECTURE.md#9-extending-devassist).

## Architecture

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the system context, component responsibilities, request
flows, security model, design decisions and roadmap.
