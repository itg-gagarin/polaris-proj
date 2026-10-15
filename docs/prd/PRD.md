# Furniture BOM Studio --- Product Requirements Document

Oct 15, 2026 · \@ITG

## 1. Summary

Furniture BOM Studio is a multi-user web editor. A furniture product\'s
BOM becomes a measurable 3D model on a free, infinite canvas. Each team
(design, engineering, painting, hardware, packing, QC) reviews its own
scope, and every change is a revision with notes.

The bet: one workspace that borrows the best patterns from four tools:

-   **AutoCAD:** precision, layers, ortho views and the command line.

-   **Figma:** infinite canvas, frames, multiplayer, comments and the
    properties panel.

-   **Excalidraw:** fast markup with single-key tools.

-   **Blender:** 3D navigation, gizmos, the outliner, and section and
    exploded views.

**The biggest risk is scope.** Those are four mature products. Version 1
must stay a BOM-driven parametric editor with markup and review, not a
general CAD package. The roadmap (section 13) is built around that
limit.

### Why now: the product meeting

The trigger is the product meeting with Team Pak Margono, 23 people.

-   **Each person has their own paper.** It is a spec sheet with the
    product\'s details, and they take pen notes on each part.

-   **Each person covers one area,** such as colour and finishing,
    process assembly, or finishing.

-   **Decisions for the next revision are made in the discussion.** But
    the discussion is scattered and isn\'t recorded, so nobody holds the
    whole picture afterwards.

-   **Combining the notes is assumed to happen later, by hand.**

The tool has to replace the paper, not just the spreadsheet.

  -----------------------------------------------------------------------
  In the meeting today                What the tool must do
  ----------------------------------- -----------------------------------
  One paper per person with the       A personal spec sheet per person,
  product\'s details and spec         generated from the current revision
                                      and filtered to their role

  Pen notes on each part              Pen (stylus) and typed notes that
                                      pin to a part, not to a spot on
                                      paper

  Notes kept on one\'s own paper      A private notes layer per person,
                                      shared when they choose or when the
                                      meeting closes

  Notes combined afterwards, by hand  An automatic merge: every note
  (assumed)                           grouped by part and by team in one
                                      meeting record

  Discussion scattered, not recorded  Meeting recording with a
                                      transcript, moments linked to the
                                      part on screen, and a decision log

  Decisions feed the next revision    Each decision becomes a change
                                      request or task on the draft
                                      revision, with an owner
  -----------------------------------------------------------------------

### Problem

-   **BOMs and drawings disagree, and errors reach the shop floor.** The
    Dresser 1727 sheet showed 10 drawers in the drawing but 8 in the
    BOM. The drawing said 946 mm high, but the parts give 964 mm.
    Modelled in 3D, it had 131 overlapping part pairs.

-   **Review happens in chat and Excel.** No single place exists where
    painting, hardware and packing sign off on the same revision.

-   **Part names vary from product to product.** The reference sheet
    already merges many original names into 1,920 standard entries
    (section 4). The tool has to use that dictionary, not guess.

### What the prototype taught us

  -----------------------------------------------------------------------
  Prototype behaviour     Problem                 Requirement in this PRD
  ----------------------- ----------------------- -----------------------
  One product, locked     Feels like a viewer,    Infinite canvas with
  camera, fixed layout    not an editor           many products,
                                                  viewports and sheets
                                                  side by side (section
                                                  5)

  Inspector dock covers   Model and panels        Dockable, collapsible
  the model               compete for space       panels; canvas always
                                                  full-bleed

  Parts placed by         Side-panel W/L was      Standard codes plus
  guessing from names     swapped between sheets  explicit axis mapping
                                                  and position per part
                                                  (section 4)

  Verdicts flipped with   Inset vs overlay        Assumptions shown and
  hidden assumptions      changed the dresser     editable per product,
                          verdict                 confidence on every
                                                  finding (section 7)

  Edits lost on reload    No record of who        Server persistence,
                          changed what            revisions and audit log
                                                  from day one (section
                                                  9)
  -----------------------------------------------------------------------

## 2. Users, teams and roles

Every person belongs to one or more teams. A team owns a review scope:
the parts, attributes and checks it is responsible for. Permissions come
from the role. Scope only decides what each team sees first and what it
must approve.

  -----------------------------------------------------------------------
  Team              Who               Review scope      Typical actions
                                      (what they own)   
  ----------------- ----------------- ----------------- -----------------
  Design / R&D      Product designers Overall           Create products,
                                      dimensions,       edit geometry,
                                      proportions,      publish revisions
                                      visible parts,    
                                      fronts, top       

  Engineering       Construction /    Joinery, carcass, Edit construction
                    technical drawing runners, internal parts, set joint
                                      parts,            types, resolve
                                      tolerances,       clash findings
                                      clashes           

  Colour &          Painting /        Colour, finish    Assign finishes,
  finishing         finishing         code per visible  mark faces,
                    department        face, sheen,      approve the
                                      veneer direction, finish schedule
                                      sanding spec      

  Process assembly  Assembly line     Assembly          Mark assembly
                    leads             sequence,         steps per part,
                                      sub-assemblies,   flag hard joints,
                                      jigs, fixing      approve the
                                      order, parts that assembly process
                                      are hard to       
                                      assemble          

  Hardware          Hardware          Slides, hinges,   Pick SKUs, check
                    purchasing and    knobs and         fit (slide length
                    fitting           handles,          vs box depth),
                                      connectors,       approve the
                                      screws, Hardware  hardware list
                                      Bungkus (hardware 
                                      packs)            

  Packing           Packing / export  Pallet skid,      Edit packing
                                      crate, carton,    parts, approve
                                      knock-down state, packing
                                      protection        

  QC                Quality control   Checks list,      Raise issues with
                                      tolerances,       photos, re-open
                                      sample photos     approvals
                                      from the floor    

  PPIC / Production Planning          Cut list,         Release
                                      material          revisions, export
                                      take-off,         cut lists
                                      revision release  

  Buyer / customer  Client reviewers  Appearance and    View, comment and
  (external)                          overall           approve the
                                      dimensions only   sample; no
                                                        editing
  -----------------------------------------------------------------------

Two meeting roles sit on top of any team (section 9, Meeting mode):

-   **Meeting lead:** runs the agenda, drives the shared view, closes
    the meeting.

-   **Note-taker:** records decisions in the decision log. Can be the
    same person as the lead.

### Roles and permissions

  ----------------------------------------------------------------------------------
  Role       View       Comment    Edit geometry    Approve    Release    Manage
                        and notes  and BOM          own team   revision   users
                                                    lane                  
  ---------- ---------- ---------- ---------------- ---------- ---------- ----------
  Viewer     Yes        Yes        No               No         No         No
  (incl.                                                                  
  external                                                                
  buyer)                                                                  

  Reviewer   Yes        Yes        No               Yes        No         No

  Editor     Yes        Yes        Yes, in team     Yes        No         No
                                   scope                                  
                                   (configurable)                         

  Lead       Yes        Yes        Yes              Yes        Yes        No

  Admin      Yes        Yes        Yes              Yes        Yes        Yes
  ----------------------------------------------------------------------------------

Editing outside your team\'s scope is allowed for Leads and Admins. For
others it is either blocked or turned into a suggestion, set per
workspace (open question in section 14).

## 3. Goals, non-goals and success metrics

Version 1 succeeds when a team can import a product\'s BOM, see it as a
correct 3D model with drawings, fix what the checks flag, and release a
revision that every required team has approved, all in one tool.

### Goals

1.  **Import to model:** an Excel BOM becomes a placed 3D model with 2D
    views. Unplaced parts go to a visible tray, never silently dropped.

2.  **Catch conflicts before release:** clashes, fit and clearance
    errors, quantity mismatches and missing parts are flagged on the
    part, with the rule and its confidence.

3.  **Edit like an editor:** free canvas, direct manipulation, precise
    typed values, undo/redo, multiple products and views open at once.

4.  **Review by team:** each team sees its own scope and checklist,
    comments on parts, and approves its lane per revision.

5.  **Traceable revisions:** every revision has notes, an author, a diff
    against any other revision, and an immutable released state.

6.  **AI optimize as an assistant:** one button proposes fixes as a
    suggested revision. People accept or reject; the AI never approves.

7.  **Replace the paper in product meetings:** each person gets their
    own spec sheet, takes pen notes on parts, and the meeting ends with
    one combined record: notes by part and team, decisions with owners,
    and the recorded discussion.

### Non-goals for version 1

-   **No full solid CAD:** no B-rep modelling, fillets, sweeps or a
    constraint sketcher. Parts are parametric boxes plus a small profile
    library (tapered leg, triangle block, turned knob).

-   **No CAM or CNC output:** no toolpaths. STEP and DXF export come in
    phase 6.

-   **Not an ERP replacement:** we export cut lists and BOMs; stock and
    costing stay in the ERP.

-   **No photoreal rendering:** a realistic material preview only.

-   **No editing on phones:** phones get view, comment and approve.

### Success metrics

Baselines don\'t exist yet. Measure them during the pilot (first 4 weeks
after phase 3) before committing to the targets below, which are
proposals.

  -----------------------------------------------------------------------
  Metric                  How measured            Proposed target
  ----------------------- ----------------------- -----------------------
  Import to first correct Time from upload to     Under 10 minutes for a
  model                   zero unplaced parts     product of about 60 BOM
                                                  lines

  Auto-placement rate     Parts placed without    At least 80% (needs the
                          manual role or position standard-code
                          input                   dictionary, section 4)

  Errors caught before    Issues found in the     At least 90%
  release                 tool ÷ (found in tool + 
                          found on the floor)     

  Review cycle time       Revision submitted to   Half of the pilot
                          all lanes approved      baseline

  AI suggestion           Accepted AI changes ÷   At least 60%; lower
  acceptance              proposed                means the rules or
                                                  prompts need work

  Weekly active reviewers Distinct people who     Every required team
                          comment or approve      active each week during
                                                  the pilot

  Meeting record ready    Time from meeting close Same day (today: no
                          to a combined record    combined record)
                          with decisions and      
                          owners                  

  Decisions with an owner Decisions in the log    100%
                          that have an owner team 
                          and a linked change or  
                          task                    

  Paper sheets in         Printed spec sheets     Down to only the people
  meetings                used per meeting        without a tablet
  -----------------------------------------------------------------------

## 4. Reference data and data model

The attached workbook is the **standard part-name dictionary**, not a
set of product BOMs. It has no dimensions. It tells the tool what every
component is called and how it nests, so imports can map messy names to
one standard code. Each product still needs its own dimensioned BOM, in
the import format below.

### What the reference workbook contains

Sheet1, \"FU Standard SG Names -- Level 1 and Level 2\", hand-mapped:
1,920 entries. That\'s 423 Level 1 heads (155 distinct names) and 1,497
Level 2 components (382 distinct names), across 8 categories and 42
sub-categories.

  -----------------------------------------------------------------------
  Column                  Meaning                 How the tool uses it
  ----------------------- ----------------------- -----------------------
  Category / Sub-category Product family (e.g.    Picks the layout
                          Storage & Casegoods /   template and the check
                          Nightstands)            set

  Std Code                e.g. CAN-02-01 (Level 2 Primary key for every
                          under CAN-02)           part

  Level, L1 (Head), L2    Assembly (L1) and       Builds the assembly
                          component (L2)          tree in the Outliner

  Standard SG Name        Canonical name          Display name
                                                  (Indonesian, as used on
                                                  the floor)

  Positions Seen          e.g. Kanan / Kiri /     Placement hints:
                          Atas / Bawah            left/right, top/bottom,
                                                  front/back

  Variants Seen           e.g. 15 X 15 X 250,     Default sizes and
                          Mdf; Plywood            materials offered when
                                                  adding a part

  Original Names Merged   Legacy names that map   Name matching on import
                          here                    

  \# FGs Using, \# SG     How often it\'s used    Ranks suggestions;
  Lines                                           flags rare names for
                                                  review

  Source                  Hand-mapped /           Shown as provenance;
                          Hand-reviewed           not used by the logic
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Category                            Entries
  ----------------------------------- -----------------------------------
  Storage & Casegoods                 808

  Beds                                506

  Tables                              345

  Seating                             147

  Other Furniture                     72

  Dining Set                          21

  Unclassified                        15

  NON FURNITURE                       6
  -----------------------------------------------------------------------

**Data problems to fix before relying on it:**

-   106 entries sit under the sub-category \"Please specify\".

-   Two spellings need correcting: \"Extention\" and \"Entertaiment\".

-   The sheet has no axis mapping. Nothing says which of T, W or L is
    height for a given part, and that is exactly what broke the
    prototype (side panels had W and L swapped between sheets).

**Add two columns:**

-   Axis Map, e.g. T:x W:z L:y for a side panel.

-   Default Role, e.g. side, drawerFront, slat.

### Product BOM import format (one sheet per product revision)

  -----------------------------------------------------------------------
  Column            Required          Example           Notes
  ----------------- ----------------- ----------------- -----------------
  Product Code,     Yes               NS-0420,          Header block or
  Product Name,                       Nightstand,       columns
  Category,                           Storage &         
  Sub-category                        Casegoods,        
                                      Nightstands       

  Revision          Yes               A                 Import creates
                                                        this revision

  Std Code          Preferred         CAN-02-01         If missing,
                                                        matched by name
                                                        (below)

  L1, L2, Part Name Yes               Rakitan Laci /    Free text kept as
                                      Panel Muka Laci   the original name

  Position          No                Kiri              From the
                                                        dictionary\'s
                                                        position
                                                        vocabulary

  T, W, L (mm)      Yes               18, 205, 590      Cut size

  Qty               Yes               3                 Pieces; hardware
                                                        may be a pair or
                                                        set (Unit column)

  Unit              No                pcs / pair / set  

  Material /        No                MAHOGANY, PLYWOOD Picks from the
  Species                                               material library

  Finish Code       No                F-12 Walnut satin Owned by Painting

  Hardware SKU      No                Slide 45×350 FE   Owned by Hardware

  Team Owner        No                Hardware          Defaults from Std
                                                        Code

  X, Y, Z, RotX,    No                0, 180, 200, 0,   If given, the
  RotY, RotZ                          0, 0              part is placed
                                                        exactly
                                                        (CAD-style
                                                        import)

  Notes             No                Overlay front     Kept on the part;
                                                        keywords can
                                                        inform checks
  -----------------------------------------------------------------------

**Name matching order on import:**

1.  Exact Std Code.

2.  Exact match on Standard SG Name or Original Names Merged (+
    Position).

3.  Fuzzy match with a score.

4.  AI suggestion (section 8).

Steps 3 and 4 always need a person to confirm. Unconfirmed parts go to
the Unplaced tray.

### Core entities

  -----------------------------------------------------------------------
  Entity                              Key fields
  ----------------------------------- -----------------------------------
  Workspace                           id, name, teams, settings (units
                                      mm, language)

  StdPart (dictionary)                std_code, level, l1, l2, name,
                                      category, sub_category,
                                      positions\[\], variants\[\],
                                      merged_names\[\], axis_map,
                                      default_role, owner_team

  Product                             id, code, name, category,
                                      sub_category, current_revision_id

  Revision                            id, product_id, label (A, B...),
                                      state (draft / in review / changes
                                      requested / approved / released),
                                      notes, author, created_at,
                                      parent_revision_id, snapshot

  Part                                id, revision_id, std_code,
                                      original_name, l1, l2, position, T,
                                      W, L, qty, unit, material,
                                      finish_code, hardware_sku,
                                      team_owner, transform, axis_map,
                                      expressions{}, locked, notes

  Assembly                            id, revision_id, std_code (L1),
                                      parent_id, transform,
                                      explode_vector, assembly_step

  Joint                               part_a, part_b, type (tenon, dado,
                                      rabbet, half-lap, screw, glue
                                      block), allowed_overlap_mm

  Assumption                          revision_id, key, value (front
                                      style, reveal gap, slide clearance,
                                      box joint...)

  CheckResult                         revision_id, rule_id, severity,
                                      confidence, part_ids\[\], message,
                                      fix_patch

  Comment / Thread                    id, anchor (part, 3D point, sheet
                                      region, BOM cell, revision), body,
                                      author, mentions\[\], status,
                                      attachments\[\]

  CanvasItem                          id, board_id, type (viewport,
                                      sheet, BOM table, sticky, shape,
                                      arrow, text, image), geometry,
                                      style, z, links

  Review                              revision_id, team, state (pending /
                                      approved / changes requested),
                                      reviewer, checklist answers, at

  Meeting                             id, product_id, revision_id, title,
                                      lead, note_taker, agenda (L1 list),
                                      started_at, closed_at, state
                                      (planned / live / closed)

  Participant                         meeting_id, user_id, team, role in
                                      meeting, device (tablet / laptop /
                                      paper)

  PersonalSheet                       meeting_id, user_id, template (by
                                      team), frames\[\], printed
                                      (yes/no + QR)

  Note                                id, meeting_id, author, visibility
                                      (private / shared), anchor (part
                                      std_code + position, sheet region,
                                      3D point), kind (ink / text /
                                      voice), ink_strokes, text, tag
                                      (question / issue / decision needed
                                      / idea), at

  Decision                            id, meeting_id, text, parts\[\],
                                      owner_team, due, status, linked
                                      change request or task,
                                      transcript_ref, confirmed_by

  Recording                           meeting_id, audio_uri, consent log,
                                      transcript segments \[start, end,
                                      speaker, text, part on screen\]

  AuditEvent                          who, what, before, after, at,
                                      source (user / AI / import /
                                      meeting)
  -----------------------------------------------------------------------

## 5. Workspace and canvas

The canvas is the product. It is a full-bleed, infinite 2D board, like
Figma or Excalidraw. On it you place **frames**: live 3D viewports, 2D
drawing sheets, BOM tables, and free markup. Panels dock around the
edges and collapse to icons, like AutoCAD or Blender. Nothing is locked
to one product or one camera.

![editor layout · docks, tool bar, canvas frames, command
line](media/image1.png){width="6.0in" height="3.6875in"}

editor layout · docks, tool bar, canvas frames, command line

The docks collapse to icons, so the canvas can take the whole screen. A
selection highlights in every frame at once: 3D, sheet and BOM row.

### Layout

-   **Top bar:** workspace and product switcher, revision chip (e.g. Rev
    B · In review), presence avatars, Share, the AI optimize button.

-   **Floating tool bar (top centre):** the Excalidraw-style tools from
    the reference screenshot: lock, hand, select, rectangle, diamond,
    ellipse, arrow, line, pencil, text, note, eraser, more. Model tools
    (section 6) sit in the same bar after a divider.

-   **Left dock (tabs):**

    -   **Products & revisions:** browse and open several at once.

    -   **Outliner:** L1 → L2 tree with show/hide/lock per node, like
        Blender.

    -   **Layers:** by team, material, L1 or custom, with colour and
        visibility, like AutoCAD.

-   **Right dock (tabs):**

    -   **Properties:** the Figma-style inspector for the selection,
        covering size, transform, material, finish, hardware, team,
        joints and checks.

    -   **Comments:** threads for the current scope.

    -   **Review:** team lanes and checklists.

-   **Bottom bar:**

    -   **Command line**, AutoCAD-style: MOVE, DIM, SECTION X 300, SET W
        567.

    -   **Status bar:** units, snap, ortho, grid, cursor XYZ.

    -   **Revision timeline:** a strip that scrubs through history.

-   **Minimap (bottom right):** the whole board, so people never get
    lost.

### Frame types on the canvas

  -----------------------------------------------------------------------
  Frame                   What it shows           Interaction
  ----------------------- ----------------------- -----------------------
  3D viewport             One product revision,   Orbit, pan and zoom
                          perspective or ortho    inside the frame;
                                                  select and edit parts;
                                                  shading modes

  2D sheet                Auto-generated front,   Pick dimensions, add
                          side, top, section and  callouts; updates live
                          detail views with       when the model changes
                          dimensions and a title  
                          block                   

  BOM table               The revision\'s parts   Type sizes and
                          as an editable grid     quantities; a row
                                                  highlights its part in
                                                  every viewport

  Compare                 Two revisions side by   Before/after slider,
                          side, cameras synced    ghost overlay of the
                                                  old parts, diff list

  Markup                  Shapes, arrows,         Free on the board or
                          freehand, text, sticky  pinned to a part, so it
                          notes, images           moves with the part
  -----------------------------------------------------------------------

Several viewports can show the same revision. A selection is shared
across all frames: pick a drawer in 3D and its BOM row and sheet outline
light up.

### Viewport modes

-   **Shading:** solid, material, wireframe and X-ray, as in Blender.

-   **Explode:** a slider driven by each assembly\'s explode vector.

-   **Section:** a plane on X, Y or Z, with a draggable cap.

-   **Team lenses** recolour the model for one team:

    -   **Painting:** finish code per face; faces with no finish show
        striped red.

    -   **Hardware:** hardware only, the wood ghosted.

    -   **Engineering:** joints and clashes.

    -   **Packing:** skid, crate and carton.

### What we borrow from each tool

  -----------------------------------------------------------------------
  Tool                    Patterns we take        Patterns we skip in
                                                  version 1
  ----------------------- ----------------------- -----------------------
  AutoCAD                 Command line, typed     Full 2D drafting,
                          coordinates, object     xrefs, LISP
                          snaps, ortho, layers,   
                          model space vs sheets,  
                          dimension styles, title 
                          blocks                  

  Figma                   Infinite canvas,        Auto-layout,
                          frames, multiplayer     prototyping
                          cursors, comments       
                          pinned in place,        
                          properties panel,       
                          components and variants 
                          (for repeated drawers), 
                          version history         

  Excalidraw              Single-key tools,       Libraries marketplace
                          hand-drawn style        
                          option, sticky notes,   
                          arrows that bind to     
                          shapes, low-friction    
                          markup                  

  Blender                 Orbit/pan/zoom keys,    Modifiers stack,
                          transform gizmo,        sculpting, rendering
                          outliner, shading       engines
                          modes, X-ray,           
                          N-panel-style           
                          properties              
  -----------------------------------------------------------------------

## 6. Tool bar and tools

The markup tools copy Excalidraw\'s keys exactly, matching the reference
tool bar, so people who know Excalidraw are productive on day one. Model
tools take keys Excalidraw doesn\'t use. Views use numpad keys like
Blender. A keymap preference (Default, AutoCAD-style, Blender-style)
remaps the rest.

### Markup tools (any frame, or pinned to a part)

  -----------------------------------------------------------------------
  Tool                    Key                     Behaviour
  ----------------------- ----------------------- -----------------------
  Lock tool               Q                       Keeps the current tool
                                                  active after each use

  Hand                    H or hold Space         Pan the board; inside a
                                                  3D frame it pans the
                                                  camera

  Select                  V                       Click, shift-click, box
                                                  select; Alt-drag
                                                  duplicates

  Rectangle / Diamond /   R / D / O               Shapes with fill,
  Ellipse                                         stroke and a sketchy or
                                                  clean style

  Arrow / Line            A / L                   Binds to shapes and
                                                  parts; follows them
                                                  when they move

  Pencil                  P                       Freehand ink,
                                                  pressure-aware on pen
                                                  tablets

  Text                    T                       Double-click or Enter
                                                  edits text

  Note                    N                       Sticky note with
                                                  author, colour by team;
                                                  can become a comment
                                                  thread

  Eraser                  E                       Erases markup only,
                                                  never model parts

  More                    ⋮                       Image, frame, laser
                                                  pointer, embed BOM
                                                  table
  -----------------------------------------------------------------------

### Model tools (3D frames and sheets)

  -----------------------------------------------------------------------
  Tool                    Key                     Behaviour
  ----------------------- ----------------------- -----------------------
  Move                    W                       Gizmo on the selection
                                                  with axis lock; type a
                                                  distance while dragging
                                                  (e.g. -120 Enter)

  Rotate                  Shift+R                 90° snaps by default;
                                                  free with Alt

  Resize                  S                       Handles on the faces
                                                  that map to T, W or L;
                                                  typing gives an exact
                                                  value; the BOM row
                                                  updates

  Measure                 M                       Point-to-point,
                                                  face-to-face and
                                                  clear-gap readouts that
                                                  snap to edges and faces

  Dimension               Shift+D                 Persistent dimension on
                                                  a sheet or in 3D,
                                                  linked to geometry

  Section plane           X                       Click a face or axis;
                                                  drag the plane; cap
                                                  shows the cut

  Explode                 Shift+X                 Toggle or slider;
                                                  per-assembly explode
                                                  vectors

  Add part                Shift+A                 Pick from the standard
                                                  dictionary (by category
                                                  and L1), with default
                                                  sizes from Variants
                                                  Seen

  Mirror / Array          Ctrl+M / Ctrl+Shift+A   Left/right pairs
                                                  (Kanan/Kiri), repeated
                                                  slats or drawers

  Group as assembly       Ctrl+G                  Creates an L1 node in
                                                  the Outliner

  Hide / Isolate / Show   Alt+H / Shift+I /       Per selection
  all                     Alt+Shift+H             

  Frame selection         F                       Zoom the active
                                                  viewport to the
                                                  selection

  Views                   Numpad 1 / 3 / 7 / 0    Front, side, top, iso
                          (Alt+1/3/7/0 on         
                          laptops)                

  Command palette         Ctrl+K                  Every command by name,
                                                  plus recently used

  Undo / Redo             Ctrl+Z / Ctrl+Shift+Z   Per user in
                                                  multiplayer, never
                                                  undoing someone else\'s
                                                  edit
  -----------------------------------------------------------------------

### Precision and snapping

-   **Units and precision:** millimetres everywhere, entered to 0.1 mm,
    displayed to 0.5 mm by default.

-   **Object snaps** (toggle with F3): endpoint, midpoint, face centre,
    edge, perpendicular, grid (1, 5 or 10 mm).

-   **Ortho lock** (toggle with F8): constrains moves to the main axes.

-   **Dynamic input:** while dragging, a small field shows the value.
    Typing replaces it, and Tab moves to the next axis.

-   **Expressions:** any size field accepts an expression, e.g.
    =case.innerWidth/2 - 22.5 - 3. The part then follows the parameter
    (section 7).

### Selection rules

-   A click picks a part. A double-click enters its assembly
    (Figma-style); Esc leaves it.

-   Alt-click picks the whole assembly, e.g. a whole drawer.

-   Hover shows a tooltip with the part name, Std Code and size. A
    selected part shows its issues in Properties.

## 7. Parametric engine, checks and clash detection

Sizes live in the BOM. Positions come from a layout template per
sub-category plus explicit transforms. Checks run on every change, in
under 200 ms for a 300-part product, and show on the part itself. One
TypeScript package does all three, so the browser, the server and the AI
service get identical answers.

### How geometry is produced

1.  **Parameters:** each revision has named values, such as
    case.innerWidth, reveal, slideClearance, frontStyle and boxJoint.
    Imports infer them; people can edit them in the Assumptions panel.

2.  **Layout templates:** one per family (case with drawers, case with
    doors, bed, table, chair, bench, bookcase). A template places parts
    by role and Position (Kiri/Kanan, Atas/Bawah, Depan/Belakang), using
    the dictionary\'s axis map.

3.  **Expressions:** a size can be a number or a formula referencing
    parameters and other parts, e.g. drawer box width = opening.width -
    2 \* slideClearance. Change the parameter and every dependent part
    follows. A typed number breaks the link, and the field shows that.

4.  **Explicit transforms:** an imported X/Y/Z, or a part moved by hand,
    overrides the template for that part. A \"Reset to template\"
    control undoes it.

5.  **Joints:** a joint between two parts (tenon, dado, rabbet,
    half-lap) declares an allowed overlap, so intended joinery never
    counts as a clash.

### Check library (version 1)

Every check returns: severity (fail, warn, info), confidence (High =
arithmetic on the BOM; Medium = depends on an assumption or common
practice; Low = an interpretation of unclear data), the parts involved,
a plain message with the numbers, and, when possible, a fix patch.

  -----------------------------------------------------------------------
  Check             Rule (summary)    Owner team        Prototype result
  ----------------- ----------------- ----------------- -----------------
  Part clash        Overlap above     Engineering       Dresser 1727: 131
                    0.05 mm between                     pairs → 0 after
                    parts not joined                    fixes
                    by a declared                       
                    joint                               

  Drawer box vs     Box outside width Hardware +        Drawer Dresser:
  slide             = opening − 2 ×   Engineering       2.5 mm too wide
                    slide clearance                     per side
                    (±0.5 mm)                           

  Front width       Inset: opening −  Design            Drawer Dresser:
                    2 × reveal.                         590 in 573 mm
                    Overlay: covers                     openings
                    the case edge                       
                    with the reveal                     

  Front stack       Fronts + gaps fit Design            Infers inset vs
  height            between rails                       overlay when no
                    (inset) or within                   note says
                    the case                            
                    (overlay)                           

  Fronts align      Outer edges of    Design            Dresser 1727:
                    every row line up                   rows off by 11 mm

  Divider / back /  Matches the inner Engineering       Nightstand: back
  bottom fit        height or width,                    panel 82 mm short
                    with groove                         
                    allowance                           

  Runner / slide    Not longer than   Hardware          Dresser 1727: 391
  length            the drawer box or                   in 377 mm
                    the space to the                    
                    back                                

  Bed slats         Length ≤ clear    Engineering       Queen bed: 1550
                    span − 2 ×                          in 1550 mm, no
                    clearance; 15--20                   ledger
                    mm bearing on a                     
                    ledger; gaps ≤ 76                   
                    mm (verify with                     
                    the mattress                        
                    maker)                              

  Mattress fit      Span and length ≥ Design            Queen bed: zero
                    mattress + 10 mm                    end clearance

  Left/right pairs  Kiri and Kanan    Engineering       Queen bed rails
                    parts are equal                     
                    unless marked                       
                    asymmetric                          

  Quantity          BOM qty = parts   All               Catches missing
                    the layout needs                    or extra pieces

  Missing parts     Notes or          Engineering       Drawer Chest:
                    templates expect                    feet in notes,
                    a part that                         not in BOM
                    isn\'t listed                       
                    (feet, knobs,                       
                    slat ledger,                        
                    fasteners)                          

  Finish coverage   Every visible     Painting          New in version 1
                    face has a finish                   
                    code                                

  Hardware          Every drawer has  Hardware          New in version 1
  completeness      slides or                           
                    runners; every                      
                    door has hinges;                    
                    every hardware                      
                    line has a SKU                      

  Packing           Skids at least    Packing           Skid length check
                    the product                         
                    footprint; packed                   
                    weight and volume                   
                    shown                               

  Tip-over (market  Clothing storage  QC                Needs
  rule)             at or above 686                     verification
                    mm (27 in) needs                    against the
                    an anti-tip kit                     current rule per
                    and a test if                       market
                    sold in the US                      
  -----------------------------------------------------------------------

**Rule authoring:** rules are TypeScript functions with unit tests,
registered per category. Thresholds (reveal, clearances, slat gap) come
from workspace settings, not code, so each factory sets its own
standard.

### Clash detection

-   **Broad phase:** an axis-aligned box tree over all parts.

-   **Narrow phase:** oriented boxes, then a triangle mesh test (e.g.
    three-mesh-bvh) for non-box shapes.

-   **What is checked:** moving parts (drawers, doors) against fixed
    ones, every pair, minus declared joints.

-   **Drag preview:** live during a drag, limited to the parts near the
    dragged one.

-   **On screen:** clashes show as red outlines plus a numbered pin. The
    pin opens the finding with both parts named.

## 8. AI optimize

One button, top right. It turns the current findings into a **suggested
revision**. People review it in a before/after view and accept or reject
each change. The rule engine computes the numbers. The language model
(Claude via the API) only maps names, explains, and proposes fixes the
rules can\'t express. Every AI number is re-checked by the rules before
anyone sees it.

### Flow

1.  **Run checks** on the current draft revision.

2.  **Deterministic fixes:** each failing rule with a fix patch produces
    a change. Run up to 4 passes, because one fix can change another
    (e.g. a narrower box changes the bottom panel width).

3.  **Model pass:** the model gets the findings, the BOM, the
    assumptions and the standard dictionary. It returns structured JSON
    only:

    -   name-to-Std-Code mappings for unmatched parts;

    -   plain-language reasons per change;

    -   extra suggestions, each with a patch, a confidence and a reason.

4.  **Validate:** every model patch runs through the same rules. A patch
    that creates a new failure is dropped and listed as \"Not applied,
    made things worse\".

5.  **Show the suggestion:**

    -   **On the model:** changed parts tint green with value pins (e.g.
        L 590 → 567).

    -   **Change list:** grouped by team, each change with its reason
        and confidence.

    -   **Compare frame:** opens automatically with synced cameras, a
        before/after slider and a ghost of the old parts.

6.  **Decide:** Accept all, accept per change, or reject. Low-confidence
    changes start unticked. Accepted changes land in the draft as one
    history step, authored as \"AI optimize, accepted by Name\".

### Guardrails

-   **The AI never approves, releases or edits locked parts or released
    revisions.**

-   **It shows its sources:** every change names the rule or the BOM
    fact it rests on. A model suggestion with no rule behind it is
    labelled \"Suggestion\" and starts unticked.

-   **No silent assumptions:** if a fix depends on an assumption (inset
    vs overlay, slide brand clearance), the change says so and links to
    the Assumptions panel.

-   **Limits:** one optimize run per revision at a time; timeout 60 s.
    On failure the deterministic fixes still show, with a note that the
    explanation step failed.

-   **Cost and privacy:**

    -   Only the BOM, the findings and the dictionary rows involved are
        sent to the model, never drawings or comments.

    -   Each workspace can turn the model pass off and keep only the
        rule fixes.

### Other AI helpers (later phases)

-   **Import mapping:** suggest a Std Code and axis map for unmatched
    names, with the top 3 candidates.

-   **Revision summary:** draft the revision note from the diff, for the
    author to edit.

-   **Review assistant:** for a team lane, list what changed in that
    team\'s scope since its last approval.

-   **Meeting assistant:** from the transcript and the shared notes,
    propose decision cards and a draft meeting summary. Each card cites
    its transcript moment, and a person confirms it. How well Bahasa
    Indonesia speech is transcribed in a 23-person room needs
    verification in a trial before this is relied on.

-   **Ask the model:** a chat panel scoped to the selected parts, e.g.
    \"Why is this front red?\" Answers cite the check result.

## 9. Collaboration, notes, revisions and team review

Many people work in the same board at once. Everyone can leave notes and
comments anchored to exactly what they mean. A revision is released only
when every required team has approved its own lane.

![revision flow · 5 states, 7 team lanes in
parallel](media/image2.png){width="6.0in"
height="3.401784776902887in"}

revision flow · 5 states, 7 team lanes in parallel

Any lane can send the revision back to Draft. A released revision never
changes; editing it starts the next revision.

### Multiplayer

-   **Presence:** live cursors with names and team colours. Each
    person\'s selection outlines in their colour. **Follow mode** (click
    an avatar) mirrors their camera, which is useful in review meetings.

-   **Co-editing:** model edits, BOM edits and markup sync in real time
    through a conflict-free shared document (CRDT). Two people editing
    the same field: last write wins, and the loser sees a toast with the
    value they lost.

-   **Part locks:** the lock tool (Q in the tool bar, or Lock in
    Properties) stops others editing a part or an assembly while you
    work on it. Locks expire after 30 minutes idle.

-   **Per-user undo:** Ctrl+Z only undoes your own changes.

### Comments and notes

  -----------------------------------------------------------------------
  Kind              Anchored to       Who               Used for
  ----------------- ----------------- ----------------- -----------------
  Comment thread    A part, a point   Anyone with view  Questions,
                    on a surface, a   access, including issues,
                    sheet region, a   external buyers   decisions;
                    BOM cell, or the                    \@mentions,
                    whole revision                      photos, resolve,
                                                        reopen

  Sticky note (N)   Free on the board Editors and       Quick working
                    or pinned to a    reviewers         notes, meeting
                    part                                notes, to-dos

  Revision note     A revision        Required when     What changed and
                                      submitting or     why; the AI can
                                      releasing         draft it from the
                                                        diff

  Check note        A check result    Owner team        \"Accepted risk\"
                                                        or \"false
                                                        positive\", with
                                                        a reason; the
                                                        finding stays
                                                        visible, marked
                                                        as waived
  -----------------------------------------------------------------------

-   **Threads move with their part.** They survive revisions: an open
    thread carries forward to the next draft, and its anchor follows the
    part by Std Code + position.

-   **A comment can become a task,** with an assignee and a due date.
    Tasks show in a team\'s review lane.

-   **Notifications:** in-app for mentions, assignments and lane
    changes, plus a daily email digest. Chat-app notifications are a
    later integration (section 10).

### Revisions

-   **States:** Draft → In review → Changes requested (back to Draft) →
    Approved → Released.

-   **Released revisions are read-only.** Editing a released product
    starts a new draft (Rev B from Rev A).

-   **Diff between any two revisions** in three forms: a table of BOM
    changes (sizes, quantities, materials, finish, hardware, added and
    removed lines), the Compare frame in 3D, and red/green overlays on
    sheets.

-   **Branches:** a revision can fork into an alternative (e.g. B-wood
    vs B-metal slides). One alternative is promoted; the others are
    archived.

-   **Audit log:** every change records who, what, before, after, when
    and the source (user, import, AI).

### Team review lanes

When a draft is submitted, each required team gets a lane. A lane opens
its team lens and scope filter, its checklist, and the findings its team
owns.

  -----------------------------------------------------------------------
  Team                                Example checklist items
  ----------------------------------- -----------------------------------
  Design                              Overall W × D × H matches the
                                      brief; fronts align; reveals
                                      consistent

  Engineering                         Zero unwaived clashes; joints
                                      declared; quantities match

  Colour & finishing                  Colour and finish code on every
                                      visible face; veneer direction set;
                                      sample colour approved

  Process assembly                    Assembly sequence set per
                                      sub-assembly; every joint reachable
                                      with tools; jigs listed

  Hardware                            Every hardware line has a SKU;
                                      slide length fits the box and the
                                      case; Hardware Bungkus pack list
                                      complete

  Packing                             Skid and crate sized; knock-down
                                      parts listed; packed dimensions set

  QC                                  Tolerances set; tip-over
                                      requirement checked for the target
                                      market
  -----------------------------------------------------------------------

-   Lanes run in parallel. Any lane can request changes, which sends the
    revision back to Draft with that lane\'s comments.

-   **Required lanes are set per category.** Example: beds need Design,
    Engineering, Painting, Hardware and Packing.

-   An approval is tied to the revision\'s content hash. Any later edit
    in a team\'s scope resets that lane to Pending, and the team is told
    what changed.

### Meeting mode (product review meetings)

Meeting mode runs a review like the 23-person product meeting inside the
tool. Everyone follows the same product revision and writes on their own
sheet. The meeting ends with one combined record whose decisions are
already attached to the draft revision.

![meeting mode · before, during,
after](media/image3.png){width="6.0in"
height="3.0535706474190727in"}

meeting mode · before, during, after

Notes are pinned to parts, not to positions on paper. That is what lets
23 people\'s notes merge into one record without anyone retyping them.

**Before the meeting**

1.  **Setup:** the lead picks the product and revision, invites people,
    and gives each a team role (Colour & finishing, Process assembly,
    Finishing, Hardware...). The agenda is built from the assemblies
    (L1), in order.

2.  **Personal spec sheets:** the tool generates one sheet per person
    from the revision, filtered to their role.

    -   **Everyone:** views, overall dimensions, part list and specs.

    -   **Colour & finishing:** finish codes and the visible faces.

    -   **Process assembly:** exploded view and assembly sequence.

    -   **Hardware:** hardware list and fit.

3.  **Paper fallback:** a sheet can be printed as PDF with a QR code per
    part, for anyone without a tablet. A photo of the marked sheet can
    be uploaded later; its notes attach to the parts the QR codes
    identify.

**During the meeting**

4.  **Pen notes on parts:** people write with a stylus on their sheet or
    on the 3D view.

    -   **Pinning:** ink that lands on a part pins to that part (Std
        Code + position), so it can be combined later. Ink on blank
        space pins to the sheet.

    -   **Typed notes:** typing works too.

    -   **Quick tags:** Question, Issue, Decision needed, Idea.

5.  **Private first:** notes stay in the person\'s own layer. Share
    sends a note to the room at once. At close, the lead asks everyone
    to publish; whether unpublished notes stay private or auto-share is
    an open question (section 14).

6.  **Presenter view:** the lead drives the shared view. Others follow
    it or browse freely, and \"Bring everyone here\" pulls all followers
    back.

7.  **Recording:** audio is recorded only after an on-screen consent
    prompt.

    -   **Live transcript:** each segment is tagged with the part or
        sheet the presenter had on screen at that moment.

    -   **Bookmarks:** anyone can tap \"Mark this moment\".

8.  **Decision log:** the note-taker records decision cards.

    -   **Each card holds:** the decision, the part(s), the owner team,
        a due date, and the transcript moment.

    -   **AI proposals:** the AI can propose cards from the transcript
        (section 8). A person confirms each one; none are logged
        automatically.

**After the meeting**

9.  **Combined record,** generated at close and editable:

    -   attendees with their roles;

    -   decisions;

    -   all published notes grouped by part, then by team;

    -   open questions;

    -   the transcript with links to parts.

10. **Into the revision:** each decision becomes a change request or
    task on the draft revision, assigned to its owner team. The meeting
    record is linked from the revision history, so the reasons behind
    Rev B are always one click away.

11. **Scale:**

    -   **Room size:** 25 participants on tablets in one meeting.

    -   **Ink sync:** strokes visible to others in under 500 ms.

    -   **Bad Wi-Fi:** notes taken offline sync when the connection
        returns.

## 10. Import, export and integrations

Excel stays the way data comes in and goes out in version 1. The tool
adds structure (standard codes, axis maps, revisions) without forcing
anyone to stop using spreadsheets.

  ---------------------------------------------------------------------------
  Direction         Format            Phase             Notes
  ----------------- ----------------- ----------------- ---------------------
  Import            Standard          0                 Re-import merges by
                    dictionary                          Std Code and shows
                    (.xlsx, the                         added, changed and
                    reference                           removed entries
                    workbook)                           before saving

  Import            Product BOM       1                 Preview screen:
                    (.xlsx / .csv,                      matched / fuzzy /
                    format in section                   unmatched rows, axis
                    4)                                  map per row, then
                                                        create the revision

  Import            Re-import into an 3                 Creates a new draft
                    existing product                    and shows the diff
                                                        against the current
                                                        revision before
                                                        saving

  Export            BOM and cut list  1                 Includes Std Code,
                    (.xlsx) per                         sizes, qty, species,
                    revision                            finish, hardware SKU,
                                                        team owner

  Export            Material take-off 1                 Solid m³ and panel m²
                    by species                          at cut size
                    (.xlsx)                             

  Export            Drawing sheets    2                 Front, side, top,
                    (PDF)                               section, details,
                                                        title block with
                                                        revision and
                                                        approvals

  Export            2D views (DXF)    6                 For AutoCAD users

  Export            3D model (GLB)    2                 For sales and the
                                                        customer portal

  Export            3D model (STEP)   6                 Through an open CAD
                                                        kernel compiled for
                                                        the browser (e.g.
                                                        OpenCascade-based);
                                                        feasibility needs
                                                        verification in a
                                                        spike

  Integration       ERP (item master, Later             Which ERP and which
                    BOM push)                           API is an open
                                                        question (section 14)

  Integration       Chat              Later             Depends on what the
                    notifications                       teams use
                    (WhatsApp, Slack                    
                    or Teams)                           

  Integration       Public REST API + Later             Revision released,
                    webhooks                            lane approved,
                                                        comment created
  ---------------------------------------------------------------------------

**Future CAD-style import:** when products come from real CAD, parts
arrive with X/Y/Z and rotation (section 4 columns). Explicit transforms
skip the layout template. The same checks run on them, because the check
library works on placed geometry, not on how it was placed.

## 11. Architecture and tech stack

A TypeScript monorepo with one shared engine package. The same geometry,
rule and import code runs in the browser for instant feedback, on the
server to validate saves, and in the AI service to validate suggestions.
Real-time sync uses a CRDT document per board; the database keeps
revisions, comments, reviews and the audit log.

![architecture · browser, 3 services, 3 stores, shared
packages](media/image4.png){width="6.0in" height="3.5in"}

architecture · browser, 3 services, 3 stores, shared packages

The shared packages under every box are the point: a check that passes
in the browser passes on the server and in the AI service, because it is
the same code.

  -----------------------------------------------------------------------
  Layer             Proposed choice   Why               Alternatives
  ----------------- ----------------- ----------------- -----------------
  App framework     Next.js + React + One codebase for  Vite + React SPA
                    TypeScript        the editor, admin with a separate
                                      and API routes;   API
                                      Claude Code works 
                                      well in it        

  3D                three.js via      Mature, fast,     Babylon.js
                    React Three       already used in   
                    Fiber + drei      the prototype     

  Spatial queries   three-mesh-bvh    Fast picking and  Custom box tree
                                      clash narrow      
                                      phase             

  2D canvas and     Excalidraw        Matches the       tldraw SDK (check
  markup            component (MIT    reference tool    its commercial
                    licence) for      bar; open source  licence terms
                    markup, with our                    before choosing
                    own frame layer                     -- needs
                                                        verification)

  Docking panels    dockview or a     Dockable, tabbed, Golden Layout
                    custom layout     collapsible       
                                      panels            

  State             Zustand for local Simple local      Liveblocks
                    UI; Yjs document  state; proven     (hosted, faster
                    for shared board  CRDT for          to start, paid)
                    state             multiplayer       

  Sync server       Hocuspocus (Yjs   Persistence       y-websocket,
                    server) on Node   hooks, auth per   Liveblocks
                                      document          

  Database and auth PostgreSQL via    Roles, team       Postgres +
                    Supabase (auth,   scopes and RLS in NextAuth + S3
                    row-level         one place         
                    security,                           
                    storage)                            

  File storage      Supabase Storage  Excel uploads,    
                    (or S3)           photos on         
                                      comments, PDF     
                                      exports           

  Jobs              A queue worker    Imports, PDF and  BullMQ + Redis
                    (e.g. pg-boss)    STEP exports, AI  
                                      runs              

  AI                Claude API from a Keeps keys        
                    server route,     server-side; no   
                    structured JSON   AI writes without 
                    output, rules     validation        
                    validate every                      
                    patch                               

  CAD export (phase OpenCascade       STEP export of    Server-side
  6)                compiled to       placed parts      FreeCAD;
                    WebAssembly (e.g.                   feasibility spike
                    replicad or                         needed
                    opencascade.js)                     

  Testing           Vitest (engine),  The 4 validation  
                    Playwright        products and      
                    (editor), golden  Dresser 1727 as   
                    fixtures          fixtures          
  -----------------------------------------------------------------------

### Data flow for an edit

1.  A user drags a resize handle in a 3D frame.

2.  The local engine recomputes geometry and checks and redraws within
    one frame; the BOM row updates.

3.  On release, the change goes into the board\'s Yjs document and syncs
    to everyone.

4.  The sync server persists the document and every 30 s writes a
    snapshot to the draft revision in Postgres. The server re-runs the
    checks and stores the results.

5.  Submitting a revision freezes a snapshot with a content hash; review
    lanes attach to that hash.

## 12. Non-functional requirements

These are the acceptance bar for every phase, measured on a mid-range
office laptop (integrated graphics, 16 GB RAM, latest Chrome) unless
stated.

  -----------------------------------------------------------------------
  Area                                Requirement
  ----------------------------------- -----------------------------------
  Performance                         60 fps orbit with 1,000 parts on
                                      screen; checks under 200 ms for 300
                                      parts; a board with 5 open products
                                      loads in under 4 s

  Precision                           All geometry in mm as floating
                                      point; displayed to 0.5 mm; no
                                      rounding in stored values; imports
                                      keep the source value

  Multiplayer                         At least 25 people in one board
                                      (the product meeting has 23); edits
                                      visible to others in under 500 ms
                                      on office Wi-Fi

  Reliability                         Autosave; no data loss on tab close
                                      or network drop (offline edits
                                      queue and merge on reconnect);
                                      daily backups kept 30 days

  Security                            Login required (email + optional
                                      Google or Microsoft SSO); row-level
                                      access by workspace and team;
                                      external buyers see only shared
                                      products; all actions audited

  Language                            Interface in English and Bahasa
                                      Indonesia; part names stay as
                                      written in the dictionary
                                      (Indonesian) with an optional
                                      English alias column

  Accessibility                       Every tool reachable by keyboard;
                                      visible focus; colour is never the
                                      only signal (pins carry numbers and
                                      icons; failing parts get an outline
                                      pattern)

  Browsers                            Chrome and Edge, latest 2 versions,
                                      at launch; Safari and Firefox
                                      best-effort; tablets view and
                                      comment; phones view, comment and
                                      approve

  Data ownership                      Export of everything (products,
                                      revisions, comments, audit) as
                                      .xlsx and JSON at any time

  AI                                  Off-switch per workspace; prompts
                                      and responses logged per run; no
                                      customer data used to train models
                                      (confirm with the API terms --
                                      needs verification)
  -----------------------------------------------------------------------

## 13. Roadmap and acceptance criteria

Seven phases, each ending in a gate you can demo. Multiplayer comes
after single-user editing and revisions work, because syncing a broken
model only spreads the breakage faster. The durations are rough
estimates for one developer working with Claude Code: about 26--34 weeks
in total. Re-plan after phase 1.

![roadmap · 7 phases, about 28 weeks, not to
scale](media/image5.png){width="6.0in"
height="2.517856517935258in"}

roadmap · 7 phases, about 28 weeks, not to scale

Phases run in order. Each gate is a demo on the real fixture products
before the next phase starts.

### Gate criteria

**Phase 0: Foundations (about 2 weeks)**

-   [ ] Monorepo, CI, auth, workspace and team model, roles

-   [ ] Standard dictionary imported from the reference workbook; 1,920
    entries searchable; data problems listed (106 \"Please specify\",
    two misspellings)

-   [ ] Axis Map and Default Role filled for the 50 most-used Std Codes

**Phase 1: Single-user editor (about 6 weeks)**

-   [ ] Product BOM import with the match preview; the 4 validation
    products and Dresser 1727 import with zero unplaced parts after
    confirmation

-   [ ] 3D frame, Outliner, Properties, resize handles, typed sizes,
    expressions, undo/redo

-   [ ] Check library v1; golden tests flag the seeded issues: Drawer
    Dresser fronts 590 mm and Queen bed slats 1550 mm

-   [ ] BOM and cut-list export

**Phase 2: Canvas and markup (about 4 weeks)**

-   [ ] Infinite board with 3D, sheet, BOM and Compare frames; minimap;
    docking panels

-   [ ] Excalidraw tools with the reference keys; markup pinned to parts

-   [ ] Measure, dimension, section, explode, team lenses; PDF sheet and
    GLB export

**Phase 3: Revisions and review (about 5 weeks)**

-   [ ] Revision states, immutable releases, diff table and Compare
    frame

-   [ ] Comments, sticky notes, tasks, notifications

-   [ ] Team lanes with checklists; release blocked until required lanes
    approve; approvals reset on scope edits

-   [ ] Meeting mode v1: personal spec sheets by role (PDF with QR
    fallback), pen and typed notes pinned to parts, private and shared
    layers, decision log, combined record linked to the revision

-   [ ] Pilot starts by running one real product meeting (Team Pak
    Margono) in the tool; baselines measured (section 3)

**Phase 4: Multiplayer (about 4 weeks)**

-   [ ] Presence, follow mode, live co-editing of model, BOM and markup

-   [ ] Presenter view for meetings: lead drives, \"Bring everyone
    here\", live ink sync

-   [ ] Part locks, per-user undo, offline queue

-   [ ] 25-person load test on tablets passes the section 12 targets

**Phase 5: AI optimize (about 3 weeks)**

-   [ ] Deterministic fix passes, model pass with structured output,
    validation of every patch

-   [ ] Suggested revision with accept/reject per change; low confidence
    unticked

-   [ ] Meeting recording with consent, transcript linked to parts,
    AI-proposed decision cards (after a Bahasa Indonesia transcription
    trial)

-   [ ] Import mapping and revision-note helpers

**Phase 6: Export and integrations (about 4 weeks + spike)**

-   [ ] DXF sheets; STEP export after a feasibility spike

-   [ ] ERP push and chat notifications, once the open questions are
    answered

## 14. Risks, open questions and decisions

The two risks most likely to sink this are scope creep (four tools in
one) and geometry that people don\'t trust (wrong placement, false
clashes). Both are addressed by gating each phase on real products from
the workbook, not on demo data.

  -----------------------------------------------------------------------
  Risk                    Impact                  Mitigation
  ----------------------- ----------------------- -----------------------
  Scope: AutoCAD +        Nothing ships, or       Non-goals in section 3;
  Figma + Excalidraw +    everything is half-done phase gates; borrow
  Blender in one                                  patterns, not feature
                                                  lists

  Placement errors from   People stop trusting    Std Codes + Axis Map in
  name guessing           the model               the dictionary;
                                                  Unplaced tray; explicit
                                                  X/Y/Z when available

  False clashes from      Noise hides real        Declared joints with
  intended joinery        problems                allowed overlap; waive
                                                  with a reason; track
                                                  the false-positive rate

  Checks wrong for a      Bad advice at scale     Thresholds in settings,
  factory\'s standard                             not code; every finding
                                                  shows its rule, numbers
                                                  and confidence

  AI changes something it Wrong parts cut         Suggestions only; rules
  shouldn\'t                                      re-validate; low
                                                  confidence unticked;
                                                  full audit

  Multiplayer conflicts   Lost work               CRDT document;
  corrupt a revision                              snapshots every 30 s;
                                                  released revisions
                                                  read-only; restore from
                                                  history

  Performance on office   Unusable for big        Instanced meshes for
  laptops                 products                repeated parts; level
                                                  of detail; budget tests
                                                  in CI

  Reference data quality  Mapping fails           Clean-up list in phase
                                                  0; owner for the
                                                  dictionary; re-import
                                                  with a diff

  Third-party licences    Legal or cost surprise  Review licences before
  (canvas SDK, CAD                                phase 2 and phase 6
  kernel)                                         
  -----------------------------------------------------------------------

### Open questions (need an owner and a date)

-   [ ] Who owns the standard dictionary, and who approves new Std
    Codes?

-   [ ] Where do product BOMs with dimensions come from today: which
    system or spreadsheet, and in what format?

-   [ ] Which ERP do you use, and does it have an API for item masters
    and BOMs?

-   [ ] Which teams are required lanes for each category (beds,
    casegoods, tables, seating)?

-   [ ] Can editors change parts outside their team\'s scope directly,
    or only as suggestions?

-   [ ] Which slide and hinge brands are standard? Their clearances feed
    the hardware checks.

-   [ ] Target markets for each product (for tip-over and other
    compliance checks)?

-   [ ] Hosting: cloud (where) or on-premise? Any data-residency rule?

-   [ ] Do external buyers need access in version 1, or only internal
    teams?

-   [ ] Which chat app should notifications go to (WhatsApp, Slack,
    Teams)?

-   [ ] Meetings: how many of the 23 have a tablet with a stylus? The
    rest need the printed sheet with QR codes, and budget depends on the
    answer.

-   [ ] Meetings: may discussions be audio-recorded? Who gives consent,
    and how long are recordings kept?

-   [ ] Meetings: should unpublished personal notes stay private at
    close, or be shared automatically?

-   [ ] Meetings: who is the usual meeting lead and note-taker for
    product meetings?

-   [ ] Is \"Finishing\" a separate team from \"Colour & finishing\", or
    the same team? The meeting notes list both.

## 15. Appendix: building it with Claude Code

Build the engine package first, test it against the real fixtures, then
put the UI on top. Claude Code is strongest when each prompt is one
phase-sized slice with tests that define \"done\".

### Repository layout

bom-studio/\
CLAUDE.md \# rules below\
apps/\
web/ \# Next.js editor, admin, API routes\
packages/\
engine/ \# geometry, layout templates, expressions, checks, clash,
fixes\
dictionary/ \# Std Code types, reference-workbook importer, name
matcher\
bom-io/ \# product BOM import/export (.xlsx/.csv)\
collab/ \# Yjs document schema, presence, locks\
ui/ \# panels, tool bar, frames, shared components\
services/\
sync/ \# Hocuspocus server\
worker/ \# imports, PDF/GLB/STEP exports, AI runs\
fixtures/\
dictionary/ref.xlsx \# the reference workbook\
products/\*.xlsx \# Nightstand, Drawer Dresser, Drawer Chest, Queen bed,
Dresser 1727\
expected/\*.json \# golden check results per fixture\
supabase/migrations/

### Rules for CLAUDE.md

-   Units are millimetres everywhere. Never round stored values.

-   packages/engine has no React or browser imports. It must run in Node
    for server validation and the AI service.

-   Every check is a pure function: (revision, assumptions) → findings.
    Each check gets a unit test with numbers taken from a fixture.

-   No geometry change bypasses the check run. The AI service may only
    return JSON patches, and the server validates them with the engine.

-   Golden tests in fixtures/expected must pass before any merge. Update
    them only with a written reason.

-   Part names stay as written in the dictionary (Indonesian). The UI
    strings go through the i18n layer (en, id).

### Prompt sequence

1.  \"Read PRD sections 4 and 7. Create packages/dictionary: a typed
    importer for fixtures/dictionary/ref.xlsx that returns StdPart
    records, plus a report of data problems. Add tests that assert 1,920
    entries, 423 L1 and 1,497 L2.\"

2.  \"Create packages/bom-io: import the product BOM format in section 4
    with the 4-step name matcher. Unmatched rows go to an unplaced list.
    Tests use fixtures/products.\"

3.  \"Create packages/engine with parameters, expressions and the
    case-with-drawers and bed layout templates. Use the axis map from
    the dictionary. Test that every fixture places all parts.\"

4.  \"Add the check library v1 (section 7 table) and clash detection
    with declared joints. Write golden results to fixtures/expected.
    Assert that the Drawer Dresser fronts and the Queen bed slats
    fail.\"

5.  \"Add deterministic fix patches and a optimize(revision) function
    that runs up to 4 passes and returns the patch list and the
    remaining findings.\"

6.  \"Build apps/web: a docking layout, an infinite board with a 3D
    frame (React Three Fiber), Outliner, Properties with T/W/L inputs
    and resize handles, and undo/redo. Use the engine in a web worker.\"

7.  \"Add sheet, BOM, and Compare frames, the Excalidraw markup layer
    with the section 6 keymap, measure, section and explode.\"

8.  \"Add Supabase schema, auth, revisions, diff, comments, team lanes
    and approvals (section 9).\"

9.  \"Add Yjs + Hocuspocus multiplayer: presence, follow mode, locks,
    per-user undo.\"

10. \"Add the AI optimize service (section 8): structured output,
    server-side validation, the suggested-revision UI.\"

### Definition of done (every phase)

-   [ ] Gate criteria in section 13 met on the fixture products

-   [ ] Golden tests green; no new waived findings without a reason

-   [ ] Section 12 performance budget met on the reference laptop

-   [ ] Demo recorded and reviewed by at least one person from each
    affected team
