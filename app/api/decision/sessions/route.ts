import { decisionRoute } from "@/lib/server/decision-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return decisionRoute(request, "create");
}
