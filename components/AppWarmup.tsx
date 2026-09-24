"use client";
import { currentLaunchId, newLaunchId } from "@/lib/client/launch";
import { useEffect } from "react";
import { authorizedJson } from "@/lib/client/decision-api";
// Runs alongside context/session restoration; never gates the first question.
export function AppWarmup({ uid }: { uid: string }) {
  useEffect(() => {
    currentLaunchId();
    const warm = () => {
      void authorizedJson(uid, "/api/app-open", {}).catch(() => {});
    };
    let hiddenAt: number | null = document.hidden ? Date.now() : null;
    const visibility = () => {
      if (document.hidden) hiddenAt = Date.now();
      else {
        if (hiddenAt !== null && Date.now() - hiddenAt >= 30 * 60000) {
          newLaunchId();
          warm();
        }
        hiddenAt = null;
      }
    };
    warm();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [uid]);
  return null;
}
