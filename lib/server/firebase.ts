import "server-only";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { serverConfig } from "./config";
export function adminServices() {
  const config = serverConfig();
  const app =
    getApps().find((a) => a.name === "ec2eat") ??
    initializeApp(
      {
        projectId: config.GOOGLE_CLOUD_PROJECT,
        ...(config.APP_MODE === "live"
          ? { credential: applicationDefault() }
          : {}),
      },
      "ec2eat",
    );
  return { auth: getAuth(app), db: getFirestore(app) };
}
