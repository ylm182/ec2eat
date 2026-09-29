import type { DecisionSession } from "./schema";
export function answerLabels(session: DecisionSession): string[] {
  const labels: string[] = [];
  const travel = session.context.travelChoice;
  if (travel) labels.push({ walk20: "步行20分鐘內", walk30: "步行30分鐘內", drive20: "私家車20分鐘內" }[travel]);
  else if (session.context.searchRadiusM) labels.push(`範圍 ${session.context.searchRadiusM / 1000} 公里`);
  if (session.context.diningIntent) labels.push({ meal: "正餐", snack: "小食", any: "正餐／小食都得" }[session.context.diningIntent]);
  for (const answer of session.answers) {
    const question = session.questions.find(q => q.instanceId === answer.questionInstanceId)?.definition;
    if (!question) continue;
    if (answer.action === "neutral") labels.push(`${question.options.map(o => o.label).join("／")}：都得`);
    else {
      const label = question.options.find(o => o.id === answer.optionId)?.label;
      if (label) labels.push(label);
    }
  }
  return labels;
}
