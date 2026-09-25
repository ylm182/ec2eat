"use client";
import { SelectionFireworks } from "./SelectionFireworks";
import { RestaurantMap } from "./RestaurantMap";
import { Loading } from "./Loading";
import { RestaurantLoading } from "./RestaurantLoading";
import { currentLaunchId } from "@/lib/client/launch";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  authorizedJson,
  decisionApi,
  DecisionApiError,
} from "@/lib/client/decision-api";
import type { DecisionSession } from "@/lib/domain/schema";
import type { Coordinates } from "@/lib/providers/contracts";
import {
  restaurantCardSchema,
  selectable,
  mapsUrl,
  type RestaurantCard,
} from "@/lib/restaurants/types";
export function RestaurantResults({
  uid,
  session,
  location,
  onSession,
  skipAuto = false,
}: {
  uid: string;
  session: DecisionSession;
  location: Coordinates | null;
  onSession: (s: DecisionSession) => void;
  skipAuto?: boolean;
}) {
  const [celebrate, setCelebrate] = useState(false);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [focusedPlace, setFocusedPlace] = useState<string | null>(null);
  useEffect(() => {
    if (view === "list" && focusedPlace) document.getElementById("restaurant-" + focusedPlace)?.scrollIntoView({ block: "nearest" });
  }, [view, focusedPlace]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [cards, setCards] = useState<RestaurantCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const locked = useRef(false),
    auto = useRef(false);
  const pending = useRef<{
    requestId: string;
    expectedRevision: number;
    reason: "automatic";
    expandArea?: boolean;
    location?: Coordinates;
  } | null>(null);
  const selection = useRef<{
    requestId: string;
    expectedRevision: number;
    placeId: string;
    launchId: string;
  } | null>(null);
  const path = "/api/decision/sessions/" + session.id;
  const callbacks = useRef({ session, onSession, location });
  callbacks.current = { session, onSession, location };
  async function refresh() {
    const fresh = await decisionApi(uid, path);
    if (mounted.current) callbacks.current.onSession(fresh);
    return fresh;
  }
  async function load(signal?: AbortSignal) {
    setDetailsLoading(true);
    try {
    const data = z
      .object({ cards: z.array(restaurantCardSchema).max(10) })
      .parse(
        await authorizedJson(uid, session.status === "SELECTED" ? `/api/history/${session.id}/restaurant` : path + "/restaurants", undefined, signal),
      );
    if (!signal?.aborted) setCards(data.cards);
    } finally { if (!signal?.aborted) setDetailsLoading(false); }
  }
  useEffect(() => {
    setCards([]);
    if (!["READY", "SELECTED"].includes(session.status)) return;
    const controller = new AbortController();
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "餐廳資料暫時不可用。");
    });
    return () =>
      controller.abort(); /* session changes always refresh current details. */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.revision, session.status]);
  async function search(expand = false) {
    auto.current = true;
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setSearching(true);
    setError("");
    const { session: current, location: coords } = callbacks.current;
    const body = pending.current ?? {
      requestId: crypto.randomUUID(),
      expectedRevision: current.revision,
      reason: "automatic" as const,
      ...(expand ? { expandArea: true } : {}),
      ...(coords ? { location: coords } : {}),
    };
    pending.current = body;
    try {
      await decisionApi(uid, path + "/recommend", body);
      pending.current = null;
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜尋暫時不可用。");
      if (
        e instanceof DecisionApiError &&
        ["STALE_REVISION", "INVALID_STATE", "INVALID_EXPANSION"].includes(
          e.code,
        )
      )
        pending.current = null;
      try {
        await refresh();
      } catch {
        /* Keep original error and retry identity. */
      }
    } finally {
      locked.current = false;
      setBusy(false);
      setSearching(false);
    }
  }
  useEffect(() => {
    if (
      session.status === "RECOMMENDING" &&
      !session.search &&
      !auto.current &&
      !skipAuto
    ) {
      auto.current = true;
      void search();
    } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status, session.search, skipAuto]);
  async function choose(placeId: string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    const body = selection.current ?? {
      requestId: crypto.randomUUID(),
      expectedRevision: session.revision,
      placeId,
      launchId: currentLaunchId(),
    };
    selection.current = body;
    try {
      const saved = await decisionApi(uid, path + "/select", body);
      selection.current = null;
      if (mounted.current) {
        setView("list");
        setCelebrate(saved.status === "SELECTED" && saved.decision.selectedPlaceId === placeId);
        callbacks.current.onSession(saved);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "未能儲存，請重試。");
      if (
        e instanceof DecisionApiError &&
        ["STALE_REVISION", "INVALID_SELECTION", "PLACE_CLOSED"].includes(e.code)
      )
        selection.current = null;
      try {
        await refresh();
      } catch {
        /* Keep the save error; map preview does not imply selection. */
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const selected = session.status === "SELECTED";
  const empty = session.search?.result === "empty";
  const visibleCards = selected ? cards.filter(c => c.placeId === session.decision.selectedPlaceId) : cards;
  useEffect(() => {
    if (selected && celebrate) successHeading.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [selected, celebrate]);
  return (
    <section aria-label="餐廳選擇" className="restaurant-results">
      {(searching || detailsLoading) ? <RestaurantLoading phase={searching ? "search" : "details"} /> : busy ? <Loading label="儲存中" /> : null}
      {error && <p role="alert">{error}</p>}
      {session.status === "RECOMMENDING" ? (
        <>
          <p role="status">
            {busy
              ? "搵緊附近餐廳…"
              : empty
                ? "呢個範圍暫時未有可用餐廳。"
                : "答案已儲存，可以繼續搜尋餐廳。"}
          </p>
          {empty && (
            <p>
              已搜尋 {session.search!.radiusM / 1000} 公里；唔會自動擴大範圍。
            </p>
          )}
          <button disabled={busy} onClick={() => search()}>
            重試搜尋
          </button>
          {empty && session.search!.radiusM < 10000 && !session.search!.expanded && !pending.current && (
            <button disabled={busy} onClick={() => search(true)}>
              擴大範圍再搵
            </button>
          )}
        </>
      ) : (
        <>
          {selected && <h2 ref={successHeading} role="status">已儲存你的選擇</h2>}
          {selected && celebrate && !detailsLoading && !busy && <SelectionFireworks onDone={() => setCelebrate(false)} />}
          {!selected && cards.length === 1 && <p>目前只搵到一間可用餐廳。</p>}
          {!visibleCards.length && !detailsLoading && <p>暫時未有餐廳資料。</p>}
          {!selected && <div className="results-tabs" aria-label="顯示方式">
            <button aria-pressed={view === "list"} onClick={() => setView("list")}>清單</button>
            <button aria-pressed={view === "map"} onClick={() => setView("map")}>地圖</button>
          </div>}
          {!selected && view === "map" ? <RestaurantMap uid={uid} cards={visibleCards} onView={id => { setFocusedPlace(id); setView("list"); }} /> : <div className="restaurant-grid" role="region" aria-label="餐廳推薦清單" tabIndex={0}>
            {visibleCards.map((card, index) => (
              <article className="restaurant-card" id={"restaurant-" + card.placeId} key={card.placeId}>
                <p>
                  {card.source === "synthetic" ? "合成測試資料 · " : ""}
                  {selected ? "今次食呢間" : index === 0 ? "1 · 首選推薦" : `${index + 1} · 推薦選擇`}
                  {session.decision.selectedPlaceId === card.placeId
                    ? " · 已選擇"
                    : ""}
                </p>
                {card.photo ? (
                  <>
                    <img
                      src={card.photo.url}
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                    <p className="hint">
                      <a href={card.photo.mapsUri} target="_blank" rel="noopener noreferrer">喺 Google Maps 睇原相</a>{" · "}
                      相片：
                      {card.photo.authors.map((a, i) =>
                        a.uri ? (
                          <a
                            key={i}
                            href={a.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {a.name}{" "}
                          </a>
                        ) : (
                          <span key={i}>{a.name} </span>
                        ),
                      )}
                    </p>
                  </>
                ) : (
                  <div className="photo-placeholder">暫未有相片</div>
                )}
                <h3>{card.name ?? "餐廳資料暫時不可用"}</h3>
                <p>{card.address ?? session.context.area}</p>
                <p>
                  {!card.available
                    ? "未能讀取最新資料"
                    : !selectable(card)
                      ? "目前休息或已停業"
                      : card.openNow === null
                        ? "營業時間未知，出發前請確認"
                        : "目前營業"}
                </p>
                <p>
                  價位：
                  {(
                    {
                      PRICE_LEVEL_FREE: "免費",
                      PRICE_LEVEL_INEXPENSIVE: "較相宜",
                      PRICE_LEVEL_MODERATE: "中等",
                      PRICE_LEVEL_EXPENSIVE: "較高",
                      PRICE_LEVEL_VERY_EXPENSIVE: "高",
                    } as Record<string, string>
                  )[card.priceLevel ?? ""] ?? "未知"}{" "}
                  · 評分：{card.rating === null ? "未知" : card.rating + " / 5"}
                </p>
                {card.distanceM !== null && (
                  <p>
                    與{session.context.area}中心直線距離約{" "}
                    {(card.distanceM / 1000).toFixed(1)} 公里（非步行距離）
                  </p>
                )}
                <div className="restaurant-actions">
                {!selected && (
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !card.available ||
                      !selectable(card) ||
                      (!!selection.current &&
                        selection.current.placeId !== card.placeId)
                    }
                    onClick={() => choose(card.placeId)}
                  >
                    {selection.current?.placeId === card.placeId
                      ? "重試儲存呢間"
                      : "揀呢間"}
                  </button>
                )}
                {card.source === "google-places" ? <a
                  className="restaurant-map-link"
                  href={mapsUrl(card.placeId)}
                  target="_blank" rel="noopener noreferrer"
                  aria-label={`在 Google Maps 查看${card.name ?? "餐廳"}`}
                ><span translate="no">Google Maps</span><span aria-hidden="true"> ↗</span></a>
                  : <button disabled className="restaurant-map-link">地圖未提供</button>}
                </div>
                {card.source === "google-places" && card.attributions.length > 0 && (
                  <div className="places-attribution">
                    {card.attributions.map((a, i) => (
                      <p key={i}>
                        {a.uri ? (
                          <a
                            href={a.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {a.name}
                          </a>
                        ) : (
                          a.name
                        )}
                      </p>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>}

          {selected && (
            <div className="hint">
              <p>選擇已儲存；食完可以喺歷史確認到訪。</p>

            </div>
          )}
        </>
      )}
    </section>
  );
}
