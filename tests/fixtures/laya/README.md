# Laya contract evidence and remaining deployment checks

Real HF fixtures are now captured and `lib/laya/recipe.ts` installs the verified handler contract. See `docs/LAYA_DEPLOYMENT.md` for current state; the dated entries below retain the preparation history. The synthetic recipe inside `tests/laya.test.ts` tests transport and validation only; its `/synthetic-test-only` path is not an asserted HF or upstream API.

Before enabling live Laya:

1. Record the protected Dedicated Endpoint origin, actual recipe/image digest/runtime version, and pinned 40-character revision of `convaiinnovations/laya-multilingual`. Verify the deployment loads that exact checkpoint, rather than the default English model. Never commit the HF token.
2. Verify the actual route, Bearer authorization, input format, typed candidate-choice semantics, returned candidate-score fields and model context limit against that deployment. A generic Transformers classification endpoint is insufficient; the upstream `/v1/systemone` route must not be assumed to exist in an HF recipe.
3. Capture minimal sanitized working request/response fixtures using synthetic English and Traditional Chinese meal preferences with multiple candidate IDs. Record endpoint metadata/provenance separately from credentials. Test maximum supported candidates and request size. Capture an actual warm-up request accepted by that recipe.
4. Implement `VerifiedLayaRecipe.encode/decode` in `lib/laya/recipe.ts` using those observed fields. Populate the verified model revision, serving runtime and SHA-256 of the sanitized fixture. Explicitly document how scores become normalized ranking weights; never call them enjoyment probabilities. If only one choice is returned and no reliable all-candidate scores exist, keep the live integration blocked rather than fabricating missing scores.
5. Verify the app's two-second fallback from Taiwan and that the tiny inference request triggers HF scale-up. Verify 0–1 replicas and the requested 60-minute idle timeout in the endpoint control plane; record actual settings if 60 minutes is not offered. Test scheduled and app-open calls, unauthorized rejection, duplicate suppression and idle scale-down.
6. Configure Secret Manager `HF_TOKEN`, `LAYA_BASE_URL`, `LAYA_MODEL_REVISION` and `LAYA_RUNTIME_VERSION`; their values must match the installed recipe. Do not store keys in public environment variables. Review costs before provisioning/deploying.

Upstream sources consulted: [Laya model/runtime](https://huggingface.co/convaiinnovations/laya), [multilingual checkpoint](https://huggingface.co/convaiinnovations/laya-multilingual), [HF autoscaling](https://huggingface.co/docs/inference-endpoints/guides/autoscaling). These explain upstream behavior but do not prove a particular endpoint's contract.

2026-09-25 preparation: `deploy/laya/` now contains a candidate custom HF handler
and real **local CPU** synthetic smoke evidence. This does not satisfy the deployed
HF fixture gate above. Endpoint/image verification, Taiwan latency and warm-up,
application encoding/decoding and live fixture installation are still outstanding.

## HF authenticated smoke test — 2026-09-25

`hf-smoke.json` contains real responses from the user-supplied v2 endpoint.
Anonymous POST returned HTTP 401. Four authenticated synthetic cases returned
HTTP 200 with all candidate IDs and normalized weights (English/Traditional Chinese,
1 and 10 candidates). The preferred candidate ranked first in both language examples.
Measured request latency was 1.31–1.49 seconds from the developer Mac, not Taiwan.
The wrapper revision is user-reported deployment provenance; checkpoint and Laya
runtime fields were also checked in responses. Secret Manager HF_TOKEN version 1
was passed only in memory, never printed or saved. `deploy/laya/smoke_endpoint.py`
reproduces this test. Use a Python installation with trusted CA certificates.

Still required: private-repository cold start, actual serving image/version,
Taiwan latency and 2-second fallback, production DecisionInput encoding contract,
app/scheduled warm-up and real idle-scale settings. The installed application
recipe remains null until these integration gates are handled. These fixtures
contain only fictional preferences and candidates, not Google provider data.

Private repository restart check: `hf-cold-start.json` records a user-confirmed
forced scale-to-zero, initial authenticated HTTP 503, then four successful HTTP
200 scoring cases after the user reported Running. Anonymous requests stayed 401.
Warm calls took 1.27–1.42 seconds from the developer Mac. Exact cold-start duration
and automatic idle scale-down were not measured. This verifies one private-repo
wake-up, not the Taiwan timeout or scheduled warm-up gates.
