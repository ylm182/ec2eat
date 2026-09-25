"use client";
import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { clientAuth } from "@/lib/client/firebase";
import { AccountDataControls } from "./DataControls";
import { AppWarmup } from "./AppWarmup";
import { CalendarConnection } from "./CalendarConnection";
import { Loading } from "./Loading";
import { copy } from "@/lib/copy";
export function Account({
  onAuthorizationChange,
}: {
  onAuthorizationChange?: (uid: string | null) => void;
}) {
  const [state, setState] = useState<
    "loading" | "setup" | "signed-out" | "allowed" | "denied"
  >("loading");
  const [verifiedUid, setVerifiedUid] = useState<string | null>(null);
  const [deletionUid, setDeletionUid] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const deleted = localStorage.getItem("ec2eat:data-deleted");
    if (deleted) {
      setMessage(
        deleted === "revoke-needed"
          ? "資料已刪除。Google 撤銷未確認；請到 Google 帳戶「第三方連接」移除 ec2eat 權限。"
          : "個人資料已刪除。",
      );
      localStorage.removeItem("ec2eat:data-deleted");
    }
    let active = true;
    let sequence = 0;
    const auth = clientAuth();
    if (!auth) {
      setState("setup");
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const current = ++sequence;
      setVerifiedUid(null);
      setDeletionUid(null);
      if (!user) {
        onAuthorizationChange?.(null);
        setState("signed-out");
        return;
      }
      onAuthorizationChange?.(null);
      setState("loading");
      try {
        const response = await fetch("/api/profile", {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
          cache: "no-store",
        });
        const body = await response.json();
        if (!active || current !== sequence) return;
        setVerifiedUid(response.ok ? user.uid : null);
        if (body.error?.code === "DATA_DELETED") setDeletionUid(user.uid);
        onAuthorizationChange?.(response.ok ? user.uid : null);
        setState(response.ok ? "allowed" : "denied");
        setMessage(response.ok ? copy.account.allowed : body.error.message);
      } catch {
        if (active && current === sequence) {
          onAuthorizationChange?.(null);
          setState("denied");
          setMessage(copy.account.connectionFailed);
        }
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [onAuthorizationChange]);
  async function login() {
    setBusy(true);
    setMessage("");
    try {
      const auth = clientAuth();
      if (auth) await signInWithPopup(auth, new GoogleAuthProvider());
    } catch {
      setMessage(copy.account.signInFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account" aria-label={copy.account.label}>
      {verifiedUid && <AppWarmup uid={verifiedUid} />}
      <details className="account-menu"><summary aria-label="帳戶設定">⚙</summary><div className="settings-panel">
      <h2>帳戶設定</h2>
      {verifiedUid && <CalendarConnection uid={verifiedUid} />}
      {(verifiedUid || deletionUid) && (
        <AccountDataControls uid={(verifiedUid || deletionUid)!} />
      )}
      {message && state !== "allowed" && <p role="status">{message}</p>}
      {(state === "allowed" || state === "denied") && (
        <button
          className="text-button"
          onClick={() => {
            const auth = clientAuth();
            if (auth) void signOut(auth).then(() => setMessage(""));
          }}
        >
          {copy.logout}
        </button>
      )}
      </div></details>
      {state === "loading" && <Loading label="登入中" />}
      {(state === "denied" || state === "signed-out") && message && <p role="alert">{message}</p>}
      {state === "setup" && <p>{copy.setup}</p>}
      {state === "signed-out" && (
        <button className="primary" disabled={busy} onClick={login}>
          {busy ? copy.account.signingIn : copy.login}
          <span aria-hidden>↗</span>
        </button>
      )}

    </section>
  );
}
