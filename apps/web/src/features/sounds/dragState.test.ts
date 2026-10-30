import { describe, expect, it } from "vitest";
import { preventFileNavigation } from "./dragState";

function dragEvent(type: string, types: string[]) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(e, "dataTransfer", { value: { types, dropEffect: "copy" } });
  return e;
}

describe("preventFileNavigation", () => {
  it("keeps a file dropped anywhere on the page from opening in the tab", () => {
    const stop = preventFileNavigation(window);
    const over = dragEvent("dragover", ["Files"]);
    document.body.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer?.dropEffect).toBe("none");
    const drop = dragEvent("drop", ["Files"]);
    document.body.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    stop();
    const later = dragEvent("drop", ["Files"]);
    document.body.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it("leaves text drags and drop zones that took the file alone", () => {
    const stop = preventFileNavigation(window);
    const text = dragEvent("drop", ["text/plain"]);
    document.body.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
    const zone = document.createElement("div");
    document.body.append(zone);
    zone.addEventListener("dragover", (e) => e.preventDefault());
    const over = dragEvent("dragover", ["Files"]);
    zone.dispatchEvent(over);
    expect(over.dataTransfer?.dropEffect).toBe("copy");
    zone.remove();
    stop();
  });
});
