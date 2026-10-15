# ADR 0004 — STEP export: hand-written AP214 B-rep instead of OpenCascade WASM

Status: accepted after the phase-6 spike

## Context
PRD §11 suggests OpenCascade compiled to WebAssembly (replicad / opencascade.js) for STEP, with a
feasibility spike.

## Spike result
Placed parts are oriented boxes. A writer that emits `MANIFOLD_SOLID_BREP` / `ADVANCED_FACE` / `PLANE`
entities (AP214) per instance is ~200 lines and needs no 30 MB WASM. A first attempt with faceted
`POLY_LOOP` faces imported as 0 meshes in OCCT; the advanced B-rep imports cleanly: the test suite reads
the Night Stand export back with occt-import-js (129 solids).

## Consequences
- + Fast, server- or browser-side, no native dependency.
- − Only boxes. Profiles, rounded edges or real joinery need a real kernel later.
- The output has been verified with OCCT only; checking it in the factory's CAD tool needs verification.
