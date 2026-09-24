import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { layaConfiguration } from "../../lib/laya/config";
import { LayaService } from "../../lib/laya/service";
import { FirestoreLayaStore } from "../../lib/laya/store";
// The scheduler's service account invokes this function; no public app warm-up URL or shared secret.
const hfToken = defineSecret("HF_TOKEN");
initializeApp();
export const warmLaya = onSchedule(
  {
    schedule: "0 11,17 * * *",
    timeZone: "Asia/Hong_Kong",
    region: "asia-east1",
    timeoutSeconds: 150,
    maxInstances: 1,
    retryCount: 0,
    secrets: [hfToken],
  },
  async (event) => {
    const config = layaConfiguration({
      ...process.env,
      APP_MODE: "live",
      HF_TOKEN: hfToken.value(),
    });
    const result = await new LayaService(
      config.provider,
      new FirestoreLayaStore(getFirestore()),
      config.reason,
    ).warm(
      "scheduled",
      `scheduled:${event.scheduleTime}:${crypto.randomUUID()}`,
    );
    // No request bodies, credentials, user IDs, event text or candidate data in logs.
    console.info(JSON.stringify({ event: "laya_scheduled_warmup", ...result }));
  },
);
