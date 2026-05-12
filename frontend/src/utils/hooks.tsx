import { useCallback } from 'react';

export function useSyncRotation(rotation, setRotation) {
  return useCallback(
    newRotation => {
      if (newRotation.equals(rotation)) {
        return;
      }
      setRotation(newRotation);
    },
    [rotation, setRotation],
  );
}
