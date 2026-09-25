"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import TinderCard from "react-tinder-card";
import type { z } from "zod";
import { answerInput, type QuestionDefinition } from "@/lib/domain/schema";
import { QuestionArt } from "./QuestionArt";
import { Loading } from "./Loading";
import { copy } from "@/lib/copy";

export type SwipeSubmission = z.infer<typeof answerInput>;
export type IssuedSwipeQuestion = {
  instanceId: string;
  definition: QuestionDefinition;
};
type Direction = "left" | "right" | "up" | "down";
type AnswerDirection = Exclude<Direction, "down">;
type Status = "idle" | "saving" | "error" | "saved";
export type DecisionSwipeCardProps = {
  question: IssuedSwipeQuestion;
  expectedRevision: number;
  progress: number;
  onSubmit: (answer: SwipeSubmission, signal: AbortSignal) => Promise<void>;
  onAnswered?: (answer: SwipeSubmission) => void;
};
const PREVENT_DOWN = ["down"];
const SAVE_TIMEOUT_MS = 10_000;
const directionFor = (answer: SwipeSubmission): AnswerDirection =>
  answer.action === "neutral" ? "up" : (answer.action as "left" | "right");

// A changed instance gets an independent lock/request ID and cannot inherit a late callback.
export function DecisionSwipeCard(props: DecisionSwipeCardProps) {
  if (props.question.definition.kind !== "binary")
    throw new Error("Binary question required");
  return <QuestionCard key={props.question.instanceId} {...props} />;
}

export function DecisionCategoryCard(props: DecisionSwipeCardProps) {
  if (props.question.definition.kind !== "category")
    throw new Error("Category question required");
  return <QuestionCard key={props.question.instanceId} {...props} />;
}

function QuestionCard({
  question,
  expectedRevision,
  progress,
  onSubmit,
  onAnswered,
}: DecisionSwipeCardProps) {
  const left = question.definition.options.find(
    (option) => option.id === "left",
  );
  const right = question.definition.options.find(
    (option) => option.id === "right",
  );
  if (question.definition.kind === "binary" && (!left || !right))
    throw new Error("DecisionSwipeCard requires an issued binary question");
  const labels = {
    left: left?.label ?? "",
    right: right?.label ?? "",
    up: copy.swipe.either,
  };
  const [status, setStatus] = useState<Status>("idle");
  const [highlight, setHighlight] = useState<AnswerDirection | null>(null);
  const [pending, setPending] = useState<SwipeSubmission | null>(null);
  const [recovery, setRecovery] = useState(0);
  const [threshold, setThreshold] = useState(80);
  const [reducedMotion, setReducedMotion] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const operation = useRef<SwipeSubmission | null>(null);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const phase = useRef<Status>("idle");
  const handlers = useRef({ onSubmit, onAnswered });
  handlers.current = { onSubmit, onAnswered };
  const promptId = useId();
  const instructionsId = useId();
  const statusId = useId();

  useEffect(() => {
    mounted.current = true;
    region.current?.focus({ preventScroll: true });
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media.matches);
    updateMotion();
    media.addEventListener("change", updateMotion);
    const resize = () =>
      setThreshold(
        Math.max(
          64,
          Math.min(120, (surface.current?.clientWidth || 360) * 0.22),
        ),
      );
    resize();
    const observer = new ResizeObserver(resize);
    if (surface.current) observer.observe(surface.current);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      observer.disconnect();
      media.removeEventListener("change", updateMotion);
    };
  }, []);

  useEffect(() => {
    if (status === "error") retryButton.current?.focus({ preventScroll: true });
  }, [status]);

  const save = useCallback(async (answer: SwipeSubmission) => {
    if (!mounted.current || inFlight.current || phase.current === "saved")
      return;
    inFlight.current = true;
    phase.current = "saving";
    setStatus("saving");
    const active = new AbortController();
    controller.current = active;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          active.abort();
          reject(new Error("Answer save timed out"));
        }, SAVE_TIMEOUT_MS);
      });
      await Promise.race([
        handlers.current.onSubmit(answer, active.signal),
        deadline,
      ]);
      if (!mounted.current || active.signal.aborted) return;
      phase.current = "saved";
      setStatus("saved");
    } catch {
      if (!mounted.current) return;
      phase.current = "error";
      setStatus("error");
      // Remount the SAME question at its origin. Keep the chosen answer and operation ID.
      setRecovery((value) => value + 1);
    } finally {
      clearTimeout(timeout);
      inFlight.current = false;
      if (controller.current === active) controller.current = null;
    }
    // A navigation callback is not part of persistence and must not turn a saved answer into an error.
    if (mounted.current && phase.current === "saved")
      handlers.current.onAnswered?.(answer);
  }, []);

  const commit = useCallback(
    (direction: Direction | "category", optionId?: string) => {
      if (direction === "down" || !mounted.current || operation.current) return;
      const answer: SwipeSubmission = {
        requestId: crypto.randomUUID(),
        expectedRevision,
        questionInstanceId: question.instanceId,
        action: direction === "up" ? "neutral" : direction,
        ...(direction === "up"
          ? {}
          : { optionId: direction === "category" ? optionId : direction }),
      };
      // Synchronous guard covers gesture + button + keyboard events in the same render frame.
      operation.current = answer;
      setPending(answer);
      setHighlight(direction === "category" ? null : direction);
      void save(answer);
    },
    [expectedRevision, question.instanceId, save],
  );

  const submit = useCallback(
    (direction: Direction) => commit(direction),
    [commit],
  );

  // These props must remain stable while feedback state changes: the library reattaches
  // gesture listeners when callback identities change, which would lose an active drag.
  const fulfilled = useCallback((direction: Direction) => {
    if (!operation.current)
      setHighlight(direction === "down" ? null : direction);
  }, []);
  const unfulfilled = useCallback(() => {
    if (!operation.current) setHighlight(null);
  }, []);
  const retry = () => {
    if (phase.current === "error" && operation.current)
      void save(operation.current);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (question.definition.kind === "category") return;
    if (
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.defaultPrevented
    )
      return;
    if (
      (event.target as HTMLElement).closest(
        "input, textarea, select, [contenteditable='true']",
      )
    )
      return;
    const direction = (
      { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up" } as const
    )[event.key as "ArrowLeft" | "ArrowRight" | "ArrowUp"];
    if (!direction) return;
    event.preventDefault();
    submit(direction);
  };
  const chosen = pending
    ? pending.action === "category"
      ? question.definition.options.find((o) => o.id === pending.optionId)
          ?.label
      : labels[directionFor(pending)]
    : null;
  const active = pending ? directionFor(pending) : highlight;

  return (
    <div
      className="decision-card"
      ref={region}
      tabIndex={0}
      role="region"
      aria-labelledby={promptId}
      aria-describedby={instructionsId}
      onKeyDown={onKeyDown}
    >
      <div className="question-meta">
        <span>{copy.swipe.question}</span>
        <span
          aria-label={`${copy.swipe.progress} ${progress} / ${copy.swipe.approximately} 6`}
        >
          {progress} / ~6
        </span>
      </div>
      <p id={instructionsId} className="sr-only">
        {question.definition.kind === "binary"
          ? copy.swipe.instructions
          : copy.swipe.categoryInstructions}
      </p>
      {question.definition.kind === "category" ? (
        <section className="category-question">
          <QuestionArt kind="home" />
          <h2 className="sr-only" id={promptId}>{question.definition.prompt}</h2>
          <div className="category-grid">
            {question.definition.options.map((option) => (
              <button
                type="button"
                key={option.id}
                disabled={status !== "idle"}
                onClick={() => commit("category", option.id)}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              disabled={status !== "idle"}
              onClick={() => submit("up")}
            >
              {copy.swipe.either}
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="direction-labels" aria-hidden="true">
            <span data-active={active === "left"}>← {left!.label}</span>
            <span data-active={active === "up"}>↑ {copy.swipe.either}</span>
            <span data-active={active === "right"}>{right!.label} →</span>
          </div>
          <div
            ref={surface}
            className="swipe-surface"
            data-reduced-motion={reducedMotion}
            data-locked={status !== "idle"}
            onMouseDownCapture={() =>
              region.current?.focus({ preventScroll: true })
            }
          >
            <TinderCard
              key={`${question.instanceId}-${recovery}`}
              className="tinder-question"
              preventSwipe={PREVENT_DOWN}
              swipeRequirementType="position"
              swipeThreshold={threshold}
              onSwipe={submit}
              onSwipeRequirementFulfilled={fulfilled}
              onSwipeRequirementUnfulfilled={unfulfilled}
            >
              <article
                className="question-face"
                data-direction={active ?? "none"}
              >
                <QuestionArt dimension={question.definition.dimensionId} />
                <h2 className="sr-only" id={promptId}>{question.definition.prompt}</h2>
                <div className="question-options">
                  <span>{left!.label}</span>
                  <span aria-hidden="true">/</span>
                  <span>{right!.label}</span>
                </div>

              </article>
            </TinderCard>
          </div>
          <div className="answer-buttons" aria-label={copy.swipe.actions}>
            <button
              type="button"
              disabled={status !== "idle"}
              aria-label={`${copy.swipe.left}：${left!.label}`}
              onClick={() => submit("left")}
            >
              <span aria-hidden>←</span>
              {left!.label}
            </button>
            <button
              type="button"
              disabled={status !== "idle"}
              aria-label={`${copy.swipe.up}：${copy.swipe.either}`}
              onClick={() => submit("up")}
            >
              <span aria-hidden>↑</span>
              {copy.swipe.either}
            </button>
            <button
              type="button"
              disabled={status !== "idle"}
              aria-label={`${copy.swipe.right}：${right!.label}`}
              onClick={() => submit("right")}
            >
              <span aria-hidden>→</span>
              {right!.label}
            </button>
          </div>
        </>
      )}
      {status === "saving" && <Loading label="儲存中" announce={false} />}
      <div className="answer-status" id={statusId}>
        <p className="sr-only" role="status" aria-live="polite">
          {chosen
            ? `${copy.swipe.chosen}「${chosen}」 · ${status === "saving" ? copy.swipe.saving : status === "error" ? copy.swipe.unsaved : copy.swipe.saved}`
            : copy.swipe.tapHint}
        </p>
        {status === "error" && (
          <div className="save-error">
            <p role="alert">{copy.swipe.failure}</p>
            <button
              className="retry-button"
              ref={retryButton}
              type="button"
              onClick={retry}
            >
              {copy.swipe.retry}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
