import copy
import math
import unittest
from unittest.mock import Mock
from handler import EndpointHandler, validate_request, decode_scores
import threading

REQUEST = {"inputs": {"state": "清淡", "candidates": [
    {"id": "a", "description": "清淡"}, {"id": "b", "description": "濃味"}]}}

def result(p):
    return {"answers": {"selection": {"type": "choice", "probabilities": p}}}

class HandlerTests(unittest.TestCase):
    def test_rejects_invalid_input(self):
        for bad in [{}, {"inputs": []}, {"inputs": {"state": "", "candidates": []}}]:
            with self.assertRaises(ValueError): validate_request(bad)
        bad = copy.deepcopy(REQUEST)
        bad["inputs"]["candidates"][1]["id"] = "a"
        with self.assertRaises(ValueError): validate_request(bad)
        bad = copy.deepcopy(REQUEST)
        bad["inputs"]["state"] = "字" * 16000
        with self.assertRaises(ValueError): validate_request(bad)

    def test_rejects_partial_or_nonfinite_scores(self):
        for p in [{"A": 1}, {"A": .5, "C": .5}, {"A": math.nan, "B": .5},
                  {"A": True, "B": 0}, {"A": .1, "B": .1}]:
            with self.assertRaises(ValueError): decode_scores(result(p), REQUEST["inputs"]["candidates"])

    def test_rounding_normalized_and_ids_preserved(self):
        decoded = decode_scores(result({"A": .6667, "B": .3334}), REQUEST["inputs"]["candidates"])
        self.assertEqual([e["id"] for e in decoded["entries"]], ["a", "b"])
        self.assertAlmostEqual(sum(e["weight"] for e in decoded["entries"]), 1)
        self.assertIsNone(decoded["confidence"])

    def test_oversize_token_input_never_calls_model(self):
        handler = EndpointHandler.__new__(EndpointHandler)
        handler.lock = threading.Lock()
        handler.agent = Mock()
        handler.agent.tok.return_value = {"input_ids": [1] * 701}
        with self.assertRaises(ValueError): handler(REQUEST)
        handler.agent.predict.assert_not_called()

    def test_complete_forward_and_input_unchanged(self):
        handler = EndpointHandler.__new__(EndpointHandler)
        handler.lock = threading.Lock()
        handler.agent = Mock()
        handler.agent.tok.return_value = {"input_ids": [1] * 20}
        handler.agent.predict.return_value = result({"A": .8, "B": .2})
        before = copy.deepcopy(REQUEST)
        self.assertEqual(handler(REQUEST)["entries"][0]["weight"], .8)
        self.assertEqual(REQUEST, before)
        self.assertEqual(handler.agent.predict.call_args.kwargs, {"max_len": 1024, "head_max_len": 256})


class IndependentScoreTests(unittest.TestCase):
    def handler(self):
        h = EndpointHandler.__new__(EndpointHandler)
        h.lock = threading.Lock()
        h.agent = Mock()
        h.agent.tok.return_value = {"input_ids": [1] * 20}
        return h

    def test_independent_states_rubric_and_raw_scale(self):
        h = self.handler()
        h.agent.predict.side_effect = [
            {"answers": {"suitability": {"type": "score", "score": 3.2}}},
            {"answers": {"suitability": {"type": "score", "score": 0.4}}},
        ]
        request = copy.deepcopy(REQUEST)
        request["inputs"]["mode"] = "score"
        response = h(request)
        self.assertEqual(response["contract"], "ec2eat-laya-score-v1")
        self.assertEqual([e["score"] for e in response["entries"]], [.8, .1])
        import json
        states = [json.loads(call.args[0]) for call in h.agent.predict.call_args_list]
        self.assertEqual(states, [{"preferences": "清淡", "restaurant": "清淡"}, {"preferences": "清淡", "restaurant": "濃味"}])
        self.assertEqual(h.agent.predict.call_args_list[0].args[1], h.agent.predict.call_args_list[1].args[1])
        self.assertEqual(h.agent.predict.call_args.args[1]["suitability"]["type"], "score")

    def test_invalid_scores_never_escape(self):
        for value in [True, math.nan, -1, 4.1, "3"]:
            h = self.handler()
            h.agent.predict.return_value = {"answers": {"suitability": {"type": "score", "score": value}}}
            request = copy.deepcopy(REQUEST)
            request["inputs"]["mode"] = "score"
            with self.assertRaises(ValueError): h(request)

    def test_zero_score_is_valid_not_missing(self):
        h = self.handler()
        h.agent.predict.return_value = {"answers": {"suitability": {"type": "score", "score": 0}}}
        request = copy.deepcopy(REQUEST)
        request["inputs"]["mode"] = "score"
        self.assertEqual([e["weight"] for e in h(request)["entries"]], [.5, .5])

if __name__ == "__main__": unittest.main()
