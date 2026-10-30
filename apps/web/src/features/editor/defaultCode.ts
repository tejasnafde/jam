// Strudel binds both Ctrl and Alt. On a Mac, Ctrl+Enter opens the context menu, so show Option there.
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
export const PLAY_KEY = IS_MAC ? "Option" : "Ctrl";
/** The editor's undo key: Cmd+Z on a Mac. */
export const UNDO_KEY = IS_MAC ? "Cmd" : "Ctrl";

export const DEFAULT_CODE = `// Welcome to jam. ${PLAY_KEY}+Enter plays, ${PLAY_KEY}+. stops.
// Your coach can read this, but only your hands can change it.
setcpm(90/4)

$: s("bd*2, ~ sd, hh*4").bank("RolandTR909").gain(.8)

$: note("<c2 eb2 g1 bb1>").s("sawtooth").lpf(700).decay(.3).sustain(0)
`;

export const LOCAL_CODE_KEY = "jam:code";
