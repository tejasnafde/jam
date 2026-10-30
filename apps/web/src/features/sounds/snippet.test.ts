import { describe, expect, it } from "vitest";
import type { SoundItem } from "./catalog";
import { fullSnippet, insertionFor, insertionForAll, isInsideString } from "./snippet";

const bd: SoundItem = { kind: "drum", name: "bd", key: "rolandtr909_bd", machine: "RolandTR909" };
const casio: SoundItem = { kind: "sample", name: "casio", key: "casio" };
const flute: SoundItem = { kind: "instrument", name: "gm_flute", key: "gm_flute" };
const saw: SoundItem = { kind: "synth", name: "sawtooth", key: "sawtooth" };
const white: SoundItem = { kind: "synth", name: "white", key: "white" };
const mine: SoundItem = { kind: "yours", name: "my_loop", key: "my_loop" };

/** Inserts at the "|" in a template and returns the result. */
function drop(template: string, item: SoundItem) {
  const pos = template.indexOf("|");
  const code = template.replace("|", "");
  const { from, text } = insertionFor(code, pos, item);
  return code.slice(0, from) + text + code.slice(from);
}

describe("full snippets", () => {
  it("writes the right line for each kind", () => {
    expect(fullSnippet(bd)).toBe('s("bd").bank("RolandTR909")');
    expect(fullSnippet(casio)).toBe('s("casio")');
    expect(fullSnippet(flute)).toBe('note("c3").s("gm_flute")');
    expect(fullSnippet(saw)).toBe('note("c3").s("sawtooth")');
    expect(fullSnippet(white)).toBe('s("white")');
    expect(fullSnippet(mine)).toBe('s("my_loop")');
  });
});

describe("string detection", () => {
  it("knows when a position is inside a string", () => {
    const code = `s("bd sd").bank('x') // "not"\n/* "no" */ note(\`c3\`)`;
    expect(isInsideString(code, code.indexOf("bd"))).toBe(true);
    expect(isInsideString(code, code.indexOf(".bank"))).toBe(false);
    expect(isInsideString(code, code.indexOf("x"))).toBe(true);
    expect(isInsideString(code, code.indexOf("not"))).toBe(false);
    expect(isInsideString(code, code.indexOf('no"'))).toBe(false);
    expect(isInsideString(code, code.indexOf("c3"))).toBe(true);
  });

  it("follows escaped quotes", () => {
    const code = 's("a \\" b")';
    expect(isInsideString(code, code.indexOf("b"))).toBe(true);
    expect(isInsideString(code, code.length)).toBe(false);
  });
});

describe("insertion", () => {
  it("inserts only the name inside a string, with spaces where words would touch", () => {
    expect(drop('s("bd |")', casio)).toBe('s("bd casio")');
    expect(drop('s("bd|")', casio)).toBe('s("bd casio")');
    expect(drop('s("|bd")', casio)).toBe('s("casio bd")');
    expect(drop('s("bd|sd")', casio)).toBe('s("bdsd casio")');
    expect(drop('s("bd*|2, hh")', casio)).toBe('s("bd*2 casio, hh")');
    expect(drop('s("b|d sd")', casio)).toBe('s("bd casio sd")');
    expect(drop('s("|")', casio)).toBe('s("casio")');
    expect(drop('s("[bd |]")', casio)).toBe('s("[bd casio]")');
    expect(drop('s("<|hh>")', casio)).toBe('s("<casio hh>")');
  });

  it("inserts a drum part's name only, and leaves .bank to the user", () => {
    expect(drop('s("hh |")', bd)).toBe('s("hh bd")');
  });

  it("inserts the full snippet outside a string", () => {
    expect(drop("$: |", bd)).toBe('$: s("bd").bank("RolandTR909")');
    expect(drop("|", flute)).toBe('note("c3").s("gm_flute")');
    expect(drop("stack(|)", casio)).toBe('stack(s("casio"))');
  });

  it("inserts several dropped files: spaces in a string, lines outside", () => {
    const a: SoundItem = { kind: "yours", name: "a1", key: "a1" };
    const b: SoundItem = { kind: "yours", name: "b2", key: "b2" };
    expect(insertionForAll('s("bd")', 5, [a, b]).text).toBe(" a1 b2");
    expect(insertionForAll("", 0, [a, b]).text).toBe('s("a1")\ns("b2")');
    expect(insertionForAll("", 9, [a]).from).toBe(0);
  });
});
