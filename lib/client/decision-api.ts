"use client";
import { clientAuth } from "./firebase";
import { sessionSchema } from "../domain/schema";
export class DecisionApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function authorizedJson(
  uid: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  const user = clientAuth()?.currentUser;
  if (!user || user.uid !== uid)
    throw new DecisionApiError("UNAUTHENTICATED", "請重新登入。");
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
    cache: "no-store",
  });
  const result = await response.json();
  if (clientAuth()?.currentUser?.uid !== uid)
    throw new DecisionApiError("UNAUTHENTICATED", "請重新登入。");
  if (!response.ok)
    throw new DecisionApiError(result.error.code, result.error.message);
  return result.data;
}

export async function decisionApi(
  uid: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  return sessionSchema.parse(await authorizedJson(uid, path, body, signal));
}
