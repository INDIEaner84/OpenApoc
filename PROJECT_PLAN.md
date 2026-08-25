# Project Plan — OpenApoc Fork (INDIEaner84)

> **READ THIS FIRST at the start of every work session.**
> This file is the persistent memory of the project. AI-assisted sessions have no
> memory of previous conversations — everything agreed upon must be written down
> here (or in the linked docs). Update this file whenever a decision is made or a
> milestone is reached.

## Project Goal

**Modernize the engine and incrementally rewrite/improve the OpenApoc code base
wherever there is room for improvement. The gameplay itself stays as it is.**

Agreed principles:

1. **Keep the skeleton, improve the flesh.** The existing architecture
   (framework / library / forms as engine layers, game as content layer) is the
   base structure we build on. See [docs/ARCHITECTURE_ANALYSIS.md](docs/ARCHITECTURE_ANALYSIS.md)
   for what belongs to which layer.
2. **Incremental rewrite, not big-bang.** Changes are made module by module.
   After every change the project must still build and the unit tests must pass.
3. **Gameplay is preserved.** No gameplay/balance changes as part of the
   modernization work. Behaviour-changing work is a separate, explicit task.
4. **The original game CD is NOT required for development.** We build with
   `-DEXTRACT_DATA=OFF`. Only 3 of the 10 unit tests need extracted CD data;
   the other 7 run without it. (Playing the game still needs original assets —
   that is irrelevant for engine work.)

## Session Workflow

At the start of each session:

1. `git status` / `git log` — see where we are.
2. Read this file and the "Status & Next Steps" section below.
3. Continue with the next open task.

At the end of each session:

- Update "Status & Next Steps" below.
- Commit and push to the session branch.

## How to Build (sandbox / clean Linux box)

The sandbox has no apt access; dependencies were built from source into
`/opt/local` (SDL2 2.30.11, Boost 1.84 locale+program_options, libogg/libvorbis,
stub libGL + GL/X11 headers) and cmake/ninja/meson installed via
`pip install --user`. If `/opt/local` is missing, that setup must be repeated.

```sh
export PATH=$HOME/.local/bin:$PATH PKG_CONFIG_PATH=/opt/local/lib/pkgconfig
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_LAUNCHER=OFF -DEXTRACT_DATA=OFF -DENABLE_BACKTRACE=OFF \
      -DCMAKE_PREFIX_PATH=/opt/local
ninja -C build -j2
cd build && ctest -j2   # 7/10 pass; test_images, test_serialize_difficulty0,
                        # test_lab_assignment need CD data — expected failures
```

## Feature Backlog

*Gameplay-affecting features agreed with the project owner. These are tracked
separately from the pure modernization work.*

### F1 — Helicopter troop transport & medevac 🚁

**Goal:** Helicopters (transport vehicles) bring soldiers to the battlefield
and also **pick up wounded soldiers** and fly them back to a base for healing.

**Current state in the code (analysed 2026-08-22):**

- Vehicles already carry agents: `Vehicle::currentAgents`
  (`game/state/city/vehicle.h:234`), passenger capacity via `getPassengers()`,
  and a passenger/cargo service mission (`MissionType::OfferService`).
- Troop transport to battle **exists**: agents board a vehicle, the vehicle
  flies to the target building (`VehicleMission::GotoBuilding`), the tactical
  battle starts from there (`Battle::beginBattle`/`enterBattle`,
  `game/state/battle/battle.h:309-322`).
- Wounded handling today: agents heal **only passively at a base** with a
  Medical facility — 0.8 HP/hour, divided by medical capacity usage
  (`game/state/shared/agent.cpp:1078-1090`). There is **no medevac**: nobody
  picks up wounded soldiers; they walk/ride home like everyone else.
- Vehicle mission types live in `game/state/city/vehiclemission.h:237-259`
  (21 types: GotoLocation, GotoBuilding, FollowVehicle, AttackVehicle, ...).
  Agent city movement: `game/state/city/agentmission.*`.

**What needs to be built:**

1. New vehicle mission type (e.g. `MissionType::MedicalEvacuation`) in
   `vehiclemission.h/.cpp`: fly to a building, load wounded X-COM agents,
   return to the nearest/home base with free Medical capacity.
2. Wounded detection: `agent->modified_stats.health <
   agent->current_stats.health` (see healing code in `agent.cpp`).
3. Trigger points: (a) manual order from the city UI vehicle panel,
   (b) optional automatic dispatch after a battle ends with wounded survivors
   (hook: battle debriefing / `Battle::exitBattle` path).
4. UI: order button + status display; message log entry when medevac departs
   and arrives (`GameEvent`).
5. Serialization: new mission type must be added to
   `game/state/gamestate_serialize.xml` (savegame compatibility!).

**Files to touch:** `game/state/city/vehiclemission.{h,cpp}`,
`game/state/city/vehicle.{h,cpp}`, `game/state/shared/agent.cpp`,
`game/ui/city/` (vehicle orders UI), `gamestate_serialize.xml`.

### F2 — Base building system ("construction system") 🏗️

**Goal:** Improve the base construction system. *(Details still to be
specified with the project owner — see open questions.)*

**Current state in the code (analysed 2026-08-22):**

- A base is a grid inside a city building; layouts come from
  `game/state/rules/city/baselayout.*` (which corridors/lift exist).
- Facilities: `game/state/rules/city/facilitytype.h` — each type has
  `buildCost`, `buildTime` (days), `weeklyCost` and one capacity type out of:
  Quarters, Stores, Medical, Training, Psi, Repair, Chemistry, Physics,
  Workshop, Aliens (`facilitytype.h:16-29`).
- Build logic: `game/state/city/base.{h,cpp}` —
  `canBuildFacility()`/`buildFacility()`/`canDestroyFacility()`/
  `destroyFacility()` with `BuildError` = Occupied, OutOfBounds, NoMoney,
  Indestructible (`base.h:37-57`). ~640 LOC, clean and compact.
- UI: `game/ui/base/basescreen.cpp` (build/drag facilities, 558 LOC),
  `game/ui/city/basebuyscreen.cpp` (buying a new base building, 182 LOC),
  plus transaction/research/recruit screens in `game/ui/base/`.

**Open questions for the project owner (answer → then this becomes tasks):**

- What exactly should be better? Candidates observed during analysis:
  - Build queue / multiple constructions with progress display
  - Cancel/refund running constructions
  - Facility upgrade paths (e.g. Medical Bay → Advanced Medical)
  - Better placement UX in `basescreen` (rotate, move before confirm)
  - Rebalanced costs/build times (data lives in mod files, not code)

### F3 — Tactical squad planning (Rogue Spear style) 🗺️

**Goal:** Extend the tactical overview into an optional command-planning system
where units and squads can receive complete routes and synchronized actions
before execution. The project owner approved the complete feature set on
2026-08-22.

**Agreed scope (implemented incrementally):**

1. **P1 — Route planning:** planning mode; multiple editable waypoints per
   unit/squad; coloured and numbered route overlays in both tactical overview
   and isometric battle view; execute, pause, resume and cancel controls.
2. **P2 — Movement details:** per-leg movement mode (walk/run/crawl), stance,
   facing direction and timed/indefinite waits at waypoints.
3. **P3 — Synchronization:** named go-codes (`Alpha`, `Bravo`, `Charlie`, and
   `Execute`) shared across squads; execute all or release one phase at a time.
4. **P4 — Tactical actions:** doors, aimed/fire-mode orders, grenade throws,
   smoke, equipment use, cover and observation/fire sectors.
5. **P5 — Robustness and UX:** edit/reorder/copy routes, optional templates,
   TU/time estimates, path/fire-sector conflict and friendly-fire warnings,
   automatic rerouting, and configurable reactions to contact, injury, panic,
   blocked paths, missing targets and insufficient TU.

**Architecture rules:**

- Plans are a separate serialized layer, not preloaded directly into
  `BattleUnit::missions`. A plan executor releases only the next applicable
  action as a normal `BattleUnitMission`, preserving existing pathfinding, AI,
  interruption and turn logic.
- The feature is optional and must support both real-time and turn-based play.
  Existing controls and unplanned tactical behavior remain unchanged.
- Every phase needs focused tests before the next phase builds on it.

**Likely files/modules:** `game/state/battle/battleunitmission.*`,
`game/state/battle/battleunit.*`, a new serialized battle-plan state module,
`game/ui/battle/`, tactical tile/overview rendering, controls/forms, and
`game/state/gamestate_serialize.xml`.

### Feature ground rules

- Both features are **additive**: default behaviour without using them must
  stay identical to the original game (see "Gameplay is preserved" — new
  functionality is opt-in, existing mechanics unchanged).
- Every new state field/mission type goes through
  `gamestate_serialize.xml` so savegames keep working.

## Status & Next Steps

### Done

- **2026-08-22** — Started F3 P1–P3 core: added a serialized, mission-independent
  `BattleUnitPlanAction` model and per-unit authored plan state. The executor
  releases one action at a time into the existing mission system and currently
  supports movement with per-leg speed, stance changes, facing, timed waits,
  go-code barriers, start/restart, pause/resume and cancellation/clearing APIs.
  A first keyboard-driven UI is now connected: selected units can append hovered
  tiles, execute/pause/clear plans, append/release Alpha/Bravo/Charlie barriers,
  and see their remaining route legs rendered in the battlescape. Dedicated
  buttons, waypoint manipulation, action menus and overview-map polish remain.
- **2026-08-22** — Implemented the F1 medevac mission core: added the dedicated,
  savegame-serialized `VehicleMission::MissionType::MedicalEvacuation`, its
  factory, lifecycle handling, mission naming, validation, and map rendering.
  At the pickup building it now selects wounded living X-COM soldiers, respects
  both passenger and free Medical capacity, prefers the vehicle's home base
  when suitable (otherwise the nearest player base in the city), boards the
  agents, assigns that treatment base as their home, and returns there. Agents
  remain in the landed vehicle, which is already supported by passive base
  healing. Existing enum values remain stable because the new value was
  appended.
- **2026-08-22** — Synced fork with upstream `OpenApoc/OpenApoc` master
  (`b137e12`, 39 commits, incl. removal of LUA scripting). Full build verified
  (229 targets), 7/10 tests pass (3 need CD data). Architecture analysis written:
  [docs/ARCHITECTURE_ANALYSIS.md](docs/ARCHITECTURE_ANALYSIS.md).

### Next Steps (ordered)

1. **F1 medevac integration** — add focused mission tests, expose a manual city
   UI order, add departure/arrival `GameEvent` messages, and then add the
   optional post-battle dispatch hook. Core pickup and return behavior exists.
2. **F3 tactical planning integration** — connect the new serialized action
   model/executor to squad-level go-code controls and tactical route editing and
   rendering; then extend action types to doors, attacks, throws, equipment and
   safety/replanning policies.
3. **F2 base building** — clarify the open questions in Feature Backlog F2
   with the project owner, then break into tasks.
4. **Engine modernization** starting with the small, self-contained
   `library/` layer (1.5 kLOC) — low risk, everything depends on it, good
   place to establish modern conventions.
5. Work through the ~283 `TODO`/`FIXME` markers in the code opportunistically
   while touching the respective modules.
6. Keep the fork regularly synced with upstream to avoid drift.

### Decisions Log

| Date | Decision |
|------|----------|
| 2026-08-22 | Goal fixed: engine modernization + incremental code rewrite, gameplay preserved. |
| 2026-08-22 | Development happens without the original CD (`EXTRACT_DATA=OFF`). |
| 2026-08-22 | This file is the persistent project memory; keep it updated. |
| 2026-08-22 | Feature F1 agreed: helicopter troop transport + medevac for wounded soldiers. |
| 2026-08-22 | Feature F2 agreed: improve the base building system (details TBD). |
| 2026-08-22 | Feature F3 approved in full: optional Rogue Spear-style tactical route/action planning, go-codes, synchronized execution, and robust dynamic replanning, delivered in phases P1–P5. |
| 2026-08-22 | New features must be additive/opt-in; savegame compatibility via `gamestate_serialize.xml` is mandatory. |
