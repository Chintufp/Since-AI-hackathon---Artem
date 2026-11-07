# Pixel motion v007 — restored springy tap

Status: Checked and frozen for user review.

The user identified that the earlier satisfying click motion had disappeared. The v003/v004 click used a ten-frame sequence at 15fps: round → settle → squash → settle → reach → round → reach → round → round → round. The v006 refinement replaced it with a gentle low/high settle and small wave.

This version restores that ten-frame rhythm as **Springy tap**, using the current compact body's neutral, crouch, deep and stretch poses. It lasts 0.67 seconds and has no extra limbs or props. The existing **Tiny hello** remains a separate selectable wave. Direct avatar clicks select and restart Springy tap; it is also the initial selected study. Reduced motion shows its still pose.

The action uses the same compact drawing kit. All previous core acts are unchanged apart from adding this new act; prop and state modules are unchanged. The player caches its OS reduced-motion preference from events, matching the integrated UI's existing handling.

Checks at 736px and 320px cover direct-click interruption, repeated clicks with no queued completion, separate Tiny hello selection, reduced motion, and the same reaction in UI v009. The deep frame measures 36×16 source pixels; both rebounds measure 32 pixels high. Five actual pose rasters were inspected. There were no JavaScript errors. Evidence is in evidence/checks.json and evidence/poses.json.
