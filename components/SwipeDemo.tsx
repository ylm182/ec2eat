"use client";
import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { DecisionSwipeCard, type SwipeSubmission } from "./DecisionSwipeCard";
import { createDemoTransport, demoQuestions } from "@/lib/fixtures/swipe-demo";
import { copy } from "@/lib/copy";
export function SwipeDemo() {
  const [transport] = useState(() => createDemoTransport());
  const [answers, setAnswers] = useState<SwipeSubmission[]>([]);
  const [failureArmed, setFailureArmed] = useState(false);
  const complete = useRef<HTMLHeadingElement>(null);
  const question = demoQuestions[answers.length];
  useEffect(() => {
    if (!question) complete.current?.focus();
  }, [question]);
  return (
    <>
      <div className="demo-badge">{copy.demo.badge}</div>
      <p className="demo-notice">{copy.demo.notice}</p>
      {question ? (
        <DecisionSwipeCard
          question={question}
          progress={answers.length + 1}
          expectedRevision={answers.length}
          onSubmit={transport.submit}
          onAnswered={() => {
            setAnswers([...transport.records]);
            setFailureArmed(false);
          }}
        />
      ) : (
        <section className="demo-complete">
          <h1 ref={complete} tabIndex={-1} className="small-title">
            {copy.demo.complete}
          </h1>
          <p>{copy.demo.completeDetail}</p>
          <ol>
            {answers.map((answer, index) => (
              <li key={answer.questionInstanceId}>
                <span>{demoQuestions[index].definition.prompt}</span>
                <strong>
                  {answer.action === "neutral"
                    ? copy.swipe.either
                    : demoQuestions[index].definition.options.find(
                        (option) => option.id === answer.optionId,
                      )?.label}
                </strong>
              </li>
            ))}
          </ol>
          <Link href="/" className="history-link">
            {copy.demo.home} →
          </Link>
        </section>
      )}
      {question && (
        <details className="demo-tools">
          <summary>{copy.demo.testRetry}</summary>
          <p>{copy.demo.testRetryDetail}</p>
          <button
            type="button"
            disabled={failureArmed}
            onClick={() => {
              transport.loseNextResponse();
              setFailureArmed(true);
            }}
          >
            {failureArmed ? copy.demo.failureArmed : copy.demo.simulateFailure}
          </button>
        </details>
      )}
      <p className="demo-footer">{copy.demo.footer}</p>
    </>
  );
}
