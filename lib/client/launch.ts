"use client";
let launchId: string | null = null;
let watching = false;
export function currentLaunchId() {
  if (typeof document !== "undefined" && !watching) {
    watching = true;
    let hiddenAt: number | null = document.hidden ? Date.now() : null;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) hiddenAt = Date.now();
      else {
        if (hiddenAt !== null && Date.now() - hiddenAt >= 30 * 60000)
          newLaunchId();
        hiddenAt = null;
      }
    });
  }
  return (launchId ??= crypto.randomUUID());
}
export function newLaunchId() {
  launchId = crypto.randomUUID();
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("ec2eat:opening"));
  return launchId;
}
