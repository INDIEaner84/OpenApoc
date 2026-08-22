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

## Status & Next Steps

### Done

- **2026-08-22** — Synced fork with upstream `OpenApoc/OpenApoc` master
  (`b137e12`, 39 commits, incl. removal of LUA scripting). Full build verified
  (229 targets), 7/10 tests pass (3 need CD data). Architecture analysis written:
  [docs/ARCHITECTURE_ANALYSIS.md](docs/ARCHITECTURE_ANALYSIS.md).

### Next Steps (ordered)

1. **Pick the first modernization target.** Candidate list with rationale is in
   the "Modernization Opportunities" section of the architecture analysis.
   Suggested starting point: the small, self-contained `library/` layer
   (1.5 kLOC) — low risk, everything depends on it, good place to establish
   modern conventions.
2. Work through the ~283 `TODO`/`FIXME` markers in the code opportunistically
   while touching the respective modules.
3. Keep the fork regularly synced with upstream to avoid drift.

### Decisions Log

| Date | Decision |
|------|----------|
| 2026-08-22 | Goal fixed: engine modernization + incremental code rewrite, gameplay preserved. |
| 2026-08-22 | Development happens without the original CD (`EXTRACT_DATA=OFF`). |
| 2026-08-22 | This file is the persistent project memory; keep it updated. |
