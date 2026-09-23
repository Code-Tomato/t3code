# shellcheck shell=bash
# Sourced by the Linux packaging scripts. Sets the package name for a
# release tag, or returns 1 for tags that publish no packages (previews).
resolve_channel() {
  local tag="$1"
  version="${tag#v}"
  if [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    channel='stable' pkg_name='t3code' other_pkg_name='t3code-nightly'
    display_name='T3 Code' icon_name='t3code'
  elif [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]{8}\.[0-9]+$ ]]; then
    channel='nightly' pkg_name='t3code-nightly' other_pkg_name='t3code'
    display_name='T3 Code Nightly' icon_name='t3code-nightly'
  else
    echo "Release $tag does not publish Linux packages."
    return 1
  fi
}
