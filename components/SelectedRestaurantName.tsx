"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { authorizedJson } from "@/lib/client/decision-api";
import { restaurantCardSchema, type RestaurantCard } from "@/lib/restaurants/types";
export function SelectedRestaurantName({ uid, sessionId, placeId }: { uid: string; sessionId: string; placeId: string | null }) {
  const [card, setCard] = useState<RestaurantCard | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setCard(null); setLoading(true);
    void authorizedJson(uid, `/api/history/${sessionId}/restaurant`, undefined, abort.signal)
      .then(raw => {
        const result = z.object({ cards: z.array(restaurantCardSchema).max(1) }).parse(raw).cards[0];
        if (!abort.signal.aborted && result?.placeId === placeId) setCard(result);
      })
      .catch(() => { /* Missing live details must never expose an ID as a name. */ })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [uid, sessionId, placeId]);
  return <div><p>當時揀咗：{loading ? "讀取餐廳名稱中…" : card?.name ?? "上次所選餐廳（名稱暫時未能讀取）"}</p>
    {card?.source === "google-places" && <div className="places-attribution"><span translate="no">Google Maps</span>{card.attributions.map((a, i) => <p key={i}>{a.uri ? <a href={a.uri} target="_blank" rel="noopener noreferrer">{a.name}</a> : a.name}</p>)}</div>}
  </div>;
}
