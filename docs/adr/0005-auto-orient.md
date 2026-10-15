# ADR 0005 — Auto-orientation of panels whose W and L look swapped

Status: accepted (phase 1)

## Context
Workbooks list T/W/L (Tebal/Lebar/Panjang) but people swap W and L. A swapped back panel renders sideways
and produces false clashes.

## Decision
After role inference, compare each part's world extents with what its role expects inside the product
envelope; swap W/L when that fits much better or when the part would exceed the envelope. Side rails are
skipped (they are longer than the product by design). The swap is recorded as
`attrs.axisSource = 'auto-oriented'` and listed in the import report (e.g. Dresser back 851 × 1555:
error 56% → 8%), never silent.

## Consequences
A dictionary Axis Map always wins over the heuristic; filling Axis Maps reduces reliance on it.
