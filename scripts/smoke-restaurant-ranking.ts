// Explicit live smoke only. Secrets and Google content stay in memory; print counts/timings only.
import { execFileSync } from "node:child_process";
import { GooglePlacesProvider } from "../lib/providers/google-places";
import { searchRestaurants } from "../lib/restaurants/search";
import { newSession } from "../lib/domain/session";
import { unknownPreferences } from "../lib/domain/schema";
import { HuggingFaceLayaProvider } from "../lib/laya/provider";
import { installedRecipe } from "../lib/laya/recipe";
import { LayaService } from "../lib/laya/service";
import type { DecisionInput } from "../lib/providers/contracts";
async function main() {
  if (!process.argv.includes("--live")) throw Error("Requires --live; this makes paid provider requests");
  const secret = (name: string, version: string) => execFileSync("gcloud", ["secrets", "versions", "access", version, `--secret=${name}`, "--project=ec2eat-davidyu-prod"], {encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  const preferences = unknownPreferences();
  preferences.price = {state:"answered",value:.2,strength:1};
  preferences.distanceTolerance = {state:"answered",value:.2,strength:1};
  const warm: DecisionInput = {version:1,stage:"restaurant",preferences,priors:{},context:{rain:null,nextEventSoon:null},candidates:Array.from({length:10},(_,i)=>({id:`synthetic-${i}`,categoryId:i%2?"noodles":"salad",features:{price:{value:i/10,confidence:1,source:"rule"},distanceTolerance:{value:i/10,confidence:1,source:"rule"}}}))};
  const hf = new HuggingFaceLayaProvider("https://6ab54d3c9ec415b652acb0c3.endpoints.huggingface.cloud/",secret("HF_TOKEN","1"),installedRecipe,warm);
  const synthetic = await hf.rank(warm,AbortSignal.timeout(15000));
  console.log(JSON.stringify({case:"synthetic-ten-candidate-contract",provider:synthetic.provider,count:synthetic.entries.length,latencyMs:synthetic.latencyMs}));
  const service = new LayaService(hf,{circuitOpen:async()=>false,record:async()=>{},acquire:async()=>true,release:async()=>{}});
  const session = newSession({id:"smoke",uid:"synthetic-smoke-user",launchId:"smoke",area:"中環",now:new Date().toISOString(),preferences});
  const google = new GooglePlacesProvider(secret("GOOGLE_PLACES_API_KEY","2"),true);
  let inputCount = 0; let categoryCount = 0;
  const result = await searchRestaurants(session,{latitude:22.2819,longitude:114.1589},3000,google,async input => {
    inputCount=input.candidates.length; categoryCount=input.candidates.filter(c=>c.categoryId).length;
    const scored = await service.rank(input);
    if(scored.provider !== "laya") {
      const contract = await hf.rank(input,AbortSignal.timeout(15000));
      console.log(JSON.stringify({case:"live-contract-outside-app-budget",provider:contract.provider,count:contract.entries.length,latencyMs:contract.latencyMs}));
    }
    return scored;
  },AbortSignal.timeout(25000));
  console.log(JSON.stringify({case:"google-to-laya",candidateCount:inputCount,categoryCount,shortlistCount:result.candidates.length,provider:result.result.provider,fallbackReason:result.result.fallbackReason,latencyMs:result.result.latencyMs}));
  if(!inputCount) throw Error("No eligible live candidates; ranking unverified");
}
main().catch(() => { console.error("Live ranking smoke failed (provider payloads omitted)"); process.exitCode=1; });
