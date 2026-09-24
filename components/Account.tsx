"use client";
import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { clientAuth } from "@/lib/client/firebase";
import { AppWarmup } from "./AppWarmup";
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
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
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
      {state === "loading" && <p role="status">{copy.account.loading}</p>}
      {state === "setup" && <p>{copy.setup}</p>}
      {state === "signed-out" && (
        <button className="primary" disabled={busy} onClick={login}>
          {busy ? copy.account.signingIn : copy.login}
          <span aria-hidden>↗</span>
        </button>
      )}
      {message && <p role="status">{message}</p>}
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
    </section>
  );
}
