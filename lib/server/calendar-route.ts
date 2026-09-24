import "server-only";
import { NextResponse } from "next/server";
import { authenticate } from "./auth";
import { adminServices } from "./firebase";
import { apiResponse, ApiError, requireOrigin } from "./http";
import { calendarSettings, configuredCalendar } from "./calendar-oauth";
import { serverConfig } from "./config";
import { bounded } from "../providers/google-context";
const cookieName = "ec2eat-calendar-state";
export function calendarRoute(
  request: Request,
  action: "start" | "status" | "disconnect",
) {
  return apiResponse(async () => {
    const user = await authenticate(request);
    if (action !== "status") requireOrigin(request);
    const { db } = adminServices();
    if (action === "status") {
      const connection = (
        await db.doc(`oauthConnections/${user.uid}`).get()
      ).data();
      return {
        configured: Boolean(calendarSettings()),
        connected: Boolean(connection?.encryptedRefreshToken),
        fixture:
          serverConfig().APP_MODE === "emulator"
            ? (process.env.CONTEXT_FIXTURE ?? null)
            : null,
      };
    }
    if (!calendarSettings())
      throw new ApiError(
        503,
        "CALENDAR_NOT_CONFIGURED",
        "Calendar 未設定好，你可以照常開始選擇。",
      );
    const auth = configuredCalendar(db);
    if (action === "disconnect") return auth.disconnect(user.uid);
    const result = await auth.begin(user.uid);
    return result;
  }).then(async (response) => {
    if (action !== "start" || !response.ok) return response;
    const envelope = await response.json();
    const binding = envelope.data.binding;
    delete envelope.data.binding;
    const next = NextResponse.json(envelope, { headers: response.headers });
    next.cookies.set(cookieName, binding, {
      httpOnly: true,
      secure: serverConfig().APP_MODE === "live",
      sameSite: "lax",
      path: "/api/calendar/callback",
      maxAge: 600,
    });
    return next;
  });
}
export async function calendarCallback(request: Request) {
  const config = serverConfig();
  const redirect = new URL("/decide", config.APP_ORIGIN);
  try {
    const params = new URL(request.url).searchParams;
    const binding =
      (request.headers.get("cookie") ?? "")
        .split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1) ?? "";
    const auth = configuredCalendar(adminServices().db);
    const identity = await auth.consume(params.get("state") ?? "", binding);
    if (params.has("error")) redirect.searchParams.set("calendar", "declined");
    else {
      await bounded(8000, (s) =>
        auth.finish(identity, params.get("code") ?? "", s),
      );
      redirect.searchParams.set("calendar", "connected");
    }
  } catch {
    redirect.searchParams.set("calendar", "failed");
  }
  const response = NextResponse.redirect(redirect, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(cookieName, "", {
    httpOnly: true,
    secure: config.APP_MODE === "live",
    sameSite: "lax",
    path: "/api/calendar/callback",
    maxAge: 0,
  });
  return response;
}
