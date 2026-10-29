import { useCallback, useState } from "react";

export function useLocalStorageFlag(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    return stored === null ? initial : stored === "1";
  });
  const set = useCallback(
    (next: boolean) => {
      localStorage.setItem(key, next ? "1" : "0");
      setValue(next);
    },
    [key],
  );
  return [value, set] as const;
}
