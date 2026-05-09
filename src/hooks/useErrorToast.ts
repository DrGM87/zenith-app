import { useCallback } from "react";
import { useZenithStore } from "../store";

export function useErrorToast() {
  const setZenithError = useZenithStore((s) => s.setZenithError);

  const showError = useCallback((message: string, details?: string) => {
    setZenithError({ message, details });
  }, [setZenithError]);

  const clearError = useCallback(() => {
    setZenithError(null);
  }, [setZenithError]);

  return { showError, clearError };
}
