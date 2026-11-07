# UI v009 — springy avatar click

Status: Checked and frozen for user review.

Direct avatar activation now plays the restored Springy tap from pixel-motion/v007 while retaining the open/close toggle. It returns to the three-pose standing loop after the reaction. Composing a message still uses the separate Tiny hello; receiving and answer reactions retain their current behavior.

The panel layout, back-to-questions arrow, Dismiss/Undo flow and panel motion remain from UI v008. Narrow/wide checks confirm repeated clicks settle to the correct open state, preserve expanded context and the selected detail, keep the hitbox fixed and respect reduced motion. The shared click source is copied from pixel-motion/v007. See ../../pixel-motion/v007/evidence/checks.json.
