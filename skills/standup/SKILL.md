---
name: standup
description: Write a standup update from the user's open Jira issues. Use when the user asks for a standup, status update or "what am I working on".
---

# Standup

1. devassist_searchJira with `assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`.
2. Write three bullets: **Yesterday**, **Today**, **Blockers**. Base them on status and recent updates;
   ask the user if it's unclear what changed.
3. Link every ticket key. Keep it short enough to read aloud in 30 seconds.
