import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/** Parses the body, or answers 400 and returns null. */
export function parseBody<S extends z.ZodType>(schema: S, req: Request, res: Response): z.output<S> | null {
  const parsed = schema.safeParse(req.body ?? {});
  if (parsed.success) return parsed.data;
  res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
  return null;
}
