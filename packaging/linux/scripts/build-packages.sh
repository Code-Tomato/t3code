#!/usr/bin/env bash
# Builds the desktop .deb and .rpm for one release tag and one architecture
# from the AppImage already on its GitHub release. Nothing is compiled: the
# package holds the unpacked AppImage.
#
#   RELEASE_TAG=v0.0.42 ARCH=x64 packaging/linux/scripts/build-packages.sh
#
# Environment:
#   RELEASE_TAG            release to package (required)
#   ARCH                   x64 or arm64 (default: x64)
#   OUT_DIR                output directory (default: packaging/linux/dist)
#   ASSET_DIR              directory that already holds the AppImage; skips
#                          the download and digest check
#   RPM_SIGNING_KEY_FILE   armored private key; the .rpm is signed when set
#   NFPM                   nfpm executable (default: nfpm)
#
# Needs bash, gh and jq (unless ASSET_DIR is set), gpg, sha256sum,
# unsquashfs, and nfpm.
set -euo pipefail

linux_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo='pingdotgg/t3code'
tag="${RELEASE_TAG:?RELEASE_TAG is required}"
arch="${ARCH:-x64}"
out_dir="${OUT_DIR:-$linux_dir/dist}"
mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"
nfpm="${NFPM:-nfpm}"

# shellcheck source=packaging/linux/scripts/channel.sh
source "$linux_dir/scripts/channel.sh"
resolve_channel "$tag" || exit 0

case "$arch" in
  x64) appimage_arch='x86_64' deb_arch='amd64' rpm_arch='x86_64' ;;
  arm64) appimage_arch='arm64' deb_arch='arm64' rpm_arch='aarch64' ;;
  *) echo "ARCH must be x64 or arm64, not $arch." >&2; exit 1 ;;
esac

appimage="T3-Code-${version}-${appimage_arch}.AppImage"
install_dir="/opt/$pkg_name"

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

assets="${ASSET_DIR:-$work/assets}"
if [[ -z "${ASSET_DIR:-}" ]]; then
  # The AppImage must match the SHA-256 digest GitHub recorded at upload.
  mkdir -p "$assets"
  digest="$(gh api "repos/$repo/releases/tags/$tag" \
    --jq ".assets[] | select(.name == \"$appimage\") | .digest")"
  digest="${digest#sha256:}"
  if [[ ! "$digest" =~ ^[0-9a-f]{64}$ ]]; then
    echo "Release $tag is missing $appimage or its SHA-256 digest." >&2
    exit 1
  fi
  gh release download "$tag" --repo "$repo" --pattern "$appimage" --dir "$assets" --clobber
  echo "$digest  $assets/$appimage" | sha256sum --check --quiet
fi

# The squashfs image starts where the AppImage's ELF runtime ends: the section
# header table offset plus its size. Reading the header lets an x64 runner
# unpack the arm64 AppImage, which it cannot execute.
squashfs_offset() {
  local shoff shentsize shnum
  shoff="$(od -An -t u8 -j 40 -N 8 "$1" | tr -d ' ')"
  shentsize="$(od -An -t u2 -j 58 -N 2 "$1" | tr -d ' ')"
  shnum="$(od -An -t u2 -j 60 -N 2 "$1" | tr -d ' ')"
  echo $((shoff + shentsize * shnum))
}

payload="$work/root$install_dir"
mkdir -p "$(dirname "$payload")"
unsquashfs -quiet -no-progress -no-xattrs -offset "$(squashfs_offset "$assets/$appimage")" \
  -dest "$payload" "$assets/$appimage" >/dev/null
if [[ ! -x "$payload/t3code" || ! -f "$payload/chrome-sandbox" ]]; then
  echo "$appimage is missing the t3code executable or the Chromium sandbox." >&2
  exit 1
fi
# AppRun, the AppImage desktop entry, and usr/ (fallback libraries and icons)
# only matter inside an AppImage. The package declares the libraries as
# dependencies and installs the icons system-wide. app-update.yml would make
# the app look for AppImage updates; the package manager owns updates, and
# resources/package-type tells the app which one.
mv "$payload/usr/share/icons" "$work/icons"
rm -rf "${payload:?}/AppRun" "$payload/t3code.desktop" "$payload/t3code.png" "$payload/.DirIcon" \
  "${payload:?}/usr" "$payload/resources/app-update.yml"
chmod -R u=rwX,go=rX "$payload"
# Chromium's sandbox helper must be setuid root where unprivileged user
# namespaces are restricted, such as Ubuntu 24.04. This is why the package
# starts without --no-sandbox.
chmod 4755 "$payload/chrome-sandbox"

share="$work/root/usr/share"
mkdir -p "$share/applications"
# Icon lookup only sees sizes registered in hicolor's index.theme.
for icon in "$work"/icons/hicolor/*/apps/t3code.png; do
  size_dir="${icon%/apps/t3code.png}"
  install -Dm644 "$icon" "$share/icons/hicolor/${size_dir##*/}/apps/${icon_name}.png"
done
cat >"$share/applications/${pkg_name}.desktop" <<DESKTOP
[Desktop Entry]
Name=${display_name}
Comment=Desktop GUI for coding agents
Exec=${pkg_name} %U
TryExec=${pkg_name}
Terminal=false
Type=Application
Icon=${icon_name}
StartupWMClass=t3code
Categories=Development;
MimeType=x-scheme-handler/t3code;
DESKTOP

keyring="$linux_dir/t3code-archive-keyring.asc"
if [[ ! -f "$keyring" ]]; then
  echo "Missing $keyring. See the Setup section of packaging/linux/README.md." >&2
  exit 1
fi

# Repository definitions and the signing key. Installing the package from the
# download page is enough to get every later version from apt or dnf, the
# same way the Chrome and VS Code packages work.
mkdir -p "$work/repo"
cp "$keyring" "$work/repo/"
gpg --dearmor <"$keyring" >"$work/repo/t3code-archive-keyring.gpg"
cat >"$work/repo/t3code-${channel}.sources" <<SOURCES
Types: deb
URIs: https://pkg.t3.codes/apt
Suites: ${channel}
Components: main
Signed-By: /usr/share/keyrings/t3code-archive-keyring.gpg
SOURCES
cat >"$work/repo/t3code-${channel}.repo" <<REPO
[t3code-${channel}]
name=T3 Code ${channel}
baseurl=https://pkg.t3.codes/rpm/${channel}/\$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-t3code
REPO
printf 'deb\n' >"$work/package-type.deb"
printf 'rpm\n' >"$work/package-type.rpm"

# nfpm cannot expand variables in source paths, so each format gets a
# rendered config. Its relative source paths resolve from $work.
build() {
  local format="$1" arch_name="$2"
  local config="$work/nfpm.$format.yaml"
  local target="$out_dir/${pkg_name}_${version}_${arch_name}.${format}"
  sed -e "s#@NAME@#$pkg_name#g" -e "s#@CONFLICTS@#$other_pkg_name#g" -e "s#@FORMAT@#$format#g" \
    -e "s#@CHANNEL@#$channel#g" -e "s#@INSTALL_DIR@#$install_dir#g" \
    "$linux_dir/nfpm.yaml" >"$config"
  # nfpm writes the semver prerelease as ~, so nightly 0.0.43~nightly.* sorts
  # below stable 0.0.43 in both apt and rpm.
  (cd "$work" && PKG_VERSION="$version" PKG_ARCH="$arch_name" \
    RPM_SIGNING_KEY_FILE="${RPM_SIGNING_KEY_FILE:-}" \
    "$nfpm" package --config "$config" --packager "$format" --target "$target" >/dev/null)
  echo "$target"
}

build deb "$deb_arch"
build rpm "$rpm_arch"
