---
name: incident-triage
description: First-response procedure for a production incident - severity, owner, comms and ticket. Use when the user reports an outage, alert, error spike or says "incident".
---

# Incident triage

1. Establish impact: who is affected, since when, and is it getting worse. Ask if unknown.
2. Assign a severity:
   - SEV1: customer-facing outage or data loss
   - SEV2: major feature degraded, workaround exists
   - SEV3: minor or internal-only impact
3. Search for an existing incident ticket before creating anything:
   devassist_searchJira with `type = Incident AND created >= -1d ORDER BY created DESC`.
4. Name an incident lead and a comms owner. For SEV1/SEV2 post an update every 30 minutes.
5. Mitigate first (rollback, feature flag, scale up), diagnose second.
6. Once resolved, draft a timeline as a comment on the incident ticket and propose a postmortem date.
   Only post the comment after the user confirms.
