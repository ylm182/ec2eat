import type { LanguageProvider, PlacesProvider } from "./contracts";
// Deterministic absence is not a successful external integration.
export const templateLanguage: LanguageProvider = {
  async extractContext(_input, signal) {
    signal.throwIfAborted();
    return { version: 1, nextEventSoon: null, socialHint: null };
  },
  async phrase(input, signal) {
    signal.throwIfAborted();
    return input.prompt;
  },
};
export const unconfiguredPlaces: PlacesProvider = {
  async search(_input, signal) {
    signal.throwIfAborted();
    throw new Error("PLACES_NOT_CONFIGURED");
  },
  async details(_id, signal) {
    signal.throwIfAborted();
    throw new Error("PLACES_NOT_CONFIGURED");
  },
};
export function mayPersist(
  field: { persistAllowed: boolean; expiresAt: string | null },
  now: number,
) {
  return (
    field.persistAllowed &&
    (field.expiresAt === null || Date.parse(field.expiresAt) > now)
  );
}
export function maySendToModel(
  field: { modelInputAllowed: boolean; expiresAt: string | null },
  now: number,
) {
  return (
    field.modelInputAllowed &&
    (field.expiresAt === null || Date.parse(field.expiresAt) > now)
  );
}
