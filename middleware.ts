import { NextRequest, NextResponse } from "next/server";
const legacyHost = "ec2eat--ec2eat-davidyu-prod.asia-east1.hosted.app";
export function middleware(request: NextRequest) {
  // App Hosting preserves the public hostname here behind its Cloud Run proxy.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host === legacyHost) {
    const destination = new URL("https://ec2eat.fun");
    destination.pathname = request.nextUrl.pathname;
    destination.search = request.nextUrl.search;
    const response = NextResponse.redirect(destination, 308);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
