import type { Principal } from "../auth/mcpAuth.js";
import type { PageUser } from "../auth/userAuth.js";

declare global {
  // Express merges request fields through this namespace.
  namespace Express {
    interface Request {
      principal?: Principal;
      user?: PageUser;
    }
  }
}

export {};
