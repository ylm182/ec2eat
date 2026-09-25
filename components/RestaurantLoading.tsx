"use client";
import { useEffect, useState } from "react";

/** A client-side estimate, never a claim of server progress. */
export function RestaurantLoading({ phase = "search" }: { phase?: "search" | "details" }) {
  // Keep the same clock as ranking transitions into loading restaurant details.
  const [estimate] = useState(() => phase === "search" ? 20 : 5);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, estimate - elapsed);
  const overdue = remaining === 0;
  const label = phase === "details" ? "整理緊餐廳資料" : "幫你揀緊好嘢食";
  return <div className="loading-overlay restaurant-loading">
    <div className="restaurant-loading-dial" aria-hidden="true">
      <div className="restaurant-loading-ring" />
      <span className="restaurant-loading-food">🍜</span>
    </div>
    <strong role="status" aria-live="polite">{overdue ? "比預期耐少少，仍在處理" : label}</strong>
    <div className="restaurant-loading-time" aria-live="off">
      <span>{overdue ? "已等候" : "預計仲有"}</span>
      <span className="restaurant-loading-number">{overdue ? elapsed : remaining}</span>
      <span>秒</span>
    </div>
    <p className="restaurant-loading-note">{overdue ? "完成後會自動顯示結果" : "時間係估算，完成即刻顯示"}</p>
  </div>;
}
