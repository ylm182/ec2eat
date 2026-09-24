"use client";
import { useEffect, useState } from "react";
import { authorizedJson } from "@/lib/client/decision-api";
export function CalendarConnection({ uid }: { uid: string }) {
  const [status, setStatus] = useState<{
    configured: boolean;
    connected: boolean;
    fixture: string | null;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void authorizedJson(uid, "/api/calendar/status")
      .then((data) => {
        if (active) setStatus(data);
      })
      .catch(() => {
        if (active) setMessage("未能查看 Calendar 連接；你可以照常開始。");
      });
    const result = new URLSearchParams(window.location.search).get("calendar");
    if (result)
      setMessage(
        result === "connected"
          ? "Calendar 已連接。"
          : result === "declined"
            ? "未授權 Calendar，照常繼續。"
            : "Calendar 連接未完成，可以再試或照常繼續。",
      );
    return () => {
      active = false;
    };
  }, [uid]);
  async function act() {
    setBusy(true);
    setMessage("");
    try {
      if (status?.connected) {
        const result = await authorizedJson(
          uid,
          "/api/calendar/disconnect",
          {},
        );
        setStatus({ ...status, connected: false });
        setMessage(
          result.revoked
            ? "Calendar 已斷開。"
            : "已停止讀取 Calendar；Google 撤銷未完成，可到 Google 帳戶權限頁移除授權。",
        );
      } else {
        const result = await authorizedJson(uid, "/api/calendar/start", {});
        window.location.assign(result.url);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Calendar 未能連接。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Calendar 連接" className="context-panel">
      <p>
        Calendar（可選）：只讀取附近行程，用嚟了解用餐時間；唔會更改行程。Google
        登入唔等於授權 Calendar。
      </p>
      {status?.fixture && (
        <p role="status">
          測試情境：{status.fixture}。天氣及行程均為合成資料。
        </p>
      )}
      {status && !status.configured && <p>Calendar 尚未接通，可直接開始。</p>}
      {status?.configured && (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={act}
        >
          {busy
            ? "處理中…"
            : status.connected
              ? "斷開 Calendar"
              : "連接唯讀 Calendar"}
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
