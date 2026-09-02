#!/usr/bin/env bash
# Bring-up for the OpenApoc fork sandbox (no apt, no /opt/local, no ~/venv).
# Recreates: ~/venv (cmake/ninja/meson), /opt/local (pkgconf, ogg, vorbis,
# SDL2, Boost 1.84 locale+program_options), GL/glx stub, ldconfig.
set -e
export PATH="$HOME/venv/bin:/opt/local/bin:$PATH"
export LD_LIBRARY_PATH=/opt/local/lib

log() { echo "==> $*"; }

mkdir -p "$HOME/src"
sudo mkdir -p /opt/local
sudo chown "$USER" /opt/local || sudo chown "$(id -un)" /opt/local

log "venv + python tools"
python3 -m venv "$HOME/venv"
"$HOME/venv/bin/pip" install -q -U pip cmake ninja meson

log "pkgconf"
cd "$HOME/src"
if [ ! -d pkgconf ]; then
  git clone -q --depth 1 https://github.com/pkgconf/pkgconf.git pkgconf || true
fi
if [ ! -f pkgconf/meson.build ]; then
  rm -rf pkgconf && git clone -q --depth 1 https://github.com/pkgconf/pkgconf.git pkgconf
fi
rm -rf pkgconf-build && mkdir pkgconf-build && cd pkgconf-build
meson setup --prefix=/opt/local ../pkgconf >/dev/null
meson compile >/dev/null
meson install >/dev/null
ln -sf /opt/local/bin/pkgconf /opt/local/bin/pkg-config

log "libogg"
cd "$HOME/src"
if [ ! -d libogg-1.3.5 ]; then
  curl -sSL --retry 5 -o ogg.tgz https://codeload.github.com/xiph/ogg/tar.gz/refs/tags/v1.3.5
  tar xf ogg.tgz && mv ogg-1.3.5 libogg-1.3.5
fi
rm -rf ogg-build && mkdir ogg-build && cd ogg-build
cmake ../libogg-1.3.5 -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/local \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DBUILD_SHARED_LIBS=OFF >/dev/null
cmake --build . >/dev/null
cmake --install . >/dev/null

log "libvorbis"
cd "$HOME/src"
if [ ! -d libvorbis-1.3.7 ]; then
  curl -sSL --retry 5 -o vorbis.tgz https://codeload.github.com/xiph/vorbis/tar.gz/refs/tags/v1.3.7
  tar xf vorbis.tgz && mv vorbis-1.3.7 libvorbis-1.3.7
fi
rm -rf vorbis-build && mkdir vorbis-build && cd vorbis-build
cmake ../libvorbis-1.3.7 -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/local \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_PREFIX_PATH=/opt/local >/dev/null
cmake --build . >/dev/null
cmake --install . >/dev/null

log "SDL2"
cd "$HOME/src"
if [ ! -d SDL2-2.30.11 ]; then
  curl -sSL --retry 5 -o sdl.tgz https://codeload.github.com/libsdl-org/SDL/tar.gz/refs/tags/release-2.30.11
  tar xf sdl.tgz && mv SDL-release-2.30.11 SDL2-2.30.11
fi
rm -rf sdl-build && mkdir sdl-build && cd sdl-build
cmake ../SDL2-2.30.11 -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/local \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 >/dev/null
cmake --build . -j4 >/dev/null
cmake --install . >/dev/null

log "boost headers (recursive clone)"
cd "$HOME/src"
if [ ! -d boost-src ]; then
  git clone -q --recursive --depth 1 --branch boost-1.84.0 https://github.com/boostorg/boost.git boost-src
fi

log "boost build (locale + program_options)"
cd "$HOME/src/boost-src"
./bootstrap.sh --prefix=/opt/local >/dev/null 2>&1
./b2 -j2 --with-locale --with-program_options --prefix=/opt/local install >/dev/null 2>&1
if [ ! -d /opt/local/include/boost ]; then
  cp -r boost /opt/local/include/boost
fi

log "GL/glx stub"
mkdir -p /opt/local/include/GL
cat > /opt/local/include/GL/glx.h <<'EOF'
#pragma once
// Minimal stub for environments without real GL/GLX dev headers.
typedef unsigned char GLubyte;
typedef void (*__GLXextFuncPtr)(void);

static inline __GLXextFuncPtr glXGetProcAddress(const GLubyte *procName)
{
	extern void *dlsym(void *, const char *);
	extern void *dlopen(const char *, int);
	extern void *glXGetProcAddressARB(const GLubyte *) __attribute__((weak));
	if (glXGetProcAddressARB)
	{
		return (__GLXextFuncPtr)glXGetProcAddressARB(procName);
	}
	static void *handle = dlopen("libGL.so.1", 2 /* RTLD_NOW */);
	return (__GLXextFuncPtr)dlsym(handle, (const char *)procName);
}

static inline __GLXextFuncPtr glXGetProcAddressARB(const GLubyte *procName)
{
	return glXGetProcAddress(procName);
}
EOF

log "ldconfig"
# pkgconf installs its library under the multiarch libdir; expose it from
# /opt/local/lib and put both locations on the dynamic-loader path.
if [ -d /opt/local/lib/x86_64-linux-gnu ]; then
  ln -sf /opt/local/lib/x86_64-linux-gnu/libpkgconf.so.8.0.0 /opt/local/lib/libpkgconf.so.8
  ln -sf libpkgconf.so.8 /opt/local/lib/libpkgconf.so
fi
echo /opt/local/lib | sudo tee /etc/ld.so.conf.d/optlocal.conf >/dev/null
echo /opt/local/lib/x86_64-linux-gnu | sudo tee -a /etc/ld.so.conf.d/optlocal.conf >/dev/null
sudo ldconfig

log "verify"
cmake --version | head -1
ninja --version
pkg-config --version
ls /opt/local/lib/libSDL2.a /opt/local/lib/libboost_locale.a /opt/local/lib/libboost_program_options.a
echo PROVISION_OK
