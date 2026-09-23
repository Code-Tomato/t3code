#!/usr/bin/env bash
# Adds one release's packages to the signed apt and dnf repositories by
# rewriting their index files in REPO_DIR. The package files stay on GitHub
# Releases: pkg.t3.codes redirects /pool/<tag>/<file> to the release download,
# and the signed indexes pin each file's SHA-256, so the redirect is safe.
#
#   REPO_DIR=./site PACKAGE_DIR=./dist RELEASE_TAG=v0.0.42 \
#     packaging/linux/scripts/publish-repos.sh
#
# Environment:
#   REPO_DIR       current repository metadata (apt/, rpm/); updated in place
#   PACKAGE_DIR    the .deb and .rpm files built for RELEASE_TAG
#   RELEASE_TAG    release the packages came from
#   GPG_KEY_ID     signing key (default: gpg's default secret key)
#   KEEP_VERSIONS  versions listed per package (default: 5)
#
# Needs apt-ftparchive (apt-utils), createrepo_c, mergerepo_c, and gpg.
set -euo pipefail

linux_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_dir="$(cd "${REPO_DIR:?REPO_DIR is required}" && pwd)"
package_dir="$(cd "${PACKAGE_DIR:?PACKAGE_DIR is required}" && pwd)"
tag="${RELEASE_TAG:?RELEASE_TAG is required}"
keep="${KEEP_VERSIONS:-5}"
sign=(gpg --batch --yes)
[[ -n "${GPG_KEY_ID:-}" ]] && sign+=(--local-user "$GPG_KEY_ID")

# shellcheck source=packaging/linux/scripts/channel.sh
source "$linux_dir/scripts/channel.sh"
resolve_channel "$tag" || exit 0

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

# The previous index is extended, never rebuilt, so it must be one we signed.
verify() {
  gpg --batch --quiet --verify "$@" 2>/dev/null ||
    { echo "Signature check failed for ${*: -1}. Refusing to extend it." >&2; exit 1; }
}

# apt. The previous Packages file is the record of what is published, so
# older versions stay installable without keeping their files anywhere but
# GitHub Releases. New entries go first; each package keeps $keep versions.
apt_dists="$repo_dir/apt/dists/$channel"
mkdir -p "$work/apt/pool/$tag"
ln -s "$package_dir"/*.deb "$work/apt/pool/$tag/"
if [[ -f "$apt_dists/InRelease" ]]; then
  verify "$apt_dists/InRelease"
  for arch in amd64 arm64; do
    packages="$apt_dists/main/binary-$arch/Packages"
    [[ -f "$packages" ]] || continue
    sum="$(sha256sum "$packages" | cut -d' ' -f1)"
    grep -q " $sum .* main/binary-$arch/Packages\$" "$apt_dists/InRelease" ||
      { echo "$packages does not match the signed InRelease." >&2; exit 1; }
  done
fi
for arch in amd64 arm64; do
  dir="$apt_dists/main/binary-$arch"
  mkdir -p "$dir"
  # Read the old index fully before the redirect below truncates it.
  previous="$(cat "$dir/Packages" 2>/dev/null || true)"
  {
    (cd "$work/apt" && apt-ftparchive --arch "$arch" packages "pool/$tag")
    echo
    printf '%s\n' "$previous"
  } | awk -v keep="$keep" '
    BEGIN { RS = ""; ORS = "\n\n" }
    {
      name = $0; sub(/^.*(^|\n)Package: /, "", name); sub(/\n.*$/, "", name)
      version = $0; sub(/^.*\nVersion: /, "", version); sub(/\n.*$/, "", version)
      if ((name, version) in seen) next
      seen[name, version] = 1
      if (++count[name] <= keep) print
    }' >"$dir/Packages"
  gzip -9nkf "$dir/Packages"
done
(
  cd "$apt_dists"
  apt-ftparchive \
    -o APT::FTPArchive::Release::Origin='T3 Code' \
    -o APT::FTPArchive::Release::Label='T3 Code' \
    -o APT::FTPArchive::Release::Suite="$channel" \
    -o APT::FTPArchive::Release::Codename="$channel" \
    -o APT::FTPArchive::Release::Architectures='amd64 arm64' \
    -o APT::FTPArchive::Release::Components='main' \
    release . >"$work/Release"
  mv "$work/Release" Release
  "${sign[@]}" --clearsign --output InRelease Release
  "${sign[@]}" --armor --detach-sign --output Release.gpg Release
)

# dnf. Index the new RPMs on their own, then merge that with the previous
# metadata. Like apt, the RPM files never need to be here.
for basearch in x86_64 aarch64; do
  shopt -s nullglob
  rpms=("$package_dir"/*_"$basearch".rpm)
  shopt -u nullglob
  [[ ${#rpms[@]} -gt 0 ]] || continue
  dir="$repo_dir/rpm/$channel/$basearch"
  new="$work/rpm-$basearch"
  mkdir -p "$new/pool/$tag" "$dir"
  ln -s "${rpms[@]}" "$new/pool/$tag/"
  createrepo_c --quiet "$new"
  if [[ -f "$dir/repodata/repomd.xml" ]]; then
    verify "$dir/repodata/repomd.xml.asc" "$dir/repodata/repomd.xml"
    merged="$work/merged-$basearch"
    mergerepo_c --all --omit-baseurl --repo "$new" --repo "$dir" --outputdir "$merged" >/dev/null
    rm -rf "$dir/repodata"
    mv "$merged/repodata" "$dir/repodata"
  else
    mv "$new/repodata" "$dir/repodata"
  fi
  "${sign[@]}" --armor --detach-sign --output "$dir/repodata/repomd.xml.asc" \
    "$dir/repodata/repomd.xml"
done
