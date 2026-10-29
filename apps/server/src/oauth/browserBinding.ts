// Binds a pending authorization request to the browser that started it. The
// /authorize response sets an HttpOnly cookie with a random value, and the
// request stores its hash. The consent page can read or decide the request
// only from a browser that sends the same cookie, so a consent link sent to
// someone else is useless.

import type { Request, Response } from "express";
import { hashSecret, mintSecret } from "./secrets.js";
import type { OAuthSettings } from "./settings.js";

const MAX_AGE_S = 60 * 60;

function cookieName(settings: OAuthSettings) {
  // __Host- needs Secure, which needs https. Local http dev uses a plain name.
  return settings.publicUrl.startsWith("https://") ? "__Host-jam_oauth" : "jam_oauth";
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** The hash of this browser's binding cookie, or null when it sent none. */
export function browserHashFrom(req: Request, settings: OAuthSettings): string | null {
  const value = readCookie(req, cookieName(settings));
  return value ? hashSecret(value) : null;
}

/** Returns the hash of the binding cookie, and sets the cookie first if the browser has none. */
export function browserBinding(req: Request, res: Response, settings: OAuthSettings): string {
  const name = cookieName(settings);
  const value = readCookie(req, name) ?? mintSecret();
  const secure = name.startsWith("__Host-") ? "; Secure" : "";
  res.append("Set-Cookie", `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`);
  return hashSecret(value);
}
