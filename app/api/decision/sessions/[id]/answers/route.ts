import { decisionRoute } from "@/lib/server/decision-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return decisionRoute(request, "answer", (await context.params).id);
}
