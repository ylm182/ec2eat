import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
const old="ec2eat--ec2eat-davidyu-prod.asia-east1.hosted.app";
it("redirects the original public host behind Firebase, retaining path and query",()=>{
 const response=middleware(new NextRequest("https://internal.run.app/decide?check=1",{headers:{host:"internal.run.app","x-forwarded-host":old}}));
 expect(response.status).toBe(308);
 expect(response.headers.get("location")).toBe("https://ec2eat.fun/decide?check=1");
 expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("redirects direct legacy requests but never redirects the canonical host or localhost",()=>{
 expect(middleware(new NextRequest(`https://${old}/`,{headers:{host:old}})).status).toBe(308);
 for(const host of ["ec2eat.fun","localhost:3000","unrelated.example"]){
  expect(middleware(new NextRequest("https://internal.run.app/",{headers:{host:"internal.run.app","x-forwarded-host":host}})).headers.get("location")).toBeNull();
 }
});
