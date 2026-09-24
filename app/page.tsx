import Link from "next/link";
import { Account } from "@/components/Account";
import { copy } from "@/lib/copy";
export default function Home() {
  return (
    <>
      <div className="eyebrow">{copy.tagline}</div>
      <h1>
        今日，
        <br />
        <em>食咩好？</em>
      </h1>
      <p className="intro">{copy.subtitle}</p>
      <div className="meal-art" aria-hidden="true">
        <div className="plate">
          <div className="rice" />
          <div className="leaf leaf-one" />
          <div className="leaf leaf-two" />
          <div className="tomato" />
        </div>
        <div className="chopstick one" />
        <div className="chopstick two" />
        <span className="art-caption">a little less deciding.</span>
      </div>
      <section className="decision-entry">
        <p className="eyebrow">{copy.private}</p>
        <Link
          className="primary"
          href="/decide"
          aria-describedby="foundation-note"
        >
          {copy.decide}
          <span aria-hidden>→</span>
        </Link>
        <p id="foundation-note" className="hint">
          {copy.foundation} · {copy.foundationDetail}
        </p>
        <Link className="history-link" href="/demo">{copy.demoEntry}<span aria-hidden>↗</span></Link>
        <Link className="history-link" href="/history">
          {copy.history}
          <span aria-hidden>↗</span>
        </Link>
      </section>
      <Account />
    </>
  );
}
