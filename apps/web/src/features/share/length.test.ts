import { describe, expect, it } from "vitest";
import {
  activePlays,
  arrangeCycles,
  barsToSeconds,
  DEFAULT_BARS,
  guessPlay,
  sequenceCycles,
  maxBarsAt,
  sequenceLength,
} from "./length";

const SCHRANZ = `setcpm(150/4)
const kick1 = s("bd*4").hpf("<2000 1000 400 100 30!19>").gain(.4)
const hats1 = s("hh(4,8,3)").gain(.4)
const stab1 = note("<c4 d4 f4 g4>(3,8,1)")
  .s("sqr").decay(.3)

// SECTIONS
const intro = stack(
  kick1  .mask("<1!20 0!4>"),          // bars 1-20
  hats1  .mask("<0!3 1!17 0!4>"),      // bars 4-20
)
const build = stack(kick1, hats1)

const song = arrange(
  [24, intro],
  [16, build],
  [32, build],
)

// $: song
$: intro
// $: build
`;

describe("sequenceLength", () => {
  it("expands !n repeats", () => {
    expect(sequenceLength("1!20 0!4")).toBe(24);
    expect(sequenceLength("0!3 1!17 0!4")).toBe(24);
    expect(sequenceLength("2000 1000 400 100 30!19")).toBe(23);
  });

  it("counts plain steps, @ weights, bare ! and nested groups as one step each", () => {
    expect(sequenceLength("c4 d4 f4 g4")).toBe(4);
    expect(sequenceLength("a@3 b")).toBe(4);
    expect(sequenceLength("a ! ! b")).toBe(4);
    expect(sequenceLength("[a b] <c d> e")).toBe(3);
    expect(sequenceLength("a b, c d e")).toBe(3);
  });
});

describe("sequenceCycles", () => {
  it("finds the <...> in mini-notation strings only", () => {
    expect(sequenceCycles('s("<bd sd>").mask("<1!20 0!4>")')).toBe(24);
    expect(sequenceCycles("const x = a < b && c > d")).toBe(0);
    expect(sequenceCycles('note("[<c e> g]")')).toBe(2);
    expect(sequenceCycles("note(`<a b c>`)")).toBe(3);
  });

  it("applies /n and *n after a sequence, and .slow(n) and .fast(n) on the expression", () => {
    expect(sequenceCycles('note("<c e g>/2")')).toBe(6);
    expect(sequenceCycles('note("<c e g>").slow(2)')).toBe(6);
    expect(sequenceCycles('note("<c e g b>").fast(2)')).toBe(2);
    // 1.5 cycles a pass: 3 bars hold two whole passes.
    expect(sequenceCycles('note("<c e g>*2")')).toBe(3);
  });

  it("multiplies a nested sequence, and lines up sequences with the least common multiple", () => {
    expect(sequenceCycles('note("<a <b c>>")')).toBe(4);
    expect(sequenceCycles('note("<a b c>").s("<x y>")')).toBe(6);
    expect(sequenceCycles('note("<a b c> <x y>")')).toBe(6);
  });
});

describe("arrangeCycles", () => {
  it("sums the cycle counts", () => {
    expect(arrangeCycles("arrange([24, intro], [16, build], [32, peak])")).toBe(72);
    expect(arrangeCycles('arrange([4, s("[bd sd]")], [2.5, x])')).toBe(6.5);
    expect(arrangeCycles("stack(a, b)")).toBeNull();
  });
});

describe("guessPlay", () => {
  it("follows $: intro to its definition: <1!20 0!4> is 24 bars", () => {
    expect(guessPlay(SCHRANZ)).toEqual({ label: "$: intro", bars: 24, source: "sequence", capped: false });
  });

  it("sums an arrange that the played name points to", () => {
    const code = SCHRANZ.replace("\n$: intro", "\n// $: intro").replace("// $: song", "$: song");
    expect(guessPlay(code)).toEqual({ label: "$: song", bars: 72, source: "arrange", capped: false });
  });

  it("ignores commented-out $: lines", () => {
    expect(activePlays(SCHRANZ)).toEqual(["intro"]);
  });

  it("lines up several $: patterns: 3 and 2 bars repeat after 6", () => {
    expect(guessPlay('$: s("<bd sd hh>")\n$: note("<c e>")').bars).toBe(6);
  });

  it("takes the longest of several $: patterns", () => {
    const g = guessPlay('$: s("<bd sd hh>")\n$: note("<c e g b d f>").s("sine")');
    expect(g.bars).toBe(6);
    expect(g.label).toBe('$: s("<bd sd hh>") + 1 more');
  });

  it("reads a chained expression over several lines", () => {
    expect(guessPlay('$: note("c3")\n  .s("saw")\n  .lpf("<200 400 800 1600 3200>")').bars).toBe(5);
  });

  it("defaults to 8 bars when nothing tells", () => {
    expect(guessPlay('$: s("bd*4, hh*8")')).toEqual({
      label: '$: s("bd*4, hh*8")',
      bars: DEFAULT_BARS,
      source: "default",
      capped: false,
    });
    expect(guessPlay("").bars).toBe(DEFAULT_BARS);
  });

  it("clamps to 1..256", () => {
    expect(guessPlay('$: s("<bd!300>")')).toMatchObject({ bars: 256, capped: true });
  });
});

describe("tempo", () => {
  it("turns bars into seconds at the current cps", () => {
    // setcpm(150/4): 37.5 cycles a minute.
    expect(barsToSeconds(24, 37.5 / 60)).toBeCloseTo(38.4);
    expect(maxBarsAt(37.5 / 60)).toBe(150);
    expect(maxBarsAt(4)).toBe(256);
  });
});
