# Design brief: Editor actions v1 (selection → edit)

Handoff for the Claude Design project **"AI image generation studio mockup"** (`latteart Studio.dc.html`). Goal: extend the canonical mockup with latteart's first _editor_ surfaces — what happens after a layer is selected — before any implementation starts.

## Why now

Competitive research on Recraft (2026-07-06) showed the gap between "generator with a canvas" and "editor" is the select-an-image → act loop: remix, background edits, outpaint, variations. latteart's base loop (prompt bar → generate → layer) is shipped; this brief covers the next interaction layer.

## Current state (don't redesign)

- Mockup has 4 screens: studio idle, studio generating, settings dialog, design tokens. Prompt bar (780px) already has provider, size, and style pills.
- Shipped app: topbar; Konva canvas with a transformer on the selected layer; right **layer panel, 288px** (thumb, name, opacity slider, hide/delete per row); floating bottom prompt bar; settings dialog. Dark theme tokens: bg `#0a0b0d`, surfaces `#101114/#17191d/#1e2126/#212429`, accent `#eea145`, Geist/Geist Mono, radii 6/8/12/999.
- Core principle that constrains everything here: **non-destructive layers**. Every editing action produces a _new_ layer; the source layer is never mutated.

## Design task 1 — where do actions live?

Recraft uses a right inspector panel that appears on selection. latteart's right side is already the layer panel, so explore two options and pick one canonical:

- **A (recommended starting point):** an "Actions" section that appears in the layer panel when a layer is selected — below the header, above the rows, or docked at panel bottom. Keeps one right-side surface, no canvas occlusion.
- **B:** a compact floating action toolbar anchored to the selected layer's transformer (icons + labels on hover), with drill-ins opening as a floating card.

Whichever wins, drill-in sub-flows (e.g. Remix) need a consistent pattern: header with back arrow + action name, controls, primary button (matches Recraft's drill-in pattern, works in both A and B).

## Slice-1 actions (design all five)

All are feasible with the current Gemini provider (text-instructed editing, no mask input):

1. **Remix** — img2img on the selected layer. Drill-in: similarity-to-original slider (labeled ends, e.g. "close" ↔ "reinvent"), prompt field prefilled with the layer's source prompt, style pill override, Generate. Result = new layer.
2. **Remove background** — one-click, no drill-in. Result = new layer with transparency (thumb should show checkerboard).
3. **Change background** — drill-in with a single prompt field ("describe the new background") + Generate.
4. **Variations** — drill-in: count (1–4), Generate. Results = sibling layers.
5. **Utilities on selection** — Duplicate layer, Export layer (PNG). Small/secondary, same surface.

## States to cover

- **Action in progress on an existing layer**: unlike txt2img (dashed new frame), the source layer stays visible; show progress on/near it (e.g. dimmed layer + progress ring, and the existing progress bar in its layer-panel row). Prompt bar keeps its existing running state.
- **Result arrival**: new layer lands above the source, selected. Consider a subtle "derived from ⟶" provenance hint in the layer row (optional, explore).
- **Empty/blocked**: action pressed with provider unavailable → same "needs key" affordance as the prompt bar (opens settings).

## Out of scope for v1 (but leave room)

- **Edit area / mask inpainting** — needs a mask-capable provider (OpenAI edit endpoint or Recraft API, later). Reserve a slot in the actions surface so v2 doesn't reshuffle the layout.
- **Outpaint/expand** — canvas-native (drag handles beyond image bounds + optional prompt + Expand button, per Recraft). Design _may_ sketch the entry point but the full mode is v2.
- Upscale, vectorize, video, mockups, style marketplace: not in the mockup yet.

## Reference patterns (from Recraft hands-on, adapt don't clone)

- Selection opens a persistent action list; each complex action is a drill-in panel with back-arrow header.
- Remix exposes a stepped similarity slider with a text label for the current stop ("Quite similar").
- Long action lists get noisy — latteart v1 has 5 actions, keep them all visible, no overflow menu.
- Recraft attaches the clicked image as a reference chip in the prompt bar; latteart's equivalent decision (does selecting a layer change the prompt bar?) is explicitly **out of scope** here — prompt bar behavior stays as-is in v1.

## Deliverables

New screens in `latteart Studio.dc.html`, same tokens and 1440-ish artboard as existing screens:

1. **Studio — layer selected, actions visible** (the chosen A/B layout)
2. **Remix drill-in open** (slider + prefilled prompt)
3. **Action in progress** on an existing layer (canvas + layer panel state)

Update the design-tokens screen only if new primitives emerge (slider variant, checkerboard swatch).
