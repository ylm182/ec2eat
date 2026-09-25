"use client";
import { useEffect, useRef, useState } from "react";
import { authorizedJson } from "@/lib/client/decision-api";
import { loadGoogleMaps } from "@/lib/client/google-maps";
import type { RestaurantCard } from "@/lib/restaurants/types";

export function RestaurantMap({ uid, cards, onView }: {
  uid: string; cards: RestaurantCard[]; onView: (placeId: string) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const view = useRef(onView);
  view.current = onView;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [locationStatus, setLocationStatus] = useState("定位中…");
  const [attempt, setAttempt] = useState(0);
  const mapped = cards.filter(c => c.source === "google-places" && c.location);
  useEffect(() => {
    const controller = new AbortController();
    let watch: number | undefined;
    let listener: google.maps.MapsEventListener | undefined;
    let info: google.maps.InfoWindow | undefined;
    const globals = window as unknown as Record<string, unknown>;
    const oldAuthFailure = globals.gm_authFailure;
    const authFailure = () => { if (!controller.signal.aborted) { setLoading(false); setError("地圖暫時未能連接，可以用清單揀餐廳。"); } };
    globals.gm_authFailure = authFailure;
    setError(""); setLoading(true); setLocationStatus("定位中…");
    void (async () => {
      const config = await authorizedJson(uid, "/api/maps/config", undefined, controller.signal) as { apiKey: string };
      const maps = await loadGoogleMaps(config.apiKey);
      if (controller.signal.aborted || !canvas.current) return;
      const map = new maps.Map(canvas.current, {
        center: { lat: 22.3193, lng: 114.1694 }, zoom: 12, maxZoom: 18,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        gestureHandling: "greedy",
      });
      const bounds = new maps.LatLngBounds();
      cards.forEach((card, i) => {
        if (card.source !== "google-places" || !card.location) return;
        const point = { lat: card.location.latitude, lng: card.location.longitude };
        bounds.extend(point);
        map.data.add({ id: card.placeId, geometry: new maps.Data.Point(point), properties: { rank: i + 1, name: card.name ?? "餐廳" } });
      });
      map.data.setStyle(feature => {
        if (feature.getId() === "__user") return { clickable: false, zIndex: 100, icon: { path: maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#1a73e8", fillOpacity: 1, strokeColor: "white", strokeWeight: 3 } };
        const rank = Number(feature.getProperty("rank"));
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44"><path d="M18 43C14 35 2 26 2 18a16 16 0 1 1 32 0c0 8-12 17-16 25" fill="#7544c9" stroke="white" stroke-width="2"/><text x="18" y="24" text-anchor="middle" font-family="Arial" font-size="15" font-weight="bold" fill="white">${rank}</text></svg>`;
        return { icon: { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg), anchor: new maps.Point(18, 43) }, title: String(feature.getProperty("name")) };
      });
      if (!bounds.isEmpty()) map.fitBounds(bounds, 45);
      info = new maps.InfoWindow();
      listener = map.data.addListener("click", (event: google.maps.Data.MouseEvent) => {
        if (event.feature.getId() === "__user") return;
        const content = document.createElement("div");
        const name = document.createElement("p");
        name.textContent = `${event.feature.getProperty("rank")} · ${event.feature.getProperty("name")}`;
        const button = document.createElement("button");
        button.textContent = "查看餐廳";
        button.onclick = () => view.current(String(event.feature.getId()));
        content.append(name, button);
        info!.setContent(content); info!.setPosition(event.latLng); info!.open(map);
      });
      setLoading(false);
      if (!navigator.geolocation) { setLocationStatus("未能定位"); return; }
      let firstFix = true;
      watch = navigator.geolocation.watchPosition(position => {
        if (controller.signal.aborted) return;
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        const existing = map.data.getFeatureById("__user");
        if (existing) existing.setGeometry(new maps.Data.Point(point));
        else map.data.add({ id: "__user", geometry: new maps.Data.Point(point) });
        if (firstFix) { bounds.extend(point); map.fitBounds(bounds, 45); firstFix = false; }
        setLocationStatus("🔵 你的位置");
      }, () => { if (!controller.signal.aborted) setLocationStatus("未能定位；仍可查看餐廳"); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    })().catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "地圖暫時不可用"); setLoading(false); } });
    return () => {
      controller.abort();
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
      listener?.remove(); info?.close();
      if (globals.gm_authFailure === authFailure) globals.gm_authFailure = oldAuthFailure;
    };
  }, [uid, cards, attempt]);
  return <div className="restaurant-map-panel" role="region" aria-label="餐廳地圖">
    <div ref={canvas} className="restaurant-map-canvas" />
    {loading && <div className="map-loading" role="status"><div className="loading-orbit"><span>✦</span></div></div>}
    {error ? <div className="map-message" role="alert">{error}<button onClick={() => setAttempt(a => a + 1)}>重試</button></div> : <p className="map-status">{locationStatus} · {mapped.length} 間餐廳{mapped.length < cards.length ? "（部分位置未提供）" : ""}</p>}
  </div>;
}
