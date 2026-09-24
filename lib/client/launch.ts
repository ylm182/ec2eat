"use client";
// One ID per document opening; a 30-minute background return starts another opening.
let launchId: string | null = null;
export function currentLaunchId() {
  return (launchId ??= crypto.randomUUID());
}
export function newLaunchId() {
  launchId = crypto.randomUUID();
  return launchId;
}
