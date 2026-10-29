import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  GOOGLE_CLOUD_PROJECT: z.string().min(1).default("teejayproject"),
  FIRESTORE_DATABASE: z.string().min(1).default("jam-db"),
  GOOGLE_CLOUD_REGION: z.string().min(1).default("asia-south1"),
  PREP_JOB: z.string().min(1).default("jam-prep"),
  STATIC_DIR: z.string().optional(),
  /** The public origin: the OAuth issuer, and `<origin>/mcp` is the MCP resource. */
  PUBLIC_URL: z.url().default("https://jam.tn07.dev"),
  /** The secret the Cloudflare Worker sends in X-Jam-Edge (Secret Manager JAM_EDGE_SECRET). */
  JAM_EDGE_SECRET: z.string().min(32).optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
