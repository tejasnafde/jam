import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";

describe("logger", () => {
  it("writes one JSON object per line and respects the level", () => {
    const lines: string[] = [];
    const log = createLogger("info", (l) => lines.push(l));
    log.debug("hidden");
    log.info("shown", { uid: "u1" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ severity: "INFO", message: "shown", uid: "u1" });
  });
});
