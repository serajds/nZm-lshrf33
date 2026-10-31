---
name: Project activity update reminders
description: User-approved timing, manager control, and personal update attribution for project reminders.
---

Show the activity-update reminder once per Libya calendar day when the member opens a project. Only the project manager (or existing system administrator authority) controls enabling or disabling it per project member; it is not a member self-service preference.

**Why:** The user explicitly chose daily on-project-open reminders and manager-only control.

**How to apply:** Display the member's name and their own latest recorded change to activity data in that project, not another member's changes, report edits, or simple page views. If there is no record, say no previous update is recorded. A reminder never grants permission to edit activities.

Automatic project notices must appear one at a time without interrupting an already visible notice. A reminder claimed for the day but still waiting must remain pending across project sub-page navigation until dismissed; pending state is private to that member, project, and day.

**Why:** The update reminder and the quick-view notice can become ready independently. Overlapping modal dialogs compete for focus, and discarding a claimed-but-unseen reminder would incorrectly consume the daily reminder.

**How to apply:** Use non-preempting arrival order. Run the quick-view countdown only while that notice is actually visible, preserving its budget during mouse/keyboard interaction and hidden-tab time. Do not transfer queued notices across accounts.
