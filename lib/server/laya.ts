import "server-only";
import { providerMetric } from "./telemetry";
import type { Firestore } from "firebase-admin/firestore";
import { serverConfig } from "./config";
import { layaConfiguration } from "../laya/config";
import { LayaService } from "../laya/service";
import { FirestoreLayaStore } from "../laya/store";
export function layaService(db: Firestore) {
  serverConfig();
  const config = layaConfiguration(process.env);
  const service = new LayaService(
    config.provider,
    new FirestoreLayaStore(db),
    config.reason,
  );
  return {
    rank: (...args: Parameters<LayaService["rank"]>) =>
      providerMetric("laya", "rank", () => service.rank(...args)),
    warm: (...args: Parameters<LayaService["warm"]>) =>
      providerMetric("laya", "warm", () => service.warm(...args)),
  };
}
