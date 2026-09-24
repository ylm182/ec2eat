# Live Laya contract gate — not yet verified

No real endpoint or sanitized serving fixture has been supplied. `lib/laya/recipe.ts` deliberately exports `null`. Supplying an endpoint/token alone cannot enable live scoring. The synthetic recipe inside `tests/laya.test.ts` tests transport and validation only; its `/synthetic-test-only` path is not an asserted HF or upstream API.

Before enabling live Laya:

1. Record the protected Dedicated Endpoint origin, actual recipe/image digest/runtime version, and pinned 40-character revision of `convaiinnovations/laya-multilingual`. Verify the deployment loads that exact checkpoint, rather than the default English model. Never commit the HF token.
2. Verify the actual route, Bearer authorization, input format, typed candidate-choice semantics, returned candidate-score fields and model context limit against that deployment. A generic Transformers classification endpoint is insufficient; the upstream `/v1/systemone` route must not be assumed to exist in an HF recipe.
3. Capture minimal sanitized working request/response fixtures using synthetic English and Traditional Chinese meal preferences with multiple candidate IDs. Record endpoint metadata/provenance separately from credentials. Test maximum supported candidates and request size. Capture an actual warm-up request accepted by that recipe.
4. Implement `VerifiedLayaRecipe.encode/decode` in `lib/laya/recipe.ts` using those observed fields. Populate the verified model revision, serving runtime and SHA-256 of the sanitized fixture. Explicitly document how scores become normalized ranking weights; never call them enjoyment probabilities. If only one choice is returned and no reliable all-candidate scores exist, keep the live integration blocked rather than fabricating missing scores.
5. Verify the app's two-second fallback from Taiwan and that the tiny inference request triggers HF scale-up. Verify 0–1 replicas and the requested 60-minute idle timeout in the endpoint control plane; record actual settings if 60 minutes is not offered. Test scheduled and app-open calls, unauthorized rejection, duplicate suppression and idle scale-down.
6. Configure Secret Manager `HF_TOKEN`, `LAYA_BASE_URL`, `LAYA_MODEL_REVISION` and `LAYA_RUNTIME_VERSION`; their values must match the installed recipe. Do not store keys in public environment variables. Review costs before provisioning/deploying.

Upstream sources consulted: [Laya model/runtime](https://huggingface.co/convaiinnovations/laya), [multilingual checkpoint](https://huggingface.co/convaiinnovations/laya-multilingual), [HF autoscaling](https://huggingface.co/docs/inference-endpoints/guides/autoscaling). These explain upstream behavior but do not prove a particular endpoint's contract.
