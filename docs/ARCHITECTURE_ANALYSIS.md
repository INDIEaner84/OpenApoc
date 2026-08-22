# Architecture Analysis — Engine vs. Game

*Written 2026-08-22 against upstream commit `b137e12`. Line counts are
`.cpp`+`.h` totals and will drift over time; the structure will not.*

## The Big Picture

OpenApoc has a **clean layered architecture**. Verified by include analysis:
the engine layers (`library`, `framework`, `forms`) contain **zero** includes
of `game/` code. Dependencies flow strictly downward:

```
             ┌─────────────────────────────────────────┐
             │   game/  (~94 kLOC, 288 files)          │  GAME LAYER
             │   ├── state/ (58 kLOC) game logic/rules │  (rewrite target,
             │   └── ui/    (36 kLOC) game screens     │   gameplay preserved)
             └───────────────┬─────────────────────────┘
                             │ depends on
             ┌───────────────▼─────────────────────────┐
             │   forms/  (~5.5 kLOC, 33 files)         │  ENGINE: UI toolkit
             │   widgets: form, control, listbox, ...  │
             └───────────────┬─────────────────────────┘
             ┌───────────────▼─────────────────────────┐
             │   framework/  (~17 kLOC, 81 files)      │  ENGINE: platform
             │   render (GL2/GLES3), sound, video,     │
             │   data/fs (PhysFS), fonts, images,      │
             │   events, config, logging, stages       │
             └───────────────┬─────────────────────────┘
             ┌───────────────▼─────────────────────────┐
             │   library/  (~1.5 kLOC, 17 files)       │  ENGINE: primitives
             │   strings (UString), sp<>, vec, rect,   │
             │   colour, voxel, rng (xorshift), enums  │
             └─────────────────────────────────────────┘
```

Supporting directories: `tools/` (~15 kLOC: data extractor, code generators),
`tests/` (~1.8 kLOC: 10 unit tests), `dependencies/` (git submodules: fmt, glm,
libsmacker, lodepng, magic_enum, miniz, physfs, pugixml).

## The Reusable Skeleton (keep, modernize in place)

### `library/` — foundation primitives
- `sp.h` — aliases `sp<T>`/`wp<T>`/`up<T>` for smart pointers; `mksp` helper.
- `strings.h` — `UString` custom UTF-8 string type + `strings_format.h` (fmt).
- `vec.h` (glm wrappers), `rect.h`, `line.h`, `colour.h`, `voxel.h`,
  `xorshift.h` (deterministic RNG — **do not touch semantics**, savegames and
  replays depend on it), `enum_traits.h`, `backtrace.h`.
- **Assessment:** small, stable, everything depends on it. Best first
  modernization target to establish conventions (C++17→20 idioms, constexpr,
  [[nodiscard]], tests).

### `framework/` — platform & engine services
- `framework.h/.cpp` — main loop, stage stack (`stage.h`, `stagestack.cpp`).
- `render/` — two renderers: GL 2.0 (`gl20`) and GLES 3.0 v2 (`gles30_v2`).
- `sound/` — SDL raw backend + null backend; `jukebox`, vorbis music loader.
- `video/` — Smacker video playback (libsmacker).
- `data.h`/`fs/` — VFS via PhysFS, cue/iso archiver, mod loading (`modinfo`).
- `apocresources/` — loaders for original data formats (PCK sprites, palettes,
  fonts…). *Only needed when original assets are used; keep isolated.*
- `serialization/` — XML (de)serialization providers.
- `configfile`/`options` — Boost.program_options based config.
- `logger*` — logging with file and SDL-dialog sinks.
- **Assessment:** the actual "engine". Modernization candidates: renderer
  cleanup, threading (`ThreadPool/`), event system, replacing hand-rolled
  pieces with std:: equivalents where safe.

### `forms/` — UI widget toolkit
- Widget set (control, form, label, buttons, listbox, scrollbar, textedit,
  ticker, …) driven by XML form definitions in `data/forms/`.
- **Assessment:** self-contained, no game dependencies. Good second target.

## The Game Layer (rewrite incrementally, behaviour-preserving)

### `game/state/` — 58 kLOC, the heart of the game
- `gamestate.*` — root object; serialized via **generated code**
  (`gamestate_serialize.xml` → `tools/code_generators/` → generated .cpp/.h at
  build time). Any refactor of state classes must keep the XML in sync.
- `city/` — cityscape simulation (vehicles, buildings, agents, economy).
- `battle/` — tactical battle simulation.
- `rules/` — static game rules/templates loaded from mod data.
- `tilemap/` — shared tile/voxel map engine for city & battle.
- `shared/`, `gametime`, `savemanager`, `gameevent`.
- **Assessment:** largest and most intertwined part; rewrite module by module
  with the serializer XML as the compatibility anchor. Savegame compatibility
  defines "gameplay preserved".

### `game/ui/` — 36 kLOC of screens
- `city/`, `battle/`, `base/`, `general/`, `ufopaedia/`, `skirmish/`,
  `debugtools/`, `components/`, `tileview/` — all built on `forms/`.
- **Assessment:** mechanical, low-risk rewrites possible screen by screen.

## Modernization Opportunities (candidate backlog)

1. **`library/` polish** — modern C++ idioms, unit-test coverage, docs. (S)
2. **C++17 → C++20** toolchain bump (CMake `CXX_STANDARD 20`), then adopt
   `std::span`, ranges, `starts_with`, designated initializers, etc. (S/M)
3. **UString audit** — much of it duplicates `std::string`/std APIs now;
   thin it out or document why it must stay. (M)
4. **Renderer consolidation** — `gl20` exists as fallback; measure whether
   GLES3 can be the single maintained path. (M/L)
5. **Threading** — replace hand-rolled `framework/ThreadPool` with std-based
   implementation. (S/M)
6. **Serialization codegen** — the XML→C++ generator is fragile; evaluate
   reflection-ish alternatives (magic_enum is already vendored) while keeping
   savegame format stable. (L)
7. **TODO/FIXME sweep** — ~283 markers across the codebase; fix while touching
   the respective modules. (ongoing)
8. **Warnings & static analysis** — enable `-Wall -Wextra` cleanliness per
   layer, add clang-tidy config aligned with `CODE_STYLE.md`. (M, ongoing)

*(S/M/L = small/medium/large effort)*

## Ground Rules for Rewrites

- Never break the build; `ninja -C build` + `ctest` green (7/10 without CD
  data) after every commit.
- One layer/module per PR-sized change; bottom-up (`library` → `framework` →
  `forms` → `game`).
- `xorshift` RNG, savegame XML format and serializer output are
  **compatibility-critical** — changes there need explicit justification.
- Follow `CODE_STYLE.md` (clang-format enforced via `format` target).
