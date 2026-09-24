"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { currentLaunchId } from "@/lib/client/launch";
import { authorizedJson } from "@/lib/client/decision-api";
import { sessionSchema, type DecisionSession } from "@/lib/domain/schema";
import { hongKongTime } from "@/lib/history/schema";
import { OutcomeForm } from "./OutcomeForm";
// Shared across StrictMode effects and client navigation; no browser persistence.
const requests = new Map<string, Promise<unknown>>();
const shown = new Set<string>();
function open(uid: string, launchId: string) {
  const key = uid + ":" + launchId;
  if (!requests.has(key))
    requests.set(
      key,
      authorizedJson(uid, "/api/app/open", {
        requestId: "open-" + launchId,
        launchId,
      }).catch((e) => {
        requests.delete(key);
        throw e;
      }),
    );
  return requests.get(key)!;
}
export function AppWarmup({ uid }: { uid: string }) {
  const [prompt, setPrompt] = useState<DecisionSession | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => {
      const launch = currentLaunchId();
      const key = uid + ":" + launch;
      setPrompt(null);
      setError("");
      void open(uid, launch)
        .then((raw) => {
          if (!active || currentLaunchId() !== launch || shown.has(key)) return;
          const data = raw as { session: unknown };
          const s =
            data.session === null ? null : sessionSchema.parse(data.session);
          shown.add(key);
          setPrompt(s);
        })
        .catch(() => {
          if (active && currentLaunchId() === launch)
            setError("暫時未能讀取待確認記錄；其他功能仍然可用。");
        });
    };
    const updated = (event: Event) => {
      const s = (event as CustomEvent<DecisionSession>).detail;
      if (s.uid === uid)
        setPrompt((old) =>
          old?.id === s.id
            ? s.outcome.status !== "PENDING" || s.outcome.snoozedUntil
              ? null
              : s
            : old,
        );
    };
    load();
    window.addEventListener("ec2eat:opening", load);
    window.addEventListener("ec2eat:outcome", updated);
    return () => {
      active = false;
      window.removeEventListener("ec2eat:opening", load);
      window.removeEventListener("ec2eat:outcome", updated);
    };
  }, [uid, retry]);
  return (
    <>
      {error && (
        <p role="status">
          {error}{" "}
          <button onClick={() => setRetry((v) => v + 1)}>重試待確認記錄</button>
        </p>
      )}
      {prompt && (
        <section className="outcome-prompt" aria-label="上次用餐確認">
          <h2>上次有冇去食？</h2>
          {prompt.search?.source === "synthetic" && <p>合成測試選擇</p>}
          <p>
            {hongKongTime(prompt.selectedAt!)} · {prompt.context.area}
          </p>
          <p className="history-id">
            當時揀咗：{prompt.decision.selectedPlaceId}
          </p>
          <p>
            <Link href="/history">睇返餐廳及當時選擇 →</Link>
          </p>
          <OutcomeForm
            key={prompt.id}
            uid={uid}
            session={prompt}
            onSaved={() => setPrompt(null)}
          />
        </section>
      )}
    </>
  );
}
