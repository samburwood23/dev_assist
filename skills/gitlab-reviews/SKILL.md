---
name: gitlab-reviews
description: Summarise GitLab merge requests waiting for the user's review and their own open ones. Use when the user asks what to review, about their MRs, or what is blocking a merge.
---

# Merge request reviews

1. devassist_listGitLabMergeRequests with `scope: reviews_for_me`, then again with `scope: created_by_me`.
2. For anything unclear, devassist_getGitLabMergeRequest to check pipeline status, conflicts and draft state.
3. Output two lists, **To review** and **Mine**. One line per MR: link (group/project!123), title,
   pipeline status, and anything blocking a merge (draft, conflicts, failed pipeline, missing approvals).
4. Put failed pipelines and conflicts first. Offer to read the failing job log with devassist_getGitLabJobLog.
