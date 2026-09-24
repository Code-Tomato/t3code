// Serves pkg.t3.codes, the apt and dnf repositories for the Linux packages.
//
// The bucket holds only the signed index files that
// packaging/linux/scripts/publish-repos.sh writes. Package files stay on
// GitHub Releases: an index entry at <anything>/pool/<tag>/<file> redirects
// to that release asset. apt and dnf check each file against the SHA-256 in
// the signed index, so the redirect cannot swap a package.

export interface Env {
  readonly Bucket: R2Bucket;
}

const RELEASES = "https://github.com/pingdotgg/t3code/releases/download";
const POOL_PATH = /\/pool\/(v[0-9A-Za-z.-]+)\/([0-9A-Za-z._+~-]+\.(?:deb|rpm))$/;

// Index files change on every release; a short TTL keeps apt and dnf close
// to the newest signed metadata without refetching on every request.
const INDEX_CACHE_CONTROL = "public, max-age=300";

// Malformed percent-encoding is a missing file, not a server error.
function decodeKey(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }
}

function indexHeaders(object: R2Object): Headers {
  const headers = new Headers({ "cache-control": INDEX_CACHE_CONTROL, etag: object.httpEtag });
  object.writeHttpMetadata(headers);
  headers.set("content-length", String(object.size));
  return headers;
}

/** Maps a request path to a release download URL, or null if it is not a pool path. */
export function releaseAssetUrl(pathname: string): string | null {
  const match = POOL_PATH.exec(pathname);
  return match ? `${RELEASES}/${match[1]}/${match[2]}` : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const url = new URL(request.url);
    const asset = releaseAssetUrl(url.pathname);
    if (asset) return Response.redirect(asset, 302);

    const key = decodeKey(url.pathname);
    if (key === null || key === "" || key.endsWith("/") || key.includes("..")) {
      return new Response("Not found\n", { status: 404 });
    }
    if (request.method === "HEAD") {
      const object = await env.Bucket.head(key);
      return object
        ? new Response(null, { headers: indexHeaders(object) })
        : new Response(null, { status: 404 });
    }
    const object = await env.Bucket.get(key);
    return object
      ? new Response(object.body, { headers: indexHeaders(object) })
      : new Response("Not found\n", { status: 404 });
  },
};
