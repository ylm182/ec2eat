import "server-only";
import { assertDataActive } from "./data-guard";
import { adminServices } from "./firebase";
import { ApiError } from "./http";
import { idSchema } from "../domain/schema";
const verified: unique symbol = Symbol("verified-user");
export type VerifiedUser = { readonly uid: string; readonly [verified]: true };
export type AuthDependencies = {
  verify(token: string): Promise<{ uid: string; provider: string | undefined }>;
  allowed(uid: string): Promise<boolean>;
};
const firebaseDependencies: AuthDependencies = {
  async verify(token) {
    const decoded = await adminServices().auth.verifyIdToken(token, true);
    return { uid: decoded.uid, provider: decoded.firebase.sign_in_provider };
  },
  async allowed(uid) {
    return (
      (await adminServices().db.doc(`allowedUsers/${uid}`).get()).data()
        ?.enabled === true
    );
  },
};
export async function authenticate(
  request: Request,
  dependencies: AuthDependencies = firebaseDependencies,
  allowDeleted = false,
): Promise<VerifiedUser> {
  const match = /^Bearer ([^\s]+)$/.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match) throw new ApiError(401, "UNAUTHENTICATED", "請先登入。");
  let identity;
  try {
    identity = await dependencies.verify(match[1]);
    idSchema.parse(identity.uid);
  } catch {
    throw new ApiError(401, "UNAUTHENTICATED", "登入已失效，請重新登入。");
  }
  if (
    identity.provider !== "google.com" ||
    !(await dependencies.allowed(identity.uid))
  )
    throw new ApiError(403, "NOT_ALLOWED", "此帳戶未獲邀請。");
  if (dependencies === firebaseDependencies && !allowDeleted)
    await assertDataActive(adminServices().db, identity.uid);
  return Object.freeze({ uid: identity.uid, [verified]: true as const });
}
