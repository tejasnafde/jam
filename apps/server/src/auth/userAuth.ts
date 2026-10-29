import type { NextFunction, Request, Response } from "express";
import { bearerFrom } from "./bearer.js";

export interface PageUser {
  uid: string;
  email?: string;
}

/** Verifies a Firebase ID token. Injected so tests do not need Firebase. */
export type IdTokenVerifier = (idToken: string) => Promise<PageUser>;

export function requireUser(verify: IdTokenVerifier) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const bearer = bearerFrom(req);
    if (!bearer) return res.status(401).json({ error: "unauthorized" });
    try {
      req.user = await verify(bearer);
    } catch {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  };
}

/** The signed-in user. Only valid on routes behind requireUser. */
export function pageUser(req: Request): PageUser {
  if (!req.user) throw new Error("requireUser did not run");
  return req.user;
}
