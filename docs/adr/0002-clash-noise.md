# ADR 0002 — Clash noise: template joints, moving vs carcass, grouping

Status: accepted (phase 1)

## Context
Box geometry from a BOM overlaps wherever real joinery overlaps (tenons, rebates, applied profiles).
Reporting every overlap hides real problems (PRD §14 risk "false clashes").

## Decision
- Overlaps between **static carcass parts as imported** become template joints (allowed overlap) —
  derived once per import, so later edits that create *new* overlaps still report.
- Overlaps **inside one moving rigid group** (a drawer with its slides) are joints too.
- **Moving vs carcass** overlaps always count: a too-wide drawer must show as a clash, which is why the
  carcass layout never depends on moving-part sizes (CLAUDE.md rule).
- Moving clashes are grouped per assembly so one bad drawer is one finding, not twelve.
- Waivers (accepted risk / false positive) keep the finding visible, marked waived.

## Consequences
The false-positive rate still needs measuring on more products than the Hollan set (phase gate).
