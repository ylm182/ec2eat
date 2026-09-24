"use client";
import { CalendarConnection } from "./CalendarConnection";
import { useState } from "react";
import { authorizedJson } from "@/lib/client/decision-api";
import { clientAuth } from "@/lib/client/firebase";
import { signOut } from "firebase/auth";
import type { DecisionSession } from "@/lib/domain/schema";
/** Reload discards opening caches, pending UI responses and active decision pointers. */
function clearLocal(uid: string) {
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i)!;
    if (key.includes(uid) && key.startsWith("ec2eat"))
      sessionStorage.removeItem(key);
  }
}
export function DeleteSession({
  uid,
  session,
}: {
  uid: string;
  session: DecisionSession;
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await authorizedJson(uid, `/api/sessions/${session.id}/delete`, {
        confirm: true,
        expectedRevision: session.revision,
      });
      clearLocal(uid);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除失敗，請重試。");
      setBusy(false);
    }
  }
  return (
    <div>
      {confirm ? (
        <>
          <p>永久刪除呢次選擇同答案？個人偏好同到訪次數會重新計算。</p>
          <button disabled={busy} onClick={remove}>
            {busy ? "刪除中…" : "確認刪除呢次選擇"}
          </button>
          <button disabled={busy} onClick={() => setConfirm(false)}>
            取消
          </button>
        </>
      ) : (
        <button className="text-button" onClick={() => setConfirm(true)}>
          刪除呢次選擇
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function AccountDataControls({ uid }: { uid: string }) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function remove() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await authorizedJson(uid, "/api/account/delete", {
        confirm: "DELETE",
      });
      clearLocal(uid);
      window.localStorage.setItem(
        "ec2eat:data-deleted",
        result.revoked ? "deleted" : "revoke-needed",
      );
      const auth = clientAuth();
      if (auth) await signOut(auth);
      window.location.assign("/");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "刪除未完成，請重試。");
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>管理個人資料</summary>
      <CalendarConnection uid={uid} />
      <p>只會參考最近 20 次確認去過所選餐廳嘅明確答案；今次答案永遠優先。</p>
      <p>
        刪除全部資料會移除選擇、答案、個人偏好、到訪記錄同 Calendar 連接。Google
        帳戶不受影響。管理員保留最少存取及刪除標記；再次使用需要管理員重新啟用。
      </p>
      {confirm ? (
        <>
          <p>確定永久刪除全部 ec2eat 個人資料？</p>
          <button disabled={busy} onClick={remove}>
            {busy ? "刪除中…" : "永久刪除全部資料"}
          </button>
          <button disabled={busy} onClick={() => setConfirm(false)}>
            取消
          </button>
        </>
      ) : (
        <button onClick={() => setConfirm(true)}>刪除全部資料</button>
      )}
      {message && <p role="alert">{message}</p>}
    </details>
  );
}
