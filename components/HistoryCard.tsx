"use client";
import { DeleteSession } from "./DataControls";
import { OutcomeForm } from "./OutcomeForm";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { authorizedJson } from "@/lib/client/decision-api";
import type { DecisionSession } from "@/lib/domain/schema";
import { hongKongTime, outcomeLabels } from "@/lib/history/schema";
import {
  restaurantCardSchema,
  type RestaurantCard,
  selectable,
} from "@/lib/restaurants/types";
const meal = { lunch: "午餐", dinner: "晚餐", other: "其他時段" };
const stop = {
  weight_margin: "排序差距已足夠",
  max_questions: "已答滿六題",
  exhausted: "沒有其他合適問題",
  user_requested: "你選擇提早睇結果",
};
export function HistoryCard({
  uid,
  session: s,
}: {
  uid: string;
  session: DecisionSession;
}) {
  const [flipped, setFlipped] = useState(false);
  const [visible, setVisible] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [card, setCard] = useState<RestaurantCard | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const root = useRef<HTMLElement>(null);
  const panel = useId();
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    setBusy(true);
    setError("");
    setCard(null);
    void authorizedJson(
      uid,
      "/api/history/" + s.id + "/restaurant",
      undefined,
      abort.signal,
    )
      .then((data) => {
        const result = z
          .object({ cards: z.array(restaurantCardSchema).max(1) })
          .parse(data).cards[0];
        if (!result || result.placeId !== s.decision.selectedPlaceId)
          throw new Error("目前餐廳資料暫時不可用。");
        if (!abort.signal.aborted) setCard(result);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "目前餐廳資料暫時不可用。");
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [uid, s.id, s.decision.selectedPlaceId, visible, attempt]);
  return (
    <article
      className="history-card"
      ref={root}
      aria-label={hongKongTime(s.selectedAt!) + "的選擇"}
    >
      <button
        className="text-button history-flip"
        aria-pressed={flipped}
        aria-controls={panel}
        onClick={() => setFlipped((v) => !v)}
      >
        {flipped ? "返餐廳資料" : "睇返點揀"}
      </button>
      <div id={panel} className="history-face" key={flipped ? "back" : "front"}>
        {!flipped ? (
          <>
            <p className="eyebrow">
              {meal[s.context.meal]} · {s.context.area}
            </p>
            <h2>{card?.name ?? "已選擇餐廳"}</h2>
            <p className="history-id">餐廳編號：{s.decision.selectedPlaceId}</p>
            <p>
              選擇時間：
              <time dateTime={s.selectedAt!}>
                {hongKongTime(s.selectedAt!)}（香港時間）
              </time>
            </p>
            <p className="history-outcome">{outcomeLabels[s.outcome.status]}</p>
            {s.outcome.status === "VISITED_OTHER" && (
              <p>
                {s.outcome.actualPlaceId
                  ? "實際餐廳編號：" + s.outcome.actualPlaceId
                  : "未有記錄實際餐廳。"}
              </p>
            )}
            {s.outcome.confirmedAt && (
              <p>確認時間：{hongKongTime(s.outcome.confirmedAt)}（香港時間）</p>
            )}
            {s.outcome.status === "PENDING" && s.outcome.snoozedUntil && (
              <p className="hint">
                自動提醒已暫停至 {hongKongTime(s.outcome.snoozedUntil)}
                （香港時間）之後另一次開啟。你仍可以喺歷史自行確認。
              </p>
            )}
            <details className="history-outcome-editor">
              <summary>
                {s.outcome.status === "PENDING"
                  ? "確認用餐結果"
                  : "更正用餐結果"}
              </summary>
              <OutcomeForm uid={uid} session={s} />
            </details>
            <section aria-label="目前餐廳資料">
              <h3>目前餐廳資料</h3>
              <p className="hint">名稱、相片及營業狀態會更新，唔係當日快照。</p>
              {busy && <p role="status">讀取目前資料中…</p>}
              {error && (
                <p role="status">{error} 原本選擇及問題記錄仍然保留。</p>
              )}
              {card?.source === "synthetic" && (
                <p>合成測試資料，唔係真實餐廳。</p>
              )}
              {card?.photo ? (
                <>
                  <img
                    className="history-photo"
                    src={card.photo.url}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                  <p className="hint">
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
              {card?.available ? (
                <>
                  <p>{card.address ?? "地址暫時未知"}</p>
                  <p>
                    {!selectable(card)
                      ? "目前休息或已停業"
                      : card.openNow === null
                        ? "目前營業時間未知"
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
                    · 評分：
                    {card.rating === null ? "未知" : card.rating + " / 5"}
                  </p>
                  <p className="hint">
                    讀取時間：{hongKongTime(card.fetchedAt)}（香港時間）
                  </p>
                </>
              ) : (
                !busy && <p>目前資料不可用；可以翻轉睇返點揀。</p>
              )}
              {card?.source === "google-places" && (
                <div className="places-attribution">
                  <span translate="no">Google Maps</span>
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
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setVisible(true);
                  setAttempt((v) => v + 1);
                }}
              >
                重新載入目前資料
              </button>
            </section>
          </>
        ) : (
          <>
            <h2>當時點樣揀</h2>
            <p>以下係當時儲存嘅問題及答案；翻卡唔會更改選擇。</p>
            <ol className="history-trail">
              {s.questions.map((q) => {
                const answer = s.answers.find(
                  (a) => a.questionInstanceId === q.instanceId,
                );
                return (
                  <li key={q.instanceId}>
                    <h3>{q.definition.prompt}</h3>
                    <ul>
                      {q.definition.options.map((o, i) => (
                        <li key={o.id}>
                          {q.definition.kind === "binary"
                            ? i === 0
                              ? "左："
                              : "右："
                            : ""}
                          {o.label}
                        </li>
                      ))}
                    </ul>
                    <p>
                      <strong>當時答案：</strong>
                      {!answer
                        ? "未回答（已停止提問）"
                        : answer.action === "neutral"
                          ? "都得／冇所謂（向上，保持中立）"
                          : q.definition.options.find(
                              (o) => o.id === answer.optionId,
                            )?.label}
                    </p>
                  </li>
                );
              })}
            </ol>
            <h3>當時情境</h3>
            <p>
              {meal[s.context.meal]} · {s.context.area} ·{" "}
              {s.context.locationSource === "gps" ? "定位地區" : "手動地區"} ·{" "}
              {hongKongTime(s.context.capturedAt)}（香港時間）
            </p>
            {s.context.availability.fixture === "available" && (
              <p>合成測試情境</p>
            )}
            <p>
              天氣：
              {s.context.weather
                ? s.context.weather.condition +
                  (s.context.weather.temperatureC === null
                    ? ""
                    : " · " + s.context.weather.temperatureC + "°C")
                : "未有可顯示記錄（未知或已到保留期限）"}
            </p>
            {s.context.weather?.provenance.source === "google-weather" && (
              <p className="hint">天氣資料：Google Weather</p>
            )}
            <p>
              行程：
              {s.context.calendar
                ? s.context.calendar.nextEventSoon
                  ? "當時一小時內有定時行程"
                  : "當時未有一小時內定時行程提示"
                : "未有可顯示記錄（未連接、未知或已到保留期限）"}
            </p>
            {s.context.calendar?.socialHint !== null &&
              s.context.calendar?.socialHint !== undefined && (
                <p>
                  同行提示：
                  {s.context.calendar.socialHint
                    ? "當時有聚餐提示"
                    : "當時未有聚餐提示"}
                </p>
              )}
            <h3>原本餐廳排序</h3>
            <ol>
              {s.decision.candidates.map((c) => (
                <li className="history-id" key={c.placeId}>
                  {c.placeId}
                  {c.placeId === s.decision.recommendedPlaceId
                    ? " · 首選推薦"
                    : ""}
                  {c.placeId === s.decision.selectedPlaceId ? " · 你揀咗" : ""}{" "}
                  · 排序權重 {(c.weight * 100).toFixed(1)}%
                </li>
              ))}
            </ol>
            <p>{s.decision.reason}</p>
            <p>
              排序方式：
              {s.decision.provider === "laya"
                ? "Laya"
                : "確定性規則（heuristic）"}
              ；模型／規則版本：{s.decision.modelRevision ?? "未有記錄"}
            </p>
            <p>備援原因：{s.decision.fallbackReason ?? "沒有使用備援"}</p>
            <p>
              停止原因：
              {s.decision.stopReason ? stop[s.decision.stopReason] : "未有記錄"}
            </p>
            <p>
              信心記錄：
              {s.decision.confidenceKind === "provider_uncalibrated"
                ? "模型未校準信心（provider_uncalibrated）"
                : "沒有模型信心（none）"}
              {s.decision.confidence === null
                ? ""
                : " · " + s.decision.confidence}
            </p>
            <p className="hint">排序權重及模型信心唔係你會鍾意呢餐嘅機率。</p>
          </>
        )}
      </div>
      <DeleteSession uid={uid} session={s} />
    </article>
  );
}
