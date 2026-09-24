"use client";
import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
let connected = false;
export function clientAuth() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  if (!projectId || !apiKey || !authDomain) return null;
  const app = getApps()[0] ?? initializeApp({ projectId, apiKey, authDomain });
  const auth = getAuth(app);
  const emulator = process.env.NEXT_PUBLIC_AUTH_EMULATOR_URL;
  if (emulator && !connected) {
    if (
      process.env.NODE_ENV === "production" ||
      !projectId.startsWith("demo-") ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(emulator)
    )
      throw new Error("Invalid emulator configuration");
    connectAuthEmulator(auth, emulator);
    connected = true;
  }
  return auth;
}
