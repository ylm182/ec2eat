"use client";
import TinderCard from "react-tinder-card";
import { useRef } from "react";
import { QuestionArt } from "./QuestionArt";
export function EntrySwipe({ kind, disabled = false, onChoose }: {kind: "home" | "range" | "meal"; disabled?: boolean; onChoose: (direction: "left" | "right" | "up") => void}) {
  const lock = useRef(false);
  const left = kind === "meal" ? "正餐" : kind === "home" ? "之前食過" : "附近 · 3 km";
  const right = kind === "meal" ? "小食" : kind === "home" ? "今次食咩" : "周圍搵 · 10 km";
  const choose = (direction: string) => {
    if (disabled || lock.current || (direction !== "left" && direction !== "right" && !(kind === "meal" && direction === "up"))) return;
    lock.current = true;
    onChoose(direction as "left" | "right" | "up");
    // The parent disables synchronously while persisting; allow explicit retries afterwards.
    setTimeout(() => { lock.current = false; }, 500);
  };
  return <section className="entry-swipe" aria-label={kind === "meal" ? "正餐或小食" : kind === "home" ? "開始或歷史" : "搜尋範圍"}>
    <div className="swipe-surface" data-locked={disabled}>
      <TinderCard key={String(disabled)} className="tinder-question" preventSwipe={disabled ? ["left", "right", "up", "down"] : kind === "meal" ? ["down"] : ["up", "down"]} swipeRequirementType="position" swipeThreshold={85} onSwipe={choose}>
        <div className="question-face"><QuestionArt kind={kind}/><div className="question-options"><span>← {left}</span><span>{right} →</span></div></div>
      </TinderCard>
    </div>
    {kind === "meal" && <button className="text-button" disabled={disabled} onClick={() => choose("up")}>都得 ↑</button>}
    <div className="entry-actions"><button disabled={disabled} onClick={() => choose("left")}>← {left}</button><button disabled={disabled} onClick={() => choose("right")}>{right} →</button></div>
  </section>;
}
