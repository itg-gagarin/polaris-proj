# Golden file changes

Every update of fixtures/expected must carry a reason (CLAUDE.md).

- 2026-10-15: Initial golden results for the Hollan House fixture (11 products + 2 bed sets)
- 2026-10-16: New checks face-frame-gap (horizontal face rail/profile not reaching the legs: Night Stand, Chest, Dresser 41 mm each end) and drawer-pull (drawer without knob or pull: Dresser 2 of 8); knobs now go to the narrowest drawers and pulls to the widest ones instead of stacking on the first drawers
- 2026-10-16: Front frame corners: new inferred assumption faceFrameCorners = butt-to-legs draws horizontal face profiles/rails leg to leg so the front has no holes; face-frame-gap now reports the BOM length vs the drawn length (Night Stand 489 vs 571, Chest 794 vs 876, Dresser 1505 vs 1587) and depends on that assumption
