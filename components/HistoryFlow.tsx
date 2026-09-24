"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Account } from "./Account";
import { HistoryCard } from "./HistoryCard";
import { authorizedJson, DecisionApiError } from "@/lib/client/decision-api";
import { historyPageSchema } from "@/lib/history/schema";
import type { DecisionSession } from "@/lib/domain/schema";
export function HistoryFlow() {
  const [uid, setUid] = useState<string | null>(null);
  return (
    <>
      <Account onAuthorizationChange={setUid} />
      {uid ? (
        <HistoryList key={uid} uid={uid} />
      ) : (
        <p>登入獲邀帳戶後，就可以睇返自己的選擇。</p>
      )}
      <p>
        <Link href="/decide">開始另一次選擇 →</Link>
      </p>
    </>
  );
}
function HistoryList({ uid }: { uid: string }) {
  const [sessions, setSessions] = useState<DecisionSession[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [resetRequired, setResetRequired] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  async function load(reset = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const path =
        "/api/history" +
        (!reset && cursor ? "?cursor=" + encodeURIComponent(cursor) : "");
      const page = historyPageSchema.parse(
        await authorizedJson(uid, path, undefined, abort.signal),
      );
      if (abort.signal.aborted) return;
      setSessions((previous) =>
        reset
          ? page.sessions
          : [
              ...previous,
              ...page.sessions.filter(
                (s) => !previous.some((p) => p.id === s.id),
              ),
            ],
      );
      setCursor(page.nextCursor);
      setLoaded(true);
      setResetRequired(false);
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(e instanceof Error ? e.message : "暫時未能載入歷史。");
        setResetRequired(
          e instanceof DecisionApiError && e.code === "INVALID_CURSOR",
        );
      }
    } finally {
      if (controller.current === abort) {
        locked.current = false;
        if (!abort.signal.aborted) setBusy(false);
      }
    }
  }
  useEffect(() => {
    void load(true);
    return () => {
      controller.current?.abort();
      locked.current = false;
    }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section aria-label="已選擇記錄">
      <button
        className="text-button"
        disabled={busy}
        onClick={() => load(true)}
      >
        重新載入最新記錄
      </button>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">載入歷史中…</p>}
      {loaded && !sessions.length && (
        <div className="empty">
          <h2>未有已選擇記錄</h2>
          <p>明確揀咗餐廳之後，記錄就會喺呢度出現。未完成嘅問題唔會列入。</p>
        </div>
      )}
      <div className="history-list">
        {sessions.map((s) => (
          <HistoryCard key={s.id} uid={uid} session={s} />
        ))}
      </div>
      {!busy && error && (
        <button onClick={() => load(!loaded || resetRequired)}>
          重試{resetRequired ? "最新記錄" : ""}
        </button>
      )}
      {cursor && !resetRequired && (
        <button disabled={busy} onClick={() => load()}>
          載入更多選擇
        </button>
      )}
      {loaded && sessions.length > 0 && !cursor && (
        <p className="hint">已到最後一筆記錄。</p>
      )}
    </section>
  );
}
