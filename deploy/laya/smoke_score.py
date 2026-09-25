"""Synthetic-only independent score contract evidence; local or HF endpoint.

Local: python smoke_score.py --output /tmp/laya-score.json
HF: set HF_TOKEN and LAYA_BASE_URL in memory, then add --remote.
Never persists credentials or actual restaurant/user content.
"""
import argparse
import copy
import json
import os
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--remote', action='store_true')
parser.add_argument('--output', required=True)
args = parser.parse_args()
if args.remote:
    import requests
    endpoint = os.environ['LAYA_BASE_URL'].rstrip('/') + '/'
    def handler(body):
        response = requests.post(endpoint, json=body, headers={'Authorization': 'Bearer ' + os.environ['HF_TOKEN']}, timeout=45)
        response.raise_for_status()
        return response.json()
else:
    from handler import EndpointHandler
    handler = EndpointHandler()

base = {'inputs': {'mode': 'score', 'state': '我想食平價、清淡、快啲食完嘅午餐。', 'candidates': [
    {'id': 'quick', 'description': '平價，清淡，快速上菜。'},
    {'id': 'formal', 'description': '昂貴正式晚餐，辣味，需要長時間用餐。'},
]}}
reversed_request = copy.deepcopy(base)
reversed_request['inputs']['candidates'].reverse()
single = copy.deepcopy(base)
single['inputs']['candidates'] = single['inputs']['candidates'][:1]
ten = copy.deepcopy(base)
ten['inputs']['candidates'] = [{'id': 'synthetic_' + str(i), 'description': base['inputs']['candidates'][i % 2]['description']} for i in range(10)]
legacy = copy.deepcopy(base)
del legacy['inputs']['mode']
cases = []
for name, request in [('pair', base), ('reverse', reversed_request), ('alone', single), ('ten', ten), ('legacy-choice', legacy)]:
    started = time.monotonic()
    response = handler(request)
    assert response['contract'] == ('ec2eat-laya-choice-v1' if name == 'legacy-choice' else 'ec2eat-laya-score-v1')
    assert {e['id'] for e in response['entries']} == {c['id'] for c in request['inputs']['candidates']}
    assert all(type(e['score']) in (int, float) and 0 <= e['score'] <= 1 for e in response['entries'])
    assert abs(sum(e['weight'] for e in response['entries']) - 1) < 1e-6
    case = {'name': name, 'request': request, 'response': response, 'seconds': time.monotonic() - started}
    cases.append(case)
    print(json.dumps({'name': name, 'seconds': case['seconds'], 'entries': response['entries']}), flush=True)
paired = {e['id']: e['score'] for e in cases[0]['response']['entries']}
for case in cases[1:3]:
    for e in case['response']['entries']:
        assert abs(e['score'] - paired[e['id']]) <= 0.0001, 'Score depends on candidate batch/order'
for e in cases[3]['response']['entries']:
    assert abs(e['score'] - paired['quick' if int(e['id'].split('_')[1]) % 2 == 0 else 'formal']) <= 0.0001
assert paired['quick'] > paired['formal'], 'Obvious matching example did not rank first'
Path(args.output).write_text(json.dumps({'execution': 'remote' if args.remote else 'local', 'cases': cases}, ensure_ascii=False, indent=2) + '\n')
