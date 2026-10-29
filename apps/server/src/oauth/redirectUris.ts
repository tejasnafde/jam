const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The redirect URIs a client may register: https anywhere, or http on a
 * loopback host (any port) for desktop clients. No fragment, no userinfo.
 */
export function redirectUriProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "is not a URL";
  }
  if (url.hash || value.includes("#")) return "must not have a fragment";
  if (url.username || url.password) return "must not have user info";
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return null;
  return "must use https, or http on localhost or 127.0.0.1";
}
