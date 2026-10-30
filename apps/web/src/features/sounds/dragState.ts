import type { SoundItem } from "./catalog";

/** The drag data type for a sound row. Other apps ignore it; text/plain carries the full snippet. */
export const SOUND_MIME = "application/x-jam-sound";

// A dragover event cannot read the drag data, only its types. The row being dragged is kept here,
// so the editor can show what a drop will insert while the pointer moves.
let current: SoundItem | null = null;

export const setDraggedSound = (item: SoundItem | null) => {
  current = item;
};
export const draggedSound = () => current;

/** The sound in a drop event, from the drag data or, failing that, the row being dragged. */
export function soundFromDrop(data: DataTransfer | null): SoundItem | null {
  const raw = data?.getData(SOUND_MIME);
  if (raw) {
    try {
      return JSON.parse(raw) as SoundItem;
    } catch {
      return current;
    }
  }
  return current;
}

export const hasSound = (data: DataTransfer | null) => !!data && [...data.types].includes(SOUND_MIME);
export const hasFiles = (data: DataTransfer | null) => !!data && [...data.types].includes("Files");
