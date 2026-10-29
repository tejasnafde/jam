// Client ID Metadata Documents: a client may use an https URL as its
// client_id, and that URL serves its metadata as JSON. jam fetches it, so the
// fetch is the one place where this server reaches out to a URL that someone
// else chose. Hence the guard: https on port 443 only, no IP literals, no
// redirects, a public address only (checked at connect time, so DNS
// rebinding cannot swap it), a 5 s timeout and a 32 KB cap.

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

export type DocumentFetcher = (url: string) => Promise<unknown>;

const MAX_BYTES = 32 * 1024;
const TIMEOUT_MS = 5000;

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 127],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** True for an address on the public internet. False for loopback, private, link-local and the like. */
export function isPublicAddress(address: string): boolean {
  // An IPv4-mapped IPv6 address is judged by its IPv4 part. (A ::ffff:0:0/96
  // rule cannot do this: BlockList also matches plain IPv4 against it.)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return isPublicAddress(mapped);
  if (/^::ffff:/i.test(address)) return false;
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** True when a client_id has the shape of a metadata document URL that jam will fetch. */
export function isMetadataDocumentUrl(clientId: string): boolean {
  if (!clientId.startsWith("https://") || clientId.length > 512) return false;
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return false;
  }
  if (url.href !== clientId) return false;
  if (url.port || url.username || url.password || url.hash) return false;
  if (url.pathname === "/" || /\/\.\.?(\/|$)/.test(url.pathname)) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return isIP(host) === 0 && host.includes(".");
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    const first = addresses[0];
    if (!first || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(new Error(`${hostname} does not resolve to a public address`), "", 0);
    }
    // Node asks for every address when it races IPv4 and IPv6 (autoSelectFamily).
    if (options.all) return (callback as (e: null, a: LookupAddress[]) => void)(null, addresses);
    callback(null, first.address, first.family);
  });
};

/** Fetches a metadata document over https with the guard above. */
export const fetchMetadataDocument: DocumentFetcher = (url) =>
  new Promise((resolve, reject) => {
    if (!isMetadataDocumentUrl(url)) return reject(new Error("not a metadata document URL"));
    const req = https.get(
      url,
      { timeout: TIMEOUT_MS, lookup: guardedLookup, headers: { accept: "application/json" } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error("document too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("document is not JSON"));
          }
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
