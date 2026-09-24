import {execFileSync} from "node:child_process";
import {writeFileSync} from "node:fs";
import {installedRecipe} from "../lib/laya/recipe";
import {archetypes} from "../lib/domain/catalog";
import {unknownPreferences} from "../lib/domain/schema";
import {validateRanking} from "../lib/laya/provider";
import type {DecisionInput} from "../lib/providers/contracts";
async function main(){
 const token=execFileSync("gcloud",["secrets","versions","access","1","--secret=HF_TOKEN","--project=ec2eat-davidyu-prod"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
 const base:DecisionInput={version:1,stage:"archetype",candidates:archetypes.map(({id,features,categoryId})=>({id,features,categoryId})),preferences:unknownPreferences(),priors:{},context:{rain:null,nextEventSoon:null}};
 base.preferences.speed={state:"answered",value:.8,strength:1};
 const answered=structuredClone(base);
 for(const d of ["speed","healthiness","richness","spiciness","price","social"] as const) answered.preferences[d]={state:"answered",value:d==="speed"||d==="healthiness"?.8:.2,strength:1};
 const cases=[];
 for(const input of [base,answered]){
  const request=installedRecipe.encode(input);const start=performance.now();
  const response=await fetch("https://6ab54d3c9ec415b652acb0c3.endpoints.huggingface.cloud/",{method:"POST",redirect:"error",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(request.body),signal:AbortSignal.timeout(15000)});
  console.log("HF recipe HTTP",response.status);
  if(!response.ok) throw Error(`HF status ${response.status}`);
  const body=await response.json();validateRanking(installedRecipe.decode(body),input);
  cases.push({input,request,response:body,latencyMs:Math.round(performance.now()-start)});
 }
 writeFileSync("tests/fixtures/laya/hf-app-encoding.json",JSON.stringify({executionLocation:"developer Mac",cases},null,2)+"\n");
 console.log("Application encoding passed",cases.map(c=>c.latencyMs));
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Smoke test failed");process.exitCode=1});
