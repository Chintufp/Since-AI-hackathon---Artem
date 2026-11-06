# UI v008 — back to questions

Status: Checked and frozen for user review.

The question header now has a back arrow returning to the Questions list. Dismiss lives in the secondary action row below Yes/No, alongside Not sure and Later.

Returning to the list leaves the question unanswered and focuses its list entry. Opening that same question preserves its expanded context and selected detail; choosing another question starts with its context collapsed. Dismiss still records an explicit dismissal and provides Undo. Avatar close/open, standing poses and panel motion are preserved.

Browser checks passed at 736px, 320px and 320px with touch targets: back navigation leaves answers/deferred state unchanged, focus returns to the current question, context is preserved, Dismiss/Undo work, the avatar anchor stays fixed, controls do not overlap, and there are no runtime errors or horizontal overflow. Actual wide and touch screenshots were inspected. See evidence/checks.json.

Local design preview only.
