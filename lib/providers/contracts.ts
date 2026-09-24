import type {
  Dimension,
  Preference,
  QuestionDefinition,
} from "../domain/schema";
export type Feature = {
  value: number | null;
  confidence: number;
  source: "rule" | "user" | "provider";
};
export type DecisionInput = {
  version: 1;
  stage: "archetype" | "restaurant";
  candidates: {
    id: string;
    categoryId?: string;
    distanceM?: number;
    features: Partial<Record<Dimension, Feature>>;
  }[];
  preferences: Record<Dimension, Preference>;
  priors: Partial<Record<Dimension, Preference>>;
  categoryPreference?: string | null;
  context: { rain: boolean | null; nextEventSoon: boolean | null };
};
export type DecisionResult = {
  version: 1;
  entries: { id: string; score: number; weight: number }[];
  confidence: number | null;
  confidenceKind: "provider_uncalibrated" | "none";
  provider: "laya" | "heuristic";
  model: string | null;
  revision: string | null;
  latencyMs: number;
  fallbackReason: string | null;
};
export interface DecisionProvider {
  rank(input: DecisionInput, signal: AbortSignal): Promise<DecisionResult>;
  warm(signal: AbortSignal): Promise<{ ready: boolean }>;
}
export type ContextHints = {
  version: 1;
  nextEventSoon: boolean | null;
  socialHint: boolean | null;
};
export interface LanguageProvider {
  extractContext(
    input: { text: string; now: string },
    signal: AbortSignal,
  ): Promise<ContextHints>;
  phrase(input: QuestionDefinition, signal: AbortSignal): Promise<string>;
}
export type Coordinates = { latitude: number; longitude: number };
export type Sourced<T> = {
  value: T;
  source: "google-places" | "google-weather" | "google-calendar";
  fetchedAt: string;
  expiresAt: string | null;
  persistAllowed: boolean;
  modelInputAllowed: boolean;
};
export type PlaceCandidate = {
  placeId: string;
  name: Sourced<string> | null;
  area: Sourced<string> | null;
  businessStatus: Sourced<string> | null;
  openNow: Sourced<boolean> | null;
};
export type PlaceDetails = PlaceCandidate & {
  priceLevel: Sourced<number> | null;
  rating: Sourced<number> | null;
  mapsUri: Sourced<string> | null;
  photo: Sourced<{ url: string; attribution: string[] }> | null;
  attribution: string[];
};
export interface PlacesProvider {
  search(
    input: { location: Coordinates; radiusM: number; archetypeIds: string[] },
    signal: AbortSignal,
  ): Promise<PlaceCandidate[]>;
  details(placeId: string, signal: AbortSignal): Promise<PlaceDetails>;
}
export interface CalendarProvider {
  context(
    uid: string,
    window: { from: string; to: string },
    signal: AbortSignal,
  ): Promise<Sourced<ContextHints> | null>;
}
export interface WeatherProvider {
  current(
    location: Coordinates,
    signal: AbortSignal,
  ): Promise<Sourced<{
    condition: string;
    temperatureC: number | null;
  }> | null>;
}
