# Workflow Node Graph

Status: Accepted. Approved 2026-11-25; P1 to P4 built and owner-accepted on 2026-11-28.

Approval conditions (planner): render every file string as plain text (no
`dangerouslySetInnerHTML`, no markdown to HTML without the app's own sanitiser)
and never in a selector, class name or URL; accept group colours only as plain
hex; list and test every `keydown` listener that can fire while the graph is open
(viewer, App-level shortcuts, gallery, slideshow, search hotkeys); keep the portal
owned by `WorkflowInspector` and never log node text, prompts or raw JSON; state
the P1 caps; run the perf gate only on a copied profile; send DECISION NEEDED if
roving focus passes about 300 lines or a second pass.

Issue: [#452](https://github.com/AsuraAce/ambit/issues/452). Picked design: UX-L267
"Full canvas" (UI-UX Vault, gallery UX-G30). Posture: Assure (new Rust command,
viewer keyboard ownership, privacy gate).

## Contents

1. Outcome and acceptance
2. Decided (not reopened here)
3. Data contract
4. Drawing approach
5. Privacy
6. Where it lives
7. Tokens and lint
8. Packages
9. Risks and non-goals

## 1. Outcome and acceptance

From an image's Workflow tab the user opens a full-screen, read-only node graph of
the ComfyUI workflow saved in the file, drawn as V1 Full canvas, and Escape returns
to the viewer. The ComfyUI work is accepted when:

- every saved workflow in the fixtures opens with its saved positions, sizes,
  groups, folded nodes, reroutes, notes and bypassed/muted marks;
- an API-prompt-only file opens in an automatic left-to-right layout;
- subgraphs open as their own level, as ComfyUI shows them;
- 500 nodes pan and zoom without visible stutter in the desktop app (gate in P2);
- nothing is shown for a masked item before reveal, exactly as the Workflow tab;
- the owner's guided smoke on the test profile passes (P4).

## 2. Decided (not reopened here)

View only. V1 Full canvas: all nodes with settings, coloured foldable groups,
wires coloured by type, minimap, F fits, / searches, click a node for the side
panel (settings, inputs from, outputs to, raw JSON with copy), node folding,
bypassed and muted marks. Floating image window (move, resize, fold). Quiet
colours default, Familiar optional. Bundled wires default; Wires menu with
Curved, Straight, Angled, Hidden, Bundled, width and moving dots. Saved positions
when present, automatic left-to-right layout otherwise, Tidy / As saved switch.
No phone layout. ComfyUI first, InvokeAI as a later package. Ambit's look
(dark zinc, Inter, sage selection).

## 3. Data contract

### What the current report lacks

`ComfyWorkflowGraphReport` (`src-tauri/src/metadata/comfyui/workflow_inspector.rs`)
is built on the normalizer's **flattened evaluation graph**: subgraphs are
expanded into `30:19`-style ids, bypassed subgraph instances are removed, and only
ids, types, titles, stringified inputs and edges survive. It cannot draw V1:

| Need                      | In report today     | Saved workflow (`workflow` chunk)                                                                                                              | API prompt (`prompt` chunk)               |
| ------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Position, size            | no                  | `pos`, `size` (array or `{0,1}` object)                                                                                                        | none: automatic layout                    |
| Groups                    | no                  | `groups[].title, bounding, color`; also inside each subgraph definition                                                                        | none                                      |
| Input ports, names, types | name only, on edges | `inputs[].name, type, link, widget.name, label`                                                                                                | linked inputs only; type inferred (below) |
| Output ports, types       | no                  | `outputs[].name, type, links`                                                                                                                  | slot numbers from links; type inferred    |
| Link type                 | no                  | `links[][5]` or `links[].type`                                                                                                                 | inferred                                  |
| Widget names              | `widget_N`          | `inputs[].widget.name` where present (103 of 150 fixture workflows); else value-matched against the prompt node of the same id; else "Value N" | the `inputs` key                          |
| Bypass / mute             | no                  | `mode` 4 / 2                                                                                                                                   | absent (the prompt omits them)            |
| Folded                    | no                  | `flags.collapsed`                                                                                                                              | no                                        |
| Reroute, Note             | as ordinary nodes   | `type` `Reroute`, `Note`, `MarkdownNote`                                                                                                       | no                                        |
| Subgraph levels           | flattened           | `definitions.subgraphs[]` with own nodes, links, groups, `inputNode`/`outputNode` boundary positions                                           | flattened `a:b` ids                       |
| Raw node JSON             | no                  | the node object                                                                                                                                | the node object                           |

Fixture profile (158 chunk files, measured with a script over
`tests/fixtures`): 150 saved workflows, 139 with positions, 109 with subgraph
definitions, 42 with groups, 23 with folded nodes, 21 with bypassed nodes, 2 with
reroutes, 128 with notes, 17 files with both chunks, 5 prompt-only. Root graphs
have 6 nodes median, 30 max; real community workflows reach several hundred.

### Decision: a sibling command, not an extended report

Add `inspect_workflow_canvas(chunks) -> WorkflowCanvasReport` in a new
`src-tauri/src/metadata/comfyui/workflow_canvas.rs`. The canvas must mirror the
**file as saved, per level**, while the existing report is the flattened
evaluation graph; widening that report would mix two graphs with different ids,
and the bypass removal it relies on is wrong for drawing. The Rust side stays the
single parser: TypeScript does not re-read the JSON.

- Reuses the existing helpers (`value_id`, edge parsing for array and object
  links, `is_muted`/`is_bypassed`, `parse_prompt_chunk`, `compare_node_ids`) by
  making them `pub(crate)`; no behaviour change to the normalizer.
- Uses the existing `ComfyEvaluator` output selection unchanged and maps
  `selected_output_node_ids` / `selected_branch_node_ids` onto canvas node paths.
  The normalizer namespaces `instance:local`, which is exactly the canvas path
  (level of instance `30`, node `19`), so the mapping is a split, not a guess.
- Picks the **saved workflow** when it parses (layout, groups, types, bypassed
  nodes), the API prompt otherwise. The Workflow tab's existing report keeps
  preferring the prompt for evaluation; both stay valid because they answer
  different questions.
- Tool-neutral names (`WorkflowCanvas*`) so the InvokeAI package fills the same
  shape and the UI needs no second renderer.
- Bounded, in work and in output size, not only in node count:
    - a chunk over 32 MiB is ignored;
    - per level, at most 2,000 nodes and 10,000 links;
    - 256 subgraph definitions;
    - 10,000 nodes and 50,000 links in all;
    - per node, 256 inputs, 256 outputs and 256 setting values. A slot index of
      256 or more drops its link: a slot number never sizes anything, and API
      prompt outputs exist only for slots a wire uses, never padded up to it;
    - 50,000 ports, settings and groups in all;
    - a setting value is cut at 64 KiB, with 16 MiB of setting text in all;
    - names, titles and types are cut at 256 bytes, and a node whose id is longer
      is dropped;
    - raw JSON: 256 KiB per node and 8 MiB in all.

    Definitions are listed once each and never expanded into each other, so
    nesting depth cannot multiply the output (the evaluator keeps the normalizer's
    depth cap of 16). Setting names and subgraph-output slots are found through
    maps, so the work stays linear. Hitting a cap sets `truncated` and the UI says
    so. Malformed or cyclic input is skipped, never a panic. The command runs on a
    blocking thread, off the async runtime's workers.

- Read-only. It never writes metadata or the database, never changes the stored
  or archival workflow, and does not bump the parser version.
- Every string from the file is untrusted. The report passes text on as saved;
  the UI renders it only as plain text and never puts it into a selector, class
  name or URL. A group colour is kept only when it matches `#` plus 3 to 8 hex
  digits.

Shape, as built in P1 (`src/bindings.ts` is generated from it):

```text
WorkflowCanvasReport { tool: "comfyui", source: none | workflow | api_prompt,
  hasSavedLayout, truncated, root: Level, subgraphs: [{ id, name, level: Level }],
  selectedOutputPaths, selectedBranchPaths: string[][], outputAmbiguous }
Level { nodes, links, groups }
Node { id, nodeType, title, kind: node | reroute | note | subgraph |
  subgraph_input | subgraph_output, subgraphId?, mode: active | muted | bypassed,
  collapsed, pos?: {x, y}, size?: {width, height}, inputs, outputs, widgets,
  rawJson? }
Port { slot, name, label, dataType, typeInferred, linked }
Widget { name?, value, isLongText }
Link { fromNode, fromSlot, toNode, toSlot, dataType, typeInferred }
Group { title, pos, size, color? }
```

A subgraph's own inputs and outputs are drawn as two boundary nodes in its level
(`subgraph_input` with the inputs as its outputs, `subgraph_output` the reverse),
as ComfyUI draws them. A setting that can take a wire is an input port only while
a wire is attached. Paths are the subgraph instance ids followed by the node id;
an API prompt has one flat level, so its paths are the single prompt id (`30:3`).

Setting names: the file's `inputs[].widget.name` are used only when there is
exactly one for each saved value other than the seed's control value. Many
files name only the settings that can take a wire, and pairing those names with
the first values names the wrong ones. Otherwise each value is matched against
the prompt node with the same id, and a value nothing matches stays unnamed.
Subgraph levels get no prompt matching, because several instances can share
one definition with different values.

What P2 must tolerate:

- positions, sizes and group bounds are finite but may be negative or huge, so
  the renderer clamps them before layout and the minimap;
- a link may name a slot its node does not list, so the renderer draws it to
  the node's edge rather than failing.

API-prompt type inference: a small table of core input names (`model`, `clip`,
`vae`, `positive`/`negative`/`conditioning`, `samples`/`latent_image`,
`image`/`images`/`pixels`, `mask`, `upscale_model`, `control_net`) sets the link
and port type with `type_inferred: true`; anything else is `*` and draws grey.
Widget values are formatted in Rust exactly as the Workflow tab's
`display_value` does, so the two views never disagree on a value.

Bindings: `pnpm run bindings:generate`, checked with `bindings:check`.

## 4. Drawing approach

Two candidates, measured with a spike (scratch Vite 8 + React 19 app, outside the
repo): a synthetic ComfyUI-like graph (two-pass SDXL pipelines repeated, 1.7 wires
per node, 0 to 7 setting rows per node), built with `vite build`, run in the
Chromium browser pane, 2 runs each, numbers are the range.

- **A. `@xyflow/react` 12.12.1** (MIT) with `@dagrejs/dagre` 1.1.8 (MIT).
- **B. Port the piece's renderer**: absolutely placed HTML nodes, one SVG wire
  layer, pan and zoom as one CSS transform on a world element; the same dagre.

| Nodes | dagre layout | B mount incl. layout | B per viewport update | A per viewport update |
| ----- | ------------ | -------------------- | --------------------- | --------------------- |
| 100   | 30–38 ms     | 38–51 ms             | 0.03–0.04 ms          | 0.31–0.45 ms          |
| 300   | 132–137 ms   | 160–175 ms           | 0.03 ms               | 0.66–0.78 ms          |
| 500   | 272–342 ms   | 322–381 ms           | 0.04 ms               | 1.3–1.8 ms            |

How measured: mount is render start to committed DOM with style and layout forced;
a viewport update is applying one pan+zoom step (A: `setViewport` in `flushSync`)
plus forced style and layout, 180 steps. Paint and real frame rate were **not**
measured: the pane was hidden, which throttles animation frames. For the same
reason A's mount could not be measured reliably (xyflow draws edges after an
asynchronous ResizeObserver pass). DOM size at 500 nodes: B 4,512 elements,
A 5,625 before edges. A longest-path rank layout (the piece's) takes under 1 ms at
500 nodes but stacks columns with many crossings; dagre is worth its cost.

|                  | A. xyflow                                                                                                                                                                                                                                           | B. Port                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Picked look      | Nodes fine. Bundled wires, groups drawn above wires, wires to folded groups and far-zoom titles are whole-graph drawing: xyflow's per-edge model does not help, so they would go in a custom `ViewportPortal` layer anyway, plus overriding its CSS | Already built and approved by the owner in the piece; port the behaviour, not the code verbatim            |
| Speed (above)    | fine at 500; 30–40× more work per viewport update                                                                                                                                                                                                   | fine at 500                                                                                                |
| Bundle (gzip)    | 59.9 KB JS + 2.6 KB CSS, plus dagre 13.9 KB                                                                                                                                                                                                         | spike 0.9 KB; full view estimated 15–25 KB, plus dagre 13.9 KB                                             |
| Licence, offline | MIT, bundled                                                                                                                                                                                                                                        | ours; dagre MIT, bundled. `elkjs` rejected: EPL-2.0, ~1.4 MB                                               |
| Keyboard, focus  | built in: focusable nodes, Enter selects, aria labels                                                                                                                                                                                               | we build it (roving focus over nodes, Enter opens the panel, arrows follow wires); scoped in P3 with tests |
| Upkeep           | a dependency on the monthly Dependabot batch; its editing features unused                                                                                                                                                                           | about 1.5k lines of our own TS; geometry and layout are pure functions with vitest coverage                |

**Recommendation: B, port the piece's renderer** into a React/TypeScript module,
with dagre running in a Web Worker (like `metadata.worker.ts`) so 300 ms of layout
at 500 nodes never blocks the viewer. xyflow's strengths are editing (drag,
connect, select), which this view never uses, and the look the owner picked lives
in the parts xyflow leaves to us. Revisit A if P2's keyboard and focus work
grows past its estimate. The whole graph view is a lazy-loaded chunk, so neither
choice affects startup.

## 5. Privacy

The Workflow tab has no masking of its own: its gate is the viewer's. In
`ImageViewer.tsx` the viewer closes while the privacy mask index is pending
(`privacyExposureBlocked`) and shows `MaskedViewerGate` instead of the whole
viewer, sidebar included, while a masked item is not revealed
(`itemExposureBlocked`, line 158). `VideoViewer.tsx` does the same with
`revealed` (line 95). Once revealed, the Workflow tab shows prompts and values in
full.

The graph follows exactly that rule by construction: it is opened from, and
rendered inside, `WorkflowInspector`'s subtree (a portal still owned by that
component), so it unmounts whenever the gate closes the viewer or the item changes.
In addition:

- no graph content is persisted: only view preferences (palette, wire shape,
  width, dots) are saved; positions after Tidy, search text and folds are
  transient;
- the floating image uses the viewer's already-revealed display source, never a
  new file read, and for videos the poster;
- a test asserts the graph is not in the DOM for a masked, unrevealed item and
  unmounts when the item becomes masked (privacy index pending).

## 6. Where it lives

- The Workflow tab header gets a **Graph** button (icon and label, designed
  tooltip). It opens a full-screen layer over the viewer. Escape closes it and
  returns focus to the button; inside a subgraph level, Escape first goes up one
  level.
- **Keyboard ownership (blocking risk):** the viewer binds Space (close),
  Delete/Backspace (delete the image), F (favourite), P, I, Z and the arrows.
  While the graph is open the viewer handler returns early, as it already does
  for `ai.modalOpen`, and the graph owns the keys. Tests prove Delete and F do
  nothing to the image while the graph is open.
- No workflow: the Workflow tab is already hidden once Ambit knows there is none.
  When the tab shows but the canvas report is empty (`source: "none"`), or the
  tool is not ComfyUI, the Graph button is disabled with a tooltip saying why. No
  InvokeAI graph until P5.
- Subgraph instances show an Open affordance; opening one shows its level with a
  breadcrumb (Workflow › name); the boundary input and output appear as ports.
- The graph view is always a dark canvas, like the media canvas
  (`docs/design-system.md`), including its panels and menus.

## 7. Tokens and lint

- Wire-type colours (model, clip, vae, conditioning, latent, noise, image,
  upscale, mask, control, metadata, any) and the ComfyUI group presets go into
  `tailwind.config.js` as custom properties, Quiet in the base layer and Familiar
  under a `.wire-familiar` class on the graph root. Values come from the piece
  (Familiar is ComfyUI's palette). Components use `var(--wire-*)` only.
- Dimming and lit states use `opacity` or `color-mix(..., var(--wire-*) ...)`,
  never `rgb()`.
- A group's own colour from the file is user content (design-system
  "Exceptions"): Familiar draws it from data through an inline style with a
  comment naming that section; Quiet maps the eight ComfyUI presets to tokens and
  unknown colours to a neutral token.
- Stylelint stays as is. Found while planning: its config bans `rgb()` outright
  (`function-disallowed-list`) where the shared baseline allows
  `rgb(var(--x) / a)`; that is a baseline gap for its own work package, not this
  change.

## 8. Packages

Each package is one draft PR with `Refs #452`, the narrow checks, then
`pnpm run lint`, `typecheck`, `test:run`, and for Rust `lint:rust`, `test:rust`.

### P1 · Canvas data contract (Rust, no UI)

Adds `workflow_canvas.rs`, the command, Specta registration and regenerated
bindings.

Acceptance:

- Fixture tests: saved positions and sizes (array and object `size`), groups at
  root and inside a subgraph, `mode` 2 and 4, `flags.collapsed`, Reroute, Note,
  typed ports and links, widget names from `widget.name`, from prompt value
  matching, and the "Value N" fallback.
- Subgraph: `02_qwen_Image_edit_subgraphed` and the Krea fixture give a root
  level with an instance node, a subgraph level with its nodes, groups and
  boundary ports; nested and cyclic definitions stay bounded.
- API prompt: Krea's prompt only gives no positions, inferred types marked, and
  the same selected output and branch as `inspect_comfyui_workflow_graph`,
  mapped to paths.
- Both chunks: the saved workflow is drawn; bypassed nodes absent from the prompt
  are still present.
- Malformed, empty and over-limit inputs return `source: "none"` or
  `truncated: true` without panics; output is deterministic.
- Existing workflow inspector and normalizer tests unchanged and passing.

### P2 · Graph view and canvas

Lazy-loaded `src/features/viewer/workflowGraph/`: Graph button, full-screen layer,
Escape and keyboard ownership, the canvas (nodes with all settings, typed ports,
wires coloured by type, Bundled and Curved shapes, groups with fold, node fold,
bypassed and muted marks, reroute dots, notes, far-zoom titles), pan and zoom,
F to fit, the dagre worker for API prompts, Tidy / As saved, Quiet and Familiar
tokens.

Acceptance:

- vitest: saved-position mapping, layout worker contract, bundled-wire geometry
  (shared trunk per output; an index, not the piece's per-wire scan), fit bounds,
  group membership and fold rerouting, keyboard ownership (Delete, F, Space,
  arrows do nothing to the image while open), privacy gate tests from section 5.
- Desktop perf gate: a 500-node synthetic workflow in `pnpm run app:dev`, pan and
  zoom held for 5 s, p95 frame under 20 ms in the WebView2 performance panel;
  numbers go in the PR. If it fails, viewport culling of off-screen nodes lands
  in this package.
- Visual check in the app against the piece: first view, a folded group, Tidy.

### P2b · Look polish (from the owner's look pass)

The owner looked at P2 on 2026-11-26. This slice is its own PR, after #619
merges and before P3, because P3's minimap and menus are drawn over the same
canvas. It changes how the graph is drawn, not what it shows. The motion follows
the UI-UX Vault: the `out` curve, nothing over about 300 ms for a view change,
and none of it under reduced motion.

1. **Near/far switch.** Today the switch at 50 % swaps the HTML for the far
   canvas in one frame. Group titles also jump in size, because far mode draws
   them at a fixed 15 px on screen while near mode draws them 15 px in the
   world, which is 7.5 px on screen at 50 %. Proposal:
    - cross-fade for 160 ms. Both layers paint during the fade, and the HTML is
      hidden again once it ends, so a pan in far mode stays cheap;
    - add a small band around the switch: enter far mode at 50 %, leave it at
      55 %, so a wheel resting near the line does not flicker;
    - make far titles start at the near size at the switch and grow from there,
      with the cap from item 4, so nothing jumps.
2. **Folding a group.** Today it is instant. Proposal: a 220 ms change, with
   the box easing to the folded size and back. Members fade and shrink toward
   the box; they stay mounted until the fade ends. The rerouted wires fade out
   and back in, the way Tidy's move already fades them. Folding a single node
   gets the same height ease.
3. **Group titles that nodes cover.** The far view now stacks like the near
   view, so a title under a node is hidden in both. From mocks on 2026-11-26
   the owner first picked a tab on the group's top edge with an in-band
   fallback; after seeing both in the app the same day, they chose the in-band
   pill for every group. The title is a pill inside the group's top band, in
   the group's colour, with a frosted backing, its node count and the fold
   control. It draws over the nodes, at the first spot along the band with no
   node under it, or failing that no node title under it, or else at the left.
4. **The far-out level** (Fit on big graphs, such as Lily with 308 nodes).
   Today every zoom below 50 % draws the same thing, and at 10–20 % the node
   titles are noise and the group titles grow without limit. Proposal: two far
   levels, picked by scale.
    - _Far, 50 % down to about 22 %_: boxes, wires, and node titles where the
      title is at least 10 px on screen. The node type line goes below 35 %.
    - _Overview, below about 22 %_: no node text at all. Nodes become soft
      filled shapes, tinted toward their group's colour, without borders. Wires
      drop to about 40 % opacity and stay bundled. Group titles are the only
      text. Each is capped at 13 to 18 px on screen and must fit its group's
      width on screen, or it is shortened or left out. A title that would
      overlap a bigger group's title is left out, so bigger groups win. Groups
      still named ComfyUI's default "Group" show no title here, because the name
      tells nothing.
    - In both levels, the selected output nodes keep their titles, so the eye
      has an anchor. P1's report already marks them (`selectedOutputPaths`); it
      does not mark the root sampler, so the sampler gets no anchor.
    - The exact break points are tuned on Lily, the SDXL file and synthetic-500.
5. **"Looks the cheapest" at Fit** is the same problem as item 4. The overview
   level is the fix. The owner's next look at Fit on Lily is the acceptance.

Acceptance:

- vitest:
    - the level picked by scale, including the switch band;
    - the title cap, the fit-or-drop rule and the overlap rule;
    - default "Group" titles dropped in overview;
    - reduced motion turns every transition off;
    - group fold keeps the members mounted until the fade ends.
- The perf gate from P2 runs again on synthetic-500, with the cross-fade frames
  included.
- A check against the Vault's Quality bar on screenshots at a real window size.
- The owner looks at Lily and the SDXL file: switch, fold, Fit.

### P3 · Reading the graph

Side panel (settings, inputs from, outputs to, raw JSON with copy; clicking a
link flies to that node), `/` search over titles and values, minimap with drag,
the Wires menu (Curved, Straight, Angled, Hidden, Bundled, width, moving dots),
the Colours menu, the Types list, subgraph levels with breadcrumb, keyboard focus
(Tab into the canvas, arrows between connected nodes, Enter opens the panel),
saved view preferences in `AppSettings`.

Carried over from the P2 smoke:

- A MarkdownNote shows its text as raw markdown. Render it as markdown, still
  as plain text with no HTML, or show it as a note without the markdown marks.
- A setting the file left unnamed shows as "Value N". Take the name from the
  node's input list where the file has one.

Acceptance: vitest for search matching, wire-shape geometry for all five shapes,
Hidden still showing the selected node's wires, panel content from the contract,
copy text, subgraph navigation and Escape order, focus order and aria labels,
preference persistence and defaults (Quiet, Bundled).

### P4 · Floating image, docs, owner smoke

Floating image window (drag, resize, fold, reopen after fold, pointing at it
lights the output node), manual (`docs/manual/viewer-and-metadata.md`),
architecture viewer section, `docs/progress.md`, this plan's status.

Acceptance: vitest for window bounds clamping and fold/reopen (the bug the owner
hit in the gallery); the **owner smoke**: on the test profile
`com.ambit.p378.test` (never the real profile), an unreleased `app:dev` build, 3
to 4 real images: one plain workflow, one with groups and a bypassed node, one with
a subgraph, one API-prompt-only. Short guided steps (open, fit, fold a group, open
a node, switch wires, open a subgraph, float the image, Escape back), prepared by
the agent.

### P5 · InvokeAI (sketch, not built now)

Ambit reads InvokeAI metadata (`src-tauri/src/metadata/invokeai.rs`) but has no
graph parser. P5 adds `inspect_invokeai_workflow_canvas`, filling the same
`WorkflowCanvasReport`:

- **workflow** (editor file: `nodes[].position`, `data.type`, `data.label`,
  `data.isOpen`, `data.inputs{name: {value}}`, `notes` nodes; `edges[]` with
  `sourceHandle`/`targetHandle`): saved layout, folded from `isOpen`;
- **graph** (what ran: `nodes{id: {type, fields...}}`, `edges[{source:{node_id,
field}, destination:{node_id, field}}]`): no positions, automatic layout;
- port types are not saved: a field-to-type table for core invocations
  (`unet`, `clip`, `clip2`, `vae`, `conditioning`, `latents`, `noise`, `image`,
  `metadata`), unknown fields grey;
- no groups, bypass or mute; selected output is the non-intermediate
  `save_image` / `l2i`;
- fixtures from real InvokeAI 5.x and 6.x images, both forms. The UI from P2 to
  P4 is reused unchanged apart from enabling the button.

## 9. Risks and non-goals

Risks:

- **Viewer keys** (Delete deletes, F favourites, Space closes): handled by the
  ownership rule and its tests in P2; treated as blocking.
- **Widget naming** without `widget.name` and without a prompt shows "Value N";
  no per-node-type name table is added (it would need upkeep per custom pack).
- **Large real workflows** beyond the fixtures: the P2 perf gate and Rust caps.
- **Paint cost unmeasured** in the spike; the P2 gate measures it in WebView2.
- **Group membership** follows ComfyUI's rule: a node counts when the centre of
  its box, title bar included, is inside the group.

Not doing:

- editing, dragging nodes into a saved layout, writing anything back;
- node colours from the file (only group colours);
- V2 to V6 features (lit path strip, replay, compare, story);
- changing the Workflow tab's card view, the normalizer, the evaluator or the
  parser version;
- a phone layout; new network paths.
