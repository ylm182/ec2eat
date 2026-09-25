"use client";
import TinderCard from "react-tinder-card";
import { useRef } from "react";
import { QuestionArt } from "./QuestionArt";
export function EntrySwipe({ kind, disabled = false, onChoose }: {kind: "home" | "range"; disabled?: boolean; onChoose: (direction: "left" | "right") => void}) {
  const lock = useRef(false);
  const left = kind === "home" ? "之前食過" : "附近 · 3 km";
  const right = kind === "home" ? "今次食咩" : "周圍搵 · 10 km";
  const choose = (direction: string) => {
    if (disabled || lock.current || (direction !== "left" && direction !== "right")) return;
    lock.current = true;
    onChoose(direction);
    // The parent disables synchronously while persisting; allow explicit retries afterwards.
    setTimeout(() => { lock.current = false; }, 500);
  };
  return <section className="entry-swipe" aria-label={kind === "home" ? "開始或歷史" : "搜尋範圍"}>
    <div className="swipe-surface" data-locked={disabled}>
      <TinderCard key={String(disabled)} className="tinder-question" preventSwipe={disabled ? ["left", "right", "up", "down"] : ["up", "down"]} swipeRequirementType="position" swipeThreshold={85} onSwipe={choose}>
        <div className="question-face"><QuestionArt kind={kind}/><div className="question-options"><span>← {left}</span><span>{right} →</span></div></div>
      </TinderCard>
    </div>
    <div className="entry-actions"><button disabled={disabled} onClick={() => choose("left")}>← {left}</button><button disabled={disabled} onClick={() => choose("right")}>{right} →</button></div>
  </section>;
}
