#!/usr/bin/env bash
# Moves the signed repository index files between a local directory and the
# pkg.t3.codes R2 bucket. Only index files live in the bucket; packages stay
# on GitHub Releases.
#
#   packaging/linux/scripts/sync-repo.sh pull <dir> <channel>
#   packaging/linux/scripts/sync-repo.sh push <dir> <channel>
#
# pull reads through https://pkg.t3.codes, so it needs no credentials and a
# channel with no index yet starts empty. push uploads with wrangler and needs
# CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail

mode="${1:?pull or push}"
dir="${2:?directory}"
channel="${3:?channel}"
bucket='t3code-packages'
origin="${PKG_ORIGIN:-https://pkg.t3.codes}"

# Every file a channel's index is made of, relative to the repository root.
# The dnf repodata file names are content-addressed, so repomd.xml lists them.
apt_files=(
  "apt/dists/$channel/InRelease"
  "apt/dists/$channel/Release"
  "apt/dists/$channel/Release.gpg"
  "apt/dists/$channel/main/binary-amd64/Packages"
  "apt/dists/$channel/main/binary-amd64/Packages.gz"
  "apt/dists/$channel/main/binary-arm64/Packages"
  "apt/dists/$channel/main/binary-arm64/Packages.gz"
)

content_type() {
  case "$1" in
    *.gz) echo 'application/gzip' ;;
    *.bz2) echo 'application/x-bzip2' ;;
    *.zst) echo 'application/zstd' ;;
    *.xml) echo 'application/xml' ;;
    *) echo 'text/plain; charset=utf-8' ;;
  esac
}

case "$mode" in
  pull)
    fetch() {
      local status
      mkdir -p "$(dirname "$dir/$1")"
      status="$(curl -sS -o "$dir/$1" -w '%{http_code}' "$origin/$1")"
      case "$status" in
        200) return 0 ;;
        404) rm -f "$dir/$1"; return 1 ;;
        *) echo "GET $origin/$1 returned HTTP $status" >&2; exit 1 ;;
      esac
    }
    for file in "${apt_files[@]}"; do fetch "$file" || true; done
    for basearch in x86_64 aarch64; do
      repodata="rpm/$channel/$basearch/repodata"
      fetch "$repodata/repomd.xml" || continue
      fetch "$repodata/repomd.xml.asc" || true
      for href in $(grep -oE 'href="repodata/[^"]+"' "$dir/$repodata/repomd.xml" | cut -d'"' -f2); do
        fetch "rpm/$channel/$basearch/$href"
      done
    done
    ;;
  push)
    : "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
    : "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
    put() {
      npx --yes wrangler@4 r2 object put "$bucket/$1" --remote --file "$dir/$1" \
        --content-type "$(content_type "$1")" >/dev/null
      echo "uploaded $1"
    }
    # Content-addressed repodata goes first and the signed entry points last,
    # so a client never sees an index that names a file not yet uploaded.
    for basearch in x86_64 aarch64; do
      repodata="rpm/$channel/$basearch/repodata"
      [[ -f "$dir/$repodata/repomd.xml" ]] || continue
      for href in $(grep -oE 'href="repodata/[^"]+"' "$dir/$repodata/repomd.xml" | cut -d'"' -f2); do
        put "rpm/$channel/$basearch/$href"
      done
    done
    for file in "${apt_files[@]}"; do
      [[ "$file" == */InRelease || "$file" == */Release || "$file" == */Release.gpg ]] && continue
      put "$file"
    done
    for basearch in x86_64 aarch64; do
      repodata="rpm/$channel/$basearch/repodata"
      [[ -f "$dir/$repodata/repomd.xml" ]] || continue
      put "$repodata/repomd.xml.asc"
      put "$repodata/repomd.xml"
    done
    put "apt/dists/$channel/Release"
    put "apt/dists/$channel/Release.gpg"
    put "apt/dists/$channel/InRelease"
    ;;
  *)
    echo "usage: $0 pull|push <dir> <channel>" >&2
    exit 1
    ;;
esac
