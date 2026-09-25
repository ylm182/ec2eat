import type { Dimension } from "@/lib/domain/schema";
const scenes: Record<Dimension, [string, string]> = {
  richness: ["🥗", "🍜"], spiciness: ["🥒", "🌶️"], novelty: ["🏠", "🧭"],
  speed: ["⚡", "🫖"], formality: ["👕", "🎀"], comfort: ["🍙", "🎁"],
  healthiness: ["🥦", "🍔"], temperature: ["🧊", "♨️"], social: ["🍱", "🥘"],
  distanceTolerance: ["🚶", "🚃"], price: ["🪙", "💎"],
};
export function QuestionArt({ dimension, kind }: { dimension?: Dimension; kind?: "home" | "range" }) {
  const pair = kind === "home" ? ["📖", "🍜"] : kind === "range" ? ["🚶", "🚃"] : scenes[dimension ?? "richness"];
  return <svg className="question-art" viewBox="0 0 360 290" aria-hidden="true">
    <path d="M35 98Q10 15 108 33T211 27Q339 0 333 137T216 268Q123 291 65 232T35 98" fill="#ffdc64" />
    <circle cx="100" cy="136" r="70" fill="#fff6dc"/>
    <circle cx="256" cy="157" r="70" fill="#ffc0d9"/>
    <path d="M119 223Q176 260 242 234" fill="none" stroke="#522fa0" strokeWidth="7" strokeLinecap="round" strokeDasharray="1 17"/>
    <text x="100" y="158" textAnchor="middle" fontSize="72">{pair[0]}</text><text x="256" y="182" textAnchor="middle" fontSize="72">{pair[1]}</text>
    <path d="m286 30 5 13 14 5-14 5-5 14-5-14-14-5 14-5Z" fill="#ff694d"/>
    <circle cx="35" cy="230" r="9" fill="#50bda4"/><path d="m171 71 8-13 8 13" fill="none" stroke="#522fa0" strokeWidth="5" strokeLinecap="round"/>
  </svg>;
}
