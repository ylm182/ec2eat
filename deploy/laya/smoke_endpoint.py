"""Test the deployed endpoint with synthetic data; keep the HF token in memory only."""
import json
import subprocess
import time
import urllib.request
import urllib.error
from pathlib import Path

ENDPOINT = 'https://6ab54d3c9ec415b652acb0c3.endpoints.huggingface.cloud'
REVISION = '1942f86f6f828e850a0e963bec0daf8c225e4113'

def call(payload, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(ENDPOINT, data=json.dumps(payload).encode(), headers=headers)
    started = time.monotonic()
    # Never forward Authorization through an unexpected redirect.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
            return response.status, response.read(65537), time.monotonic() - started
    except urllib.error.HTTPError as error:
        return error.code, b'', time.monotonic() - started


def main():
    samples = json.loads(Path(__file__).with_name('local-smoke.json').read_text())
    status, _, _ = call(samples[0]['request'])
    print('Anonymous request HTTP', status, flush=True)
    if status not in (401, 403):
        raise SystemExit('Endpoint authentication not verified; stopping.')
    # Deliberately capture, never print or persist, the secret value.
    secret = subprocess.run([
        'gcloud', 'secrets', 'versions', 'access', '1', '--secret=HF_TOKEN',
        '--project=ec2eat-davidyu-prod'], capture_output=True, text=True)
    if secret.returncode:
        raise SystemExit('Unable to access HF_TOKEN with the current gcloud login.')
    token = secret.stdout.strip()
    evidence = {'endpoint': ENDPOINT, 'wrapperRevision': REVISION,
                'anonymousStatus': status, 'executionLocation': 'developer machine, not Taiwan backend',
                'cases': []}
    for sample in samples:
        status, body, seconds = call(sample['request'], token)
        print('Authenticated request HTTP', status, 'seconds', round(seconds, 3), flush=True)
        if status != 200:
            raise SystemExit('Endpoint not ready or request rejected; no fixture saved. Check endpoint logs.')
        if len(body) > 65536:
            raise SystemExit('Response exceeds size limit')
        response = json.loads(body)
        expected = {c['id'] for c in sample['request']['inputs']['candidates']}
        entries = response['entries']
        assert len(entries) == len(expected)
        assert {e['id'] for e in entries} == expected
        assert all(type(e['weight']) in (float, int) and 0 <= e['weight'] <= 1 for e in entries)
        assert abs(sum(e['weight'] for e in entries) - 1) < 1e-6
        assert response['modelRevision'] == 'e4e9ddf21a7b1903b7acffd8814ad4307bf63a67'
        assert response['runtimeVersion'] == 'laya==0.3.20'
        assert response['contract'] == 'ec2eat-laya-choice-v1'
        evidence['cases'].append({'request': sample['request'], 'response': response, 'seconds': seconds})
    # Keep the committed contract fixture immutable: the recipe pins its SHA-256.
    import tempfile
    out = Path(tempfile.gettempdir()) / 'ec2eat-hf-smoke-latest.json'
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
    print('All four cases passed; synthetic fixture saved:', out)

if __name__ == '__main__':
    main()
