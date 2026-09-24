# Debian and RPM packaging

This directory builds the `t3code` and `t3code-nightly` desktop packages and
publishes the apt and dnf repositories at `https://pkg.t3.codes`.

Nothing here compiles the app. `scripts/build-packages.sh` downloads the
AppImage from a published GitHub release, checks it against the SHA-256 digest
GitHub recorded, unpacks it into `/opt/<package>`, and packs it with
[nFPM](https://nfpm.goreleaser.com). The packages hold the same bytes as the
AppImage, like the [AUR packages](../aur).

## What a package installs

- The app in `/opt/t3code` (or `/opt/t3code-nightly`), started by
  `/usr/bin/t3code` (or `/usr/bin/t3code-nightly`). `chrome-sandbox` is setuid root, so the app starts with
  the Chromium sandbox on hosts that restrict user namespaces, such as
  Ubuntu 24.04.
- A desktop entry and icons.
- `resources/package-type` (`deb` or `rpm`). The app reads it and tells the
  user to update with apt or dnf. `resources/app-update.yml` is removed, so
  the app never tries to replace itself.
- The repository definition and signing key: `/etc/apt/sources.list.d/` and
  `/usr/share/keyrings/` for the `.deb`, `/etc/yum.repos.d/` and
  `/etc/pki/rpm-gpg/` for the `.rpm`. Installing a downloaded package is
  enough to receive later versions from `apt upgrade` or `dnf upgrade`.

Stable and nightly conflict with each other because they share the
`t3code://` URL handler and the user data directory.

## The repository

`pkg.t3.codes` is a Cloudflare Worker in front of an R2 bucket, defined in
[`infra/packages`](../../infra/packages). The bucket holds only the signed
index files. A request for `<path>/pool/<tag>/<file>` redirects to that
release asset on GitHub, and apt and dnf check every file against the SHA-256
in the signed index.

After a stable or nightly release, `.github/workflows/publish-linux-packages.yml`:

1. builds the x64 and arm64 packages and attaches them to the release,
2. downloads the channel's current index with `scripts/sync-repo.sh pull`,
3. adds the new packages with `scripts/publish-repos.sh` and signs the index,
4. uploads it with `scripts/sync-repo.sh push`, entry points last.

Each channel lists the five newest versions of each package, so a user can
still install the previous version with `apt install t3code=<version>`.

The workflow can also be run by hand for one tag.

## Setup

These steps are done once by a maintainer.

1. Create the signing key on an offline machine. Keep the private key and a
   revocation certificate in the team password manager.

   ```bash
   gpg --quick-gen-key 'T3 Code Packages <hello@t3.codes>' rsa4096 sign 3y
   gpg --armor --export <fingerprint> > packaging/linux/t3code-archive-keyring.asc
   gpg --armor --export-secret-keys <fingerprint>   # store as a GitHub secret
   ```

   Commit the public key. RSA is used because RHEL 8's rpm cannot verify
   Ed25519 signatures.

2. Add the private key as the `LINUX_PACKAGES_GPG_PRIVATE_KEY` repository
   secret. The workflow refuses to run if it does not match the committed
   public key. Until the key and the public key file exist, the workflow
   skips with a warning, and the download page hides the package links.
3. Deploy the Worker and bucket: `vp run --filter t3code-packages deploy
--stage prod`. The Cloudflare API token needs R2 edit and Workers edit
   access for the account and DNS edit access for `t3.codes`.
4. Run the workflow by hand for the latest stable and nightly tags to create
   both indexes.

To rotate the key, publish the new public key in a release signed by the old
one, then switch the secret. Packages already installed keep the old key
until they upgrade.

## Testing locally

```bash
RELEASE_TAG=v0.0.42 ARCH=x64 RPM_SIGNING_KEY_FILE=./test-key.asc \
  packaging/linux/scripts/build-packages.sh
REPO_DIR=./site PACKAGE_DIR=packaging/linux/dist RELEASE_TAG=v0.0.42 \
  packaging/linux/scripts/publish-repos.sh
```

The scripts need `nfpm`, `unsquashfs`, `gpg`, `apt-ftparchive`,
`createrepo_c`, and `mergerepo_c`. On Ubuntu:
`sudo apt install apt-utils createrepo-c squashfs-tools gnupg`.
