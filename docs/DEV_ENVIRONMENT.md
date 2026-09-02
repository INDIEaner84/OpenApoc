# Sandbox / CI environment

The development sandbox has **no apt access** and is periodically reset to a
clean base image. Everything the OpenApoc build needs beyond the base image
(gcc, python3, git, curl, sudo) must be re-provisioned from this repository.

## One-shot provisioning

Run from a fresh checkout:

```sh
bash scripts/setup-sandbox-deps.sh
```

It recreates, outside the repo:

- `~/venv` — cmake, ninja, meson (pip)
- `~/src` — downloaded sources (pkgconf, libogg, libvorbis, SDL2, Boost clone)
- `/opt/local` — installed pkgconf, libogg/libvorbis (static), SDL2 2.30,
  Boost 1.84 headers + static `locale`/`program_options`, a stub
  `GL/glx.h`, and an `ldconfig` entry

The final line of output is `PROVISION_OK`.

## Build & test

```sh
export PATH=$HOME/venv/bin:/opt/local/bin:$PATH LD_LIBRARY_PATH=/opt/local/lib
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_LAUNCHER=OFF -DEXTRACT_DATA=OFF -DENABLE_BACKTRACE=OFF \
      -DCMAKE_PREFIX_PATH=/opt/local -DCMAKE_POLICY_VERSION_MINIMUM=3.5
ninja -C build
cd build && ctest -j2
```

Expected: **8/11 tests pass** (rect, voxel, tilemap, rng, unicode, colour,
backtrace, medevac). `test_images`, `test_serialize_difficulty0` and
`test_lab_assignment` require the original CD / extracted data and fail in a
data-less environment — expected, not regressions.

## Notes

- `build/` is deliberately kept out of version control and may be deleted by
  sandbox checkpoints at any time; re-running the two commands above restores
  it. Never commit build outputs.
- The GL/glx stub exists because the sandbox has no OpenGL/X11 dev headers;
  the game itself needs real assets at runtime, which is unrelated to engine
  work.
