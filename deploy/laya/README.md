---
license: apache-2.0
library_name: transformers
pipeline_tag: text-classification
tags:
- endpoints-template
- custom-handler
---
# ec2eat Laya endpoint wrapper

This repository is a custom Hugging Face Inference Toolkit handler, not a standard
Transformers classification checkpoint. It downloads only
`convaiinnovations/laya-multilingual` revision
`e4e9ddf21a7b1903b7acffd8814ad4307bf63a67` at startup and runs Laya 0.3.20 on CPU.
Upstream weights are Apache-2.0; they are not redistributed in this wrapper.

## Current status

Candidate serving recipe. Five local validation tests passed. Real CPU inference
passed English and Traditional Chinese two-candidate examples; both ranked the
matching lunch first. These examples do not establish general ranking quality.
Local unit tests are separate from real local model tests
and from HF deployment validation. The application still exports a null installed
recipe and falls back deterministically. Uploading these files does not enable it.

## Deploy in steps

1. Create your own **model repository**, proposed name `ylm182/ec2eat-laya-serving`.
   Upload `handler.py`, `requirements.txt`, and this `README.md` at its root.
   The browser upload uses your signed-in account; do not widen the production
   inference token to write access. Do not upload tokens, caches or virtual environments.
2. Record the new repository's full commit hash. Use **your wrapper repository**
   for the endpoint, not the upstream weights repository. The endpoint commit pins
   the handler; the handler separately pins the upstream weights.
3. Select an Inference Toolkit engine supporting `handler.py` (the legacy Default
   engine detects it). Check initialization logs to confirm custom handler discovery.
   If Default maps to another engine, stop and select Inference Toolkit or use its
   documented container; do not substitute vLLM/TGI or a stock classification pipeline.
4. Starting hardware: AWS Intel Sapphire Rapids CPU, 4 vCPUs / 8 GB. Region depends
   on availability; the user's draft offers N. Virginia. Measure latency from Taiwan.
   Use owner-token-only authentication (labelled Private in the current UI), not
   public access. Leave AWS PrivateLink off. Replicas 0–1, idle timeout 60 minutes.
   Confirm the displayed hourly cost before creation. This size is an estimate until
   Linux startup memory and latency are measured.
5. Leave server command/arguments empty. No Gemini, Calendar, Places or Firebase
   credentials belong here. The checkpoint is public. First startup downloads weights.
6. After deployment, record actual image digest/runtime and send a synthetic request
   from `smoke.py` to the endpoint root `/`, with Bearer HF authentication.
   Verify an anonymous request fails. Save sanitized requests/responses plus metadata.
7. Only then implement the application's `VerifiedLayaRecipe`, with fixture digest,
   handler/runtime version and checkpoint revision. Run the existing live contract
   checklist in `tests/fixtures/laya/README.md` before enabling integration.

## Contract

POST the JSON envelope `{"inputs":{"state":"...","candidates":[{"id":"a","description":"..."}]}}`.
State is minimized preference/context text, never raw Calendar data. Production
encoding must explain dimension polarity, preserve explicit/neutral/unknown states,
keep priors weak, and respect the existing Places model-input flag.

1–10 unique candidate IDs, 16,000-byte request maximum, at most 700 state tokens
including candidate descriptions. Over-limit requests fail instead of truncating.
One fixed choice question returns scores for every candidate. Letter aliases keep
IDs out of the question head; the response restores original IDs. Raw probabilities
are normalized only to correct upstream four-decimal rounding. They are ranking
weights, **not calibrated enjoyment probabilities**; confidence is null.

The app's 2-second timeout remains unchanged. Slow/cold model responses must fall
back. Local Apple CPU timing does not establish AWS latency. Scale-up, warm-up,
scheduler authorization, idle scaling and Linux dependency compatibility require
real deployment tests.

## Local verification

Use Python 3.12 in an isolated virtual environment, install `requirements.txt`, then:

```bash
python -m unittest discover -s tests -v
python smoke.py
```

The smoke test downloads real public weights and creates `local-smoke.json` using
fictional data only. `local-validation-requirements.txt` records the locally resolved
packages; it is not a claim that HF's base image has been tested.

Sources checked 2026-09-25:
- https://huggingface.co/docs/inference-endpoints/guides/custom_handler
- https://huggingface.co/convaiinnovations/laya-multilingual
- Laya 0.3.20 wheel SHA-256: `6039e802fa5effb8dd492061cd7ad39a43087beadc4a4fa4a649614e77eb83d4`

### HF startup correction (2026-09-25)

The v2 endpoint logs confirmed custom-handler discovery and requirements loading,
but NumPy 2.5.3 requires Python >=3.12 whereas HF's image uses Python 3.11.
The failed install caused the later misleading `PackageNotFoundError: laya`.
Requirements now pin NumPy 2.4.6. Its CPython 3.11 Linux x86_64 wheel was downloaded
successfully, and all four real local CPU smoke cases and five unit tests were
rerun with 2.4.6. Full HF image initialization remains unverified. Upload the changed
requirements.txt and use the NEW wrapper commit SHA; retrying the old pinned
210dda8cc0d8bc2798d7b03d7271337677c0e8b2 commit cannot pick up this fix.

### HF base-image compatibility correction (2026-09-25)

The next attempt installed Laya, but replacing the image's core packages broke
HF startup before the handler loaded: `torchvision::nms does not exist` was wrapped
as a Whisper import error. The log reports toolkit 0.5.6 requires Transformers
4.51.3 and Hub 0.30.2; installed torchvision 0.20.1+cpu / torchaudio 2.5.1+cpu
require Torch 2.5.1, and pyctcdecode requires NumPy <2. Requirements now preserve
these versions (NumPy 1.26.4). This supersedes the previous NumPy 2.4.6 correction.
Do not independently upgrade the base image's ML stack.

Local verification used Torch 2.5.1, torchvision 0.20.1, torchaudio 2.5.1,
Transformers 4.51.3, Hub 0.30.2 and NumPy 1.26.4. The formerly failing
`WhisperForConditionalGeneration` / `pipeline` imports, five handler tests and
four real model smoke cases passed. `check_runtime.py` makes the import check
repeatable. This remains macOS/Python 3.12 evidence, not a full Linux HF image test.
Upload only the corrected requirements.txt, then pin the new wrapper commit on
an endpoint update. No handler, model revision, hardware or Firebase change needed.
