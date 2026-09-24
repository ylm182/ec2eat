import { readFileSync } from "node:fs";
const app = readFileSync("apphosting.yaml", "utf8"),
  worker = readFileSync("functions/src/index.ts", "utf8");
const checks = [
  [
    "App Hosting declared Taiwan; minimum 0, maximum 2",
    /asia-east1/.test(app) &&
      /minInstances: 0/.test(app) &&
      /maxInstances: 2/.test(app),
  ],
  ["Firestore declared Hong Kong", /asia-east2/.test(app)],
  [
    "Scheduled worker Taiwan, one instance, HKT schedule",
    /region: "asia-east1"/.test(worker) &&
      /maxInstances: 1/.test(worker) &&
      /Asia\/Hong_Kong/.test(worker),
  ],
  ["Gemini fixed context model", /gemini-3.5-flash-lite/.test(app)],
];
for (const [label, ok] of checks)
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
console.log(
  "Local declarations do not prove deployed regions, quotas, retention or billing configuration.",
);
if (process.argv.includes("--live")) {
  const required = [
    "GOOGLE_CLOUD_PROJECT",
    "APP_ORIGIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "GOOGLE_PLACES_API_KEY",
    "OAUTH_CLIENT_ID",
    "OAUTH_CLIENT_SECRET",
    "CALENDAR_KMS_KEY",
    "LAYA_BASE_URL",
    "HF_TOKEN",
    "LAYA_MODEL_REVISION",
    "LAYA_RUNTIME_VERSION",
  ];
  for (const key of required)
    if (!process.env[key]) {
      console.log(`BLOCKED missing ${key}`);
      process.exitCode = 1;
    }
  if (
    process.env.APP_MODE !== "live" ||
    !process.env.APP_ORIGIN?.startsWith("https://") ||
    process.env.GOOGLE_CLOUD_PROJECT?.startsWith("demo-") ||
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.CONTEXT_FIXTURE ||
    process.env.PLACES_FIXTURE
  ) {
    console.log("BLOCKED live mode/origin/project/fixture isolation");
    process.exitCode = 1;
  }
  if (
    /installedRecipe[^=]*= null/.test(
      readFileSync("lib/laya/recipe.ts", "utf8"),
    )
  ) {
    console.log("BLOCKED verified Laya recipe is not installed");
    process.exitCode = 1;
  }
  const gates = [
    "regions",
    "firebase-auth",
    "calendar-kms",
    "gemini-smoke",
    "laya-contract",
    "places-permissions",
    "weather-retention",
    "quotas-budgets",
    "logs-alerts",
    "hk-device",
    "rollback",
    "dependency-review",
  ];
  let evidence = {};
  try {
    evidence = JSON.parse(
      readFileSync(process.env.EC2EAT_RELEASE_EVIDENCE ?? "", "utf8"),
    );
  } catch {
    /* no evidence supplied */
  }
  for (const gate of gates) {
    const item = evidence[gate];
    const age = Date.now() - Date.parse(item?.verifiedAt);
    const ok =
      item?.status === "passed" &&
      typeof item?.reference === "string" &&
      item.reference.length > 10 &&
      Number.isFinite(age) &&
      age >= 0 &&
      age <= 7 * 86400000;
    console.log(
      `${ok ? "RECORDED" : "BLOCKED"} ${gate} evidence (reviewed within seven days)`,
    );
    if (!ok) process.exitCode = 1;
  }
  console.log(
    "Evidence is an operator attestation; this offline check does not query or deploy cloud resources.",
  );
}
