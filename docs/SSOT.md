# SSOT — Single Source of Truth

> This document is the **stable orientation map** of the `INDIEaner84/OpenApoc`
> fork. It changes rarely and only when the shape of the project changes.
> The fast-moving, dated work log, decisions log, and "Status & Next Steps"
> live in [`PROJECT_PLAN.md`](../PROJECT_PLAN.md) at the repository root and
> are authoritative for *session state*. This file tells you *where everything
> is* so you never have to re-derive it.

## 1. What this project is

A fork of [OpenApoc](https://github.com/OpenApoc/OpenApoc) (an open-source
reimplementation of X-COM: Apocalypse) with two work streams:

1. **Engine modernization & incremental rewrite** — gameplay is preserved;
   changes are made module by module, bottom-up; after every change the
   project must build and the non-CD unit tests must pass.
2. **Owner-approved gameplay features** — tracked as F1, F2, F3 in the
   Feature Backlog of `PROJECT_PLAN.md`. Behaviour-changing work is explicit
   and opt-in where it alters default gameplay.

Development happens **without the original game CD** (`-DEXTRACT_DATA=OFF`).
Only 3 of the 11 registered tests need extracted CD data; the other 8 run
without it. Playing the game still requires the original assets.

## 2. Canonical files

| What | Where |
|------|-------|
| Session memory, work log, decisions log, next steps, feature backlog (F1/F2/F3), owner agreements | `PROJECT_PLAN.md` (root) |
| Stable architecture analysis (layer responsibilities, what belongs where) | `docs/ARCHITECTURE_ANALYSIS.md` |
| This orientation map | `docs/SSOT.md` |
| Sandbox dependency provisioning + how to build/test from scratch | `docs/DEV_ENVIRONMENT.md` + `scripts/setup-sandbox-deps.sh` |
| Unit tests (headless, most CD-free) | `tests/` (registered in `tests/CMakeLists.txt`) |
| OpenApoc C++ engine + game state | `framework/`, `library/`, `forms/`, `game/`, `dependencies/` |
| Separate browser-based tactics/city game (autonomous phases, own tests) | `browser-game/` (see its `README`) |

## 3. Build & test (sandbox reality)

Dependencies are installed **outside the repo** and must exist before a build:

- `~/venv/bin` — cmake 4.x, ninja
- `/opt/local` — SDL2 2.30, Boost 1.84 (locale + program_options), ogg/vorbis,
  pkg-config, stub GL/GLX headers (no real OpenGL dev headers in the sandbox)

```sh
export PATH=$HOME/venv/bin:/opt/local/bin:$PATH LD_LIBRARY_PATH=/opt/local/lib
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_LAUNCHER=OFF -DEXTRACT_DATA=OFF -DENABLE_BACKTRACE=OFF \
      -DCMAKE_PREFIX_PATH=/opt/local
ninja -C build
cd build && ctest -j2
```

Expected test outcome: **8/11 pass** (rect, voxel, tilemap, rng, unicode,
colour, backtrace, medevac); `test_images`, `test_serialize_difficulty0`,
`test_lab_assignment` are CD-data-gated and fail without the CD — expected,
not regressions.

## 4. Current status (top level)

- **F1 — Helicopter transport & medevac: C++ integration complete**
  (commits `03fc3c4`, `a3e770d`, `bd0ef3d`, `1a12d7b`).
  Mission core (pickup → nearest/free-Medical-capacity base), departure/
  arrival notifications, pure pickup planner + 12 unit tests, manual city-tab
  order button, and the opt-in post-battle auto-dispatch
  (`OpenApoc.NewFeature.AutoMedEvacAfterBattle`, default off).
  Remaining: in-game validation with real assets + a savegame round-trip check.
- **F2 — Base building**: open design questions, owner input required
  (see backlog F2 in `PROJECT_PLAN.md`).
- **F3 — Tactical squad planning**: serialized `BattleUnitPlanAction` model,
  per-unit executor with movement/stance/turn/wait/go-code-barrier actions and
  keyboard UI exist (P1–P3). P4 started: `OpenDoor`, `AttackLocation`,
  `ThrowItem` actions + `Ctrl+Alt+F/O/T` authoring hotkeys. Plans execute in
  real-time mode only (TB support is an open follow-up).
- **Engine modernization**: not started; entry point is the small self-contained
  `library/` layer per `docs/ARCHITECTURE_ANALYSIS.md`.
- **`browser-game/`**: independently developed and tested (own README + tests).

## 5. Conventions that must not be broken

- **Savegame compatibility**: serialized enums (`gamestate_serialize.xml`)
  may only be extended by **appending** values after the last existing one
  (see the F1 `GameEventType` / `VehicleMission::MissionType` comments).
- **Feature policy**: gameplay-changing work is additive/opt-in (config toggles
  declared in `framework/options.{h,cpp}`, listed in
  `game/ui/general/moreoptions.cpp` when user-facing).
- **Data discipline**: keep generated artifacts and large files out of the
  repo; never commit CD-derived assets.
- **Branch discipline**: work happens on the session branch
  `arena/<session>-openapoc`; sync with upstream master regularly.
