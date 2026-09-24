import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { serverConfig } from "./config";
import { layaConfiguration } from "../laya/config";
import { LayaService } from "../laya/service";
import { FirestoreLayaStore } from "../laya/store";
export function layaService(db: Firestore) {
  serverConfig();
  const config = layaConfiguration(process.env);
  return new LayaService(
    config.provider,
    new FirestoreLayaStore(db),
    config.reason,
  );
}
