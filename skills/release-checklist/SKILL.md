---
name: release-checklist
description: Steps to cut and verify a production release, including the change request and rollback. Use when the user asks to release, deploy to prod, or prepare release notes.
---

# Release checklist

1. Ask for the fix version if the user hasn't given one.
2. Confirm all tickets in the fix version are Done:
   use devassist_searchJira with `fixVersion = "<version>" AND statusCategory != Done`.
   If anything comes back, list it and stop until the user decides what to do.
3. Check the last pipeline run on the release branch is green.
4. Draft release notes using `templates/release-notes.md`
   (load it with devassist_loadSkill, file "templates/release-notes.md").
   Group tickets by type and link every key.
5. Raise the change request with the release notes attached.
6. After deploying, run smoke tests and watch error rates for 30 minutes.

If anything fails after deploy, follow `rollback.md` (load it with devassist_loadSkill, file "rollback.md").
