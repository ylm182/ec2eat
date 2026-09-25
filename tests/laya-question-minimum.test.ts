import {expect,it} from "vitest";
import {newSession,applyAnswer} from "../lib/domain/session";
import {applyScoring} from "../lib/domain/scoring";
import {archetypes} from "../lib/domain/catalog";
import type {DecisionResult} from "../lib/providers/contracts";
const now="2026-09-25T04:00:00.000Z";
const certain:DecisionResult={version:1,provider:"laya",model:"convaiinnovations/laya-multilingual",revision:"test",confidence:null,confidenceKind:"none",latencyMs:10,fallbackReason:null,
 entries:archetypes.map((a,i)=>({id:a.id,score:i===0?1:0,weight:i===0?1:0}))};
it("one-hot model scores cannot exhaust a fresh decision before three answers",()=>{
 let session=newSession({id:"regression",uid:"user",launchId:"launch",area:"旺角",now});
 for(let count=0;count<3;count++){
  session=applyScoring(session,certain);
  expect(session.status).toBe("QUESTIONING");expect(session.decision.stopReason).toBeNull();
  const q=session.questions.at(-1)!;
  expect(q.definition.kind).toBe("binary");
  session=applyAnswer(session,{requestId:`request-${count}`,expectedRevision:session.revision,questionInstanceId:q.instanceId,action:"left",optionId:"left"},now);
 }
 session=applyScoring(session,certain);
 expect(session.status).toBe("RECOMMENDING");expect(session.decision.stopReason).toBe("weight_margin");
});
