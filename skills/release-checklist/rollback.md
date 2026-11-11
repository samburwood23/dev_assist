# Rollback

1. Announce the rollback in the release channel with the change request number.
2. Redeploy the previous release tag through the pipeline; do not hotfix forward under pressure.
3. Confirm smoke tests pass and error rates return to baseline.
4. Comment on each ticket in the release with what happened. Use devassist_addJiraComment only after the user confirms.
5. Open a follow-up ticket for the root cause.
