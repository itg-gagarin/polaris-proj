# ADR 0001 — Custom markup layer instead of embedding Excalidraw

Status: accepted (phase 2)

## Context
PRD §11 proposes the Excalidraw component for markup with our own frame layer. Our markup must pin to
parts inside live 3D and sheet frames (it moves with the part), bind arrows to frames, live in the same
Yjs document as the frames for multiplayer and per-user undo, and turn meeting ink into private notes.

## Decision
Draw markup ourselves: an SVG layer in board coordinates, shapes rendered with roughjs (the library
Excalidraw uses for its hand-drawn look), Excalidraw's single-key tool map (Q H V R D O A L P T N E).
Frames register a *projector* (part → board point) and a *picker* (board point → part) so pins follow
parts and new markup pins where it lands.

## Consequences
- + One document model, one undo stack, pins that work in 3D and sheets.
- − We do not get Excalidraw's text editing, libraries, image tools or polish. Image markup and text
  wrapping are basic. Revisit if users miss Excalidraw features more than pinning.
