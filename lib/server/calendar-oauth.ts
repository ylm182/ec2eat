import "server-only";
import { assertDataActive } from "./data-guard";
import { createHash, randomBytes } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import { z } from "zod";
import { ApiError } from "./http";
import { serverConfig } from "./config";
import {
  bounded,
  googleAccessToken,
  jsonRequest,
  ProviderFailure,
  type Transport,
} from "../providers/google-context";
export const CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export interface TokenVault {
  seal(uid: string, token: string, signal: AbortSignal): Promise<string>;
  open(uid: string, ciphertext: string, signal: AbortSignal): Promise<string>;
}
export class KmsTokenVault implements TokenVault {
  constructor(
    private resource: string,
    private token = googleAccessToken,
    private transport: Transport = fetch,
  ) {
    if (
      !/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+$/.test(
        resource,
      )
    )
      throw new Error("Invalid KMS resource");
  }
  private async call(
    uid: string,
    operation: "encrypt" | "decrypt",
    value: string,
    signal: AbortSignal,
  ) {
    const access = await this.token();
    signal.throwIfAborted();
    const data = await jsonRequest(
      `https://cloudkms.googleapis.com/v1/${this.resource}:${operation}`,
      {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          [operation === "encrypt" ? "plaintext" : "ciphertext"]: value,
          additionalAuthenticatedData: Buffer.from(
            `ec2eat-calendar:${uid}`,
          ).toString("base64"),
        }),
      },
      this.transport,
    );
    return z
      .object({
        ciphertext: z.string().optional(),
        plaintext: z.string().optional(),
      })
      .parse(data);
  }
  async seal(uid: string, token: string, signal: AbortSignal) {
    const result = (
      await this.call(
        uid,
        "encrypt",
        Buffer.from(token).toString("base64"),
        signal,
      )
    ).ciphertext;
    if (!result) throw new Error("KMS encryption failed");
    return result;
  }
  async open(uid: string, value: string, signal: AbortSignal) {
    const result = (await this.call(uid, "decrypt", value, signal)).plaintext;
    if (!result) throw new Error("KMS decryption failed");
    return Buffer.from(result, "base64").toString("utf8");
  }
}
export type OAuthSettings = {
  clientId: string;
  clientSecret: string;
  origin: string;
};
export function calendarSettings(): OAuthSettings | null {
  const config = serverConfig();
  if (
    config.APP_MODE !== "live" ||
    !process.env.OAUTH_CLIENT_ID ||
    !process.env.OAUTH_CLIENT_SECRET ||
    !process.env.CALENDAR_KMS_KEY
  )
    return null;
  return {
    clientId: process.env.OAUTH_CLIENT_ID,
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
    origin: config.APP_ORIGIN,
  };
}
export function configuredCalendar(db: Firestore) {
  const settings = calendarSettings();
  if (!settings) throw new ProviderFailure("absent");
  return new CalendarAuthorization(
    db,
    settings,
    new KmsTokenVault(process.env.CALENDAR_KMS_KEY!),
  );
}
export class CalendarAuthorization {
  constructor(
    private db: Firestore,
    private settings: OAuthSettings,
    private vault: TokenVault,
    private transport: Transport = fetch,
  ) {}
  async begin(uid: string) {
    const state = randomBytes(32).toString("base64url"),
      binding = randomBytes(32).toString("base64url");
    const connection = this.db.doc(`oauthConnections/${uid}`),
      stateRef = this.db.doc(`oauthStates/${sha(state)}`);
    await this.db.runTransaction(async (tx) => {
      await assertDataActive(this.db, uid, tx);
      const current = await tx.get(connection);
      const data = current.data();
      if (data?.lastBeginAt?.toMillis() > Date.now() - 10000)
        throw new ApiError(429, "RATE_LIMITED", "請稍後再連接 Calendar。");
      const generation = randomBytes(16).toString("hex");
      tx.set(
        connection,
        { generation, lastBeginAt: Timestamp.now() },
        { merge: true },
      );
      tx.create(stateRef, {
        uid,
        binding: sha(binding),
        generation,
        expiresAt: Timestamp.fromMillis(Date.now() + 600000),
      });
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    Object.entries({
      client_id: this.settings.clientId,
      redirect_uri: `${this.settings.origin}/api/calendar/callback`,
      response_type: "code",
      scope: CALENDAR_SCOPE,
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state,
    }).forEach(([k, v]) => url.searchParams.set(k, v));
    return { url: url.href, binding };
  }
  async consume(state: string, binding: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !binding)
      throw new ApiError(400, "INVALID_STATE", "Calendar 連接已失效，請重試。");
    return this.db.runTransaction(async (tx) => {
      const ref = this.db.doc(`oauthStates/${sha(state)}`);
      const saved = await tx.get(ref);
      const data = saved.data();
      if (
        !data ||
        data.binding !== sha(binding) ||
        data.expiresAt.toMillis() <= Date.now()
      )
        throw new ApiError(
          400,
          "INVALID_STATE",
          "Calendar 連接已失效，請重試。",
        );
      const [allowed, connection] = await Promise.all([
        tx.get(this.db.doc(`allowedUsers/${data.uid}`)),
        tx.get(this.db.doc(`oauthConnections/${data.uid}`)),
      ]);
      if (
        allowed.data()?.enabled !== true ||
        connection.data()?.generation !== data.generation
      )
        throw new ApiError(403, "NOT_ALLOWED", "Calendar 連接已取消。");
      tx.delete(ref);
      return { uid: data.uid as string, generation: data.generation as string };
    });
  }
  private async tokenRequest(
    body: Record<string, string>,
    signal: AbortSignal,
  ) {
    const response = await this.transport(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        signal,
        cache: "no-store",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          ...body,
          client_id: this.settings.clientId,
          client_secret: this.settings.clientSecret,
        }),
      },
    );
    const text = await response.text();
    if (text.length > 16384) throw new ProviderFailure("failed");
    const raw = JSON.parse(text);
    if (!response.ok) {
      if (raw.error === "invalid_grant") throw new ProviderFailure("denied");
      throw new ProviderFailure("failed");
    }
    return z
      .object({
        access_token: z.string().min(1),
        refresh_token: z.string().min(1).optional(),
        scope: z.string().optional(),
        expires_in: z.number().positive(),
        token_type: z.string(),
      })
      .parse(raw);
  }
  async finish(
    identity: { uid: string; generation: string },
    code: string,
    signal: AbortSignal,
  ) {
    if (!code || code.length > 4096)
      throw new ApiError(422, "INVALID_INPUT", "Calendar 連接回應不正確。");
    const tokens = await this.tokenRequest(
      {
        code,
        grant_type: "authorization_code",
        redirect_uri: `${this.settings.origin}/api/calendar/callback`,
      },
      signal,
    );
    if (
      !tokens.scope?.split(" ").includes(CALENDAR_SCOPE) ||
      !tokens.refresh_token
    )
      throw new ProviderFailure("denied");
    const encryptedRefreshToken = await this.vault.seal(
      identity.uid,
      tokens.refresh_token,
      signal,
    );
    signal.throwIfAborted();
    await this.db.runTransaction(async (tx) => {
      await assertDataActive(this.db, identity.uid, tx);
      const ref = this.db.doc(`oauthConnections/${identity.uid}`);
      const [connection, allowed] = await Promise.all([
        tx.get(ref),
        tx.get(this.db.doc(`allowedUsers/${identity.uid}`)),
      ]);
      if (
        connection.data()?.generation !== identity.generation ||
        allowed.data()?.enabled !== true
      )
        throw new ProviderFailure("denied");
      tx.set(ref, {
        encryptedRefreshToken,
        scopes: [CALENDAR_SCOPE],
        generation: identity.generation,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        this.db.doc(`users/${identity.uid}`),
        { calendarConnected: true, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    });
  }
  async access(uid: string, signal: AbortSignal) {
    const data = (await this.db.doc(`oauthConnections/${uid}`).get()).data();
    if (!data?.encryptedRefreshToken) throw new ProviderFailure("absent");
    try {
      const refresh = await this.vault.open(
        uid,
        data.encryptedRefreshToken,
        signal,
      );
      const result = await this.tokenRequest(
        { refresh_token: refresh, grant_type: "refresh_token" },
        signal,
      );
      if (result.scope && !result.scope.split(" ").includes(CALENDAR_SCOPE))
        throw new ProviderFailure("denied");
      return {
        token: result.access_token,
        generation: data.generation as string,
      };
    } catch (e) {
      if (e instanceof ProviderFailure && e.code === "denied")
        await this.clear(uid, data.generation);
      throw e;
    }
  }
  async isCurrent(uid: string, generation: string) {
    const data = (await this.db.doc(`oauthConnections/${uid}`).get()).data();
    return (
      data?.generation === generation && Boolean(data.encryptedRefreshToken)
    );
  }
  async clear(uid: string, generation?: string) {
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.doc(`oauthConnections/${uid}`);
      const deletion = await tx.get(this.db.doc(`dataDeletions/${uid}`));
      const existing = await tx.get(ref);
      if (deletion.exists) {
        tx.delete(ref);
        return;
      }
      if (generation && existing.data()?.generation !== generation) return;
      tx.set(ref, {
        generation: randomBytes(16).toString("hex"),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        this.db.doc(`users/${uid}`),
        { calendarConnected: false, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    });
  }
  async disconnect(uid: string) {
    const data = (await this.db.doc(`oauthConnections/${uid}`).get()).data();
    await this.clear(uid); // Immediately invalidate outstanding callbacks and local authorization.
    if (!data?.encryptedRefreshToken) return { revoked: true };
    try {
      await bounded(3000, async (signal) => {
        const token = await this.vault.open(
          uid,
          data.encryptedRefreshToken,
          signal,
        );
        const response = await this.transport(
          "https://oauth2.googleapis.com/revoke",
          {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token }),
          },
        );
        if (!response.ok) throw new Error("Revocation unavailable");
      });
      return { revoked: true };
    } catch {
      return { revoked: false };
    }
  }
}
