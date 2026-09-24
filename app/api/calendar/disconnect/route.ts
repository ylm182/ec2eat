import { calendarRoute } from "@/lib/server/calendar-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return calendarRoute(request, "disconnect");
}
