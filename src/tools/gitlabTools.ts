import * as vscode from "vscode";
import { GitLabClient, MrScope, MrState, projectFromRemote } from "../clients/gitlab";

const text = (s: string) => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(s)]);
const MAX = 20_000; // keep results small, since huge outputs blow the context window
const clip = (s: string, max = MAX) => (s.length > max ? s.slice(0, max) + "\n…(truncated)" : s);

/** "group/project" of the workspace's git remote on the configured GitLab host, if any. */
async function workspaceProject(gitlab: GitLabClient): Promise<string | undefined> {
  const ext = vscode.extensions.getExtension<any>("vscode.git");
  if (!ext) { return undefined; }
  try {
    const api = (ext.isActive ? ext.exports : await ext.activate()).getAPI(1);
    for (const repo of api.repositories ?? []) {
      const remotes: { name: string; fetchUrl?: string; pushUrl?: string }[] = repo.state?.remotes ?? [];
      // Prefer origin, then any remote on the GitLab host.
      for (const r of [...remotes].sort((a, b) => (a.name === "origin" ? -1 : b.name === "origin" ? 1 : 0))) {
        const p = projectFromRemote(r.fetchUrl ?? r.pushUrl ?? "", gitlab.root());
        if (p) { return p; }
      }
    }
  } catch { /* git extension disabled or not ready */ }
  return undefined;
}

/**
 * Resolve the `project` input: explicit path/ID wins; "current" or (when required) omitted means
 * the workspace repo. Returns undefined only when not required and not given (= all projects).
 */
async function resolveProject(gitlab: GitLabClient, input: string | undefined, required: boolean): Promise<string | undefined> {
  const p = input?.trim();
  if (p && p.toLowerCase() !== "current") { return p; }
  if (!p && !required) { return undefined; }
  const detected = await workspaceProject(gitlab);
  if (!detected) {
    throw new Error(
      `Couldn't detect a GitLab project from the workspace's git remotes (looking for ${gitlab.root()}). ` +
      "Pass project as 'group/project' or a numeric ID, or use devassist_searchGitLabProjects to find it.");
  }
  return detected;
}

const fail = (what: string, e: unknown) => text(`${what} failed: ${(e as Error).message}`);

export function registerGitLabTools(ctx: vscode.ExtensionContext, gitlab: GitLabClient) {
  ctx.subscriptions.push(
    vscode.lm.registerTool<{ project?: string; state?: MrState; scope?: MrScope; search?: string; targetBranch?: string }>(
      "devassist_listGitLabMergeRequests", {
        prepareInvocation({ input }) {
          return { invocationMessage: `Listing GitLab merge requests${input.project ? ` in ${input.project}` : ""}…` };
        },
        async invoke({ input }) {
          try {
            const project = await resolveProject(gitlab, input.project, false);
            const rows = await gitlab.listMergeRequests({ ...input, project });
            if (!rows.length) { return text("No merge requests matched."); }
            return text(rows.map((m) =>
              `- [${m.project}!${m.iid}](${m.url}) ${m.draft ? "[Draft] " : ""}${m.title}\n` +
              `  ${m.state} · @${m.author} · ${m.sourceBranch} → ${m.targetBranch} · updated ${m.updatedAt.slice(0, 10)}`,
            ).join("\n"));
          } catch (e) { return fail("Listing merge requests", e); }
        },
      }),

    vscode.lm.registerTool<{ project?: string; iid: number; includeDiffs?: boolean }>("devassist_getGitLabMergeRequest", {
      prepareInvocation({ input }) {
        return { invocationMessage: `Fetching merge request !${input.iid}…` };
      },
      async invoke({ input }) {
        try {
          const project = (await resolveProject(gitlab, input.project, true))!;
          const m = await gitlab.getMergeRequest(project, Number(input.iid), { includeDiffs: !!input.includeDiffs });
          const files = m.changes.map((c) => {
            const tag = c.newFile ? " (new)" : c.deletedFile ? " (deleted)" : c.renamedFrom ? ` (renamed from ${c.renamedFrom})` : "";
            return `- ${c.path}${tag}${c.diff ? `\n\`\`\`diff\n${c.diff}\n\`\`\`` : ""}`;
          }).join("\n");
          return text(clip(
            `[${m.project}!${m.iid}](${m.url}): ${m.draft ? "[Draft] " : ""}${m.title}\n` +
            `State: ${m.state} · merge status: ${m.mergeStatus}${m.hasConflicts ? " · HAS CONFLICTS" : ""}\n` +
            `Author: @${m.author} · Assignees: ${m.assignees.map((a) => "@" + a).join(", ") || "none"} · ` +
            `Reviewers: ${m.reviewers.map((a) => "@" + a).join(", ") || "none"}\n` +
            `Branches: ${m.sourceBranch} → ${m.targetBranch}\n` +
            `Pipeline: ${m.pipeline ? `[#${m.pipeline.id}](${m.pipeline.url}) ${m.pipeline.status}` : "none"}\n\n` +
            `Description:\n${clip(m.description || "(none)", 8_000)}\n\n` +
            `Changed files (${m.changes.length}${m.changesTruncated ? ", diffs truncated" : ""}):\n${files}`,
            40_000,
          ));
        } catch (e) { return fail(`Fetching !${input.iid}`, e); }
      },
    }),

    vscode.lm.registerTool<{ project?: string; ref?: string; status?: string }>("devassist_listGitLabPipelines", {
      prepareInvocation({ input }) {
        return { invocationMessage: `Listing pipelines${input.ref ? ` on ${input.ref}` : ""}…` };
      },
      async invoke({ input }) {
        try {
          const project = (await resolveProject(gitlab, input.project, true))!;
          const rows = await gitlab.listPipelines(project, input);
          if (!rows.length) { return text(`No pipelines found in ${project}.`); }
          return text(`Pipelines in ${project}:\n` + rows.map((p) =>
            `- [#${p.id}](${p.url}) ${p.status} · ${p.ref} @ ${p.sha} · ${p.source} · ${p.createdAt.slice(0, 16).replace("T", " ")}`,
          ).join("\n"));
        } catch (e) { return fail("Listing pipelines", e); }
      },
    }),

    vscode.lm.registerTool<{ project?: string; pipelineId: number }>("devassist_getGitLabPipelineJobs", {
      prepareInvocation({ input }) {
        return { invocationMessage: `Fetching jobs for pipeline #${input.pipelineId}…` };
      },
      async invoke({ input }) {
        try {
          const project = (await resolveProject(gitlab, input.project, true))!;
          const jobs = await gitlab.listPipelineJobs(project, Number(input.pipelineId));
          if (!jobs.length) { return text("That pipeline has no jobs."); }
          return text(jobs.map((j) =>
            `- [${j.name}](${j.url}) (job ${j.id}, stage ${j.stage}): ${j.status}` +
            `${j.failureReason ? ` — ${j.failureReason}` : ""}${j.allowFailure ? " (allowed to fail)" : ""}`,
          ).join("\n"));
        } catch (e) { return fail(`Fetching pipeline #${input.pipelineId}`, e); }
      },
    }),

    vscode.lm.registerTool<{ project?: string; jobId: number; lines?: number }>("devassist_getGitLabJobLog", {
      prepareInvocation({ input }) {
        return { invocationMessage: `Reading log of job ${input.jobId}…` };
      },
      async invoke({ input }) {
        try {
          const project = (await resolveProject(gitlab, input.project, true))!;
          const lines = Math.max(20, Math.min(Number(input.lines) || 200, 1000));
          return text(clip(await gitlab.getJobLogTail(project, Number(input.jobId), lines)));
        } catch (e) { return fail(`Reading job ${input.jobId}`, e); }
      },
    }),

    vscode.lm.registerTool<{ project?: string; state?: "opened" | "closed" | "all"; scope?: "assigned_to_me" | "created_by_me" | "all"; search?: string; labels?: string }>(
      "devassist_listGitLabIssues", {
        prepareInvocation({ input }) {
          return { invocationMessage: `Listing GitLab issues${input.project ? ` in ${input.project}` : ""}…` };
        },
        async invoke({ input }) {
          try {
            const project = await resolveProject(gitlab, input.project, false);
            const rows = await gitlab.listIssues({ ...input, project });
            if (!rows.length) { return text("No issues matched."); }
            return text(rows.map((i) =>
              `- [${i.project}#${i.iid}](${i.url}) ${i.title} · ${i.state}` +
              `${i.labels.length ? ` · ${i.labels.join(", ")}` : ""}${i.assignees.length ? ` · ${i.assignees.map((a) => "@" + a).join(", ")}` : ""}`,
            ).join("\n"));
          } catch (e) { return fail("Listing issues", e); }
        },
      }),

    vscode.lm.registerTool<{ search: string }>("devassist_searchGitLabProjects", {
      prepareInvocation({ input }) {
        return { invocationMessage: `Searching GitLab projects for "${input.search}"…` };
      },
      async invoke({ input }) {
        try {
          const rows = await gitlab.searchProjects(input.search);
          if (!rows.length) { return text("No projects matched (only projects you're a member of are searched)."); }
          return text(rows.map((p) =>
            `- [${p.path}](${p.url}) (ID ${p.id}, default branch ${p.defaultBranch ?? "?"})${p.description ? `: ${p.description.slice(0, 120)}` : ""}`,
          ).join("\n"));
        } catch (e) { return fail("Project search", e); }
      },
    }),

    vscode.lm.registerTool<{ project?: string; iid: number; body: string }>("devassist_commentOnGitLabMergeRequest", {
      // Writes: show a confirmation before running.
      async prepareInvocation({ input }) {
        let project = input.project ?? "current";
        try { project = (await resolveProject(gitlab, input.project, true)) ?? project; } catch { /* reported by invoke */ }
        return {
          invocationMessage: `Commenting on ${project}!${input.iid}…`,
          confirmationMessages: {
            title: `Post comment to ${project}!${input.iid}?`,
            message: new vscode.MarkdownString(input.body),
          },
        };
      },
      async invoke({ input }) {
        try {
          const project = (await resolveProject(gitlab, input.project, true))!;
          await gitlab.addMergeRequestNote(project, Number(input.iid), input.body);
          return text(`Comment posted to ${project}!${input.iid}.`);
        } catch (e) { return fail("Comment", e); }
      },
    }),
  );
}
