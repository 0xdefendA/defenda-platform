"""
Retry-classifier unit tests. These import ONLY the pure helpers from the engine,
not the ADK-dependent machinery, so they run without google-adk installed.
"""

import importlib.util
from pathlib import Path

# Load the classifier helpers by pulling the functions out of the engine source
# without importing the module (which would require google.adk). We exec the two
# small pure functions in isolation.
ENGINE = Path(__file__).resolve().parents[3] / "shared" / "hunt" / "engine.py"


def _load_pure_helpers():
    src = ENGINE.read_text()
    ns: dict = {"random": __import__("random")}
    # Extract the two functions and the retry constants by exec-ing just their defs.
    import ast

    tree = ast.parse(src)
    wanted = {"_is_retryable_model_error", "_backoff_delay",
              "MAX_MODEL_ATTEMPTS", "_RETRY_BASE_SECONDS", "_RETRY_MAX_SECONDS"}
    keep = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in wanted:
            keep.append(node)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id in wanted:
                    keep.append(node)
    module = ast.Module(body=keep, type_ignores=[])
    code = compile(module, str(ENGINE), "exec")
    exec(code, ns)
    return ns


HELPERS = _load_pure_helpers()


class Coded(Exception):
    def __init__(self, msg, code=None):
        super().__init__(msg)
        self.code = code


def test_retryable_on_429_and_503():
    is_retryable = HELPERS["_is_retryable_model_error"]
    assert is_retryable(Coded("boom", code=429))
    assert is_retryable(Coded("boom", code=503))
    assert is_retryable(Exception("Resource exhausted. Please try again later. 429"))
    assert is_retryable(Exception("503 UNAVAILABLE: backend overloaded"))
    assert is_retryable(Exception("RESOURCE_EXHAUSTED"))


def test_not_retryable_on_other_errors():
    is_retryable = HELPERS["_is_retryable_model_error"]
    assert not is_retryable(Coded("bad request", code=400))
    assert not is_retryable(ValueError("No API key was provided."))
    assert not is_retryable(Exception("permission denied"))


def test_backoff_grows_and_is_bounded():
    backoff = HELPERS["_backoff_delay"]
    d1 = backoff(1)
    d2 = backoff(2)
    d3 = backoff(3)
    # jitter is +[0,5); base is 10, 30, 90
    assert 10 <= d1 < 16
    assert 30 <= d2 < 36
    assert 90 <= d3 < 96
    # capped
    assert backoff(9) <= HELPERS["_RETRY_MAX_SECONDS"] + 5
