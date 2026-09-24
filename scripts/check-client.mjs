import { readdir, readFile } from "node:fs/promises";
const forbidden = [
  "EC2EAT_SECRET_CANARY_7f21",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "HF_TOKEN",
  "OAUTH_CLIENT_SECRET",
  "firebase-admin",
  "GOOGLE_WEATHER_API_KEY",
  "CALENDAR_KMS_KEY",
  "encryptedRefreshToken",
];
async function walk(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    const name = `${path}/${item.name}`;
    if (item.isDirectory()) await walk(name);
    else if (name.endsWith(".js")) {
      const text = await readFile(name, "utf8");
      for (const marker of forbidden)
        if (text.includes(marker))
          throw new Error(`Server-only marker in client bundle: ${marker}`);
    }
  }
}
await walk(".next/static");
console.log(
  "Client bundle scan passed: server package, secret names and injected secret canary absent.",
);
