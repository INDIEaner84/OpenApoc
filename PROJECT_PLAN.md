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

### Feature ground rules

- Both features are **additive**: default behaviour without using them must
  stay identical to the original game (see "Gameplay is preserved" — new
  functionality is opt-in, existing mechanics unchanged).
- Every new state field/mission type goes through
  `gamestate_serialize.xml` so savegames keep working.

## Status & Next Steps

### Done

- **2026-08-22** — Synced fork with upstream `OpenApoc/OpenApoc` master
  (`b137e12`, 39 commits, incl. removal of LUA scripting). Full build verified
  (229 targets), 7/10 tests pass (3 need CD data). Architecture analysis written:
  [docs/ARCHITECTURE_ANALYSIS.md](docs/ARCHITECTURE_ANALYSIS.md).

### Next Steps (ordered)

1. **F1 medevac (helicopter picks up wounded)** — biggest agreed feature; start
   with the new `MedicalEvacuation` vehicle mission (see Feature Backlog F1).
2. **F2 base building** — clarify the open questions in Feature Backlog F2
   with the project owner, then break into tasks.
3. **Engine modernization** starting with the small, self-contained
   `library/` layer (1.5 kLOC) — low risk, everything depends on it, good
   place to establish modern conventions.
4. Work through the ~283 `TODO`/`FIXME` markers in the code opportunistically
   while touching the respective modules.
5. Keep the fork regularly synced with upstream to avoid drift.

### Decisions Log

| Date | Decision |
|------|----------|
| 2026-08-22 | Goal fixed: engine modernization + incremental code rewrite, gameplay preserved. |
| 2026-08-22 | Development happens without the original CD (`EXTRACT_DATA=OFF`). |
| 2026-08-22 | This file is the persistent project memory; keep it updated. |
| 2026-08-22 | Feature F1 agreed: helicopter troop transport + medevac for wounded soldiers. |
| 2026-08-22 | Feature F2 agreed: improve the base building system (details TBD). |
| 2026-08-22 | New features must be additive/opt-in; savegame compatibility via `gamestate_serialize.xml` is mandatory. |
