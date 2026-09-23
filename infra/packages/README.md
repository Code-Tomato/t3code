# pkg.t3.codes

The apt and dnf repositories for the Linux desktop packages. A Cloudflare
Worker ([`src/worker.ts`](./src/worker.ts)) serves the signed index files from
an R2 bucket and redirects package downloads to GitHub Releases.

See [`packaging/linux/README.md`](../../packaging/linux/README.md) for how
packages and indexes are built, signed, and published.

```sh
vp run --filter t3code-packages deploy --stage prod
```
