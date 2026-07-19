import json
import urllib.request


def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request("http://127.0.0.1:8000" + path, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as r:
        return json.load(r)


print("health", call("GET", "/health"))
normal = call(
    "POST",
    "/ingest",
    {
        "amount": 45,
        "merchant": "Starbucks",
        "merchant_category": "food",
        "country": "US",
        "channel": "pos",
        "velocity_1h": 1,
        "avg_amount_7d": 40,
        "is_new_merchant": False,
    },
)
print("ingest_normal", normal["risk_score"], normal["status"])
attack = call("POST", "/demo/attack", {"intensity": "high"})
print("attack", attack["injected"])
queue = call("GET", "/queue")
print("queue", len(queue), queue[0]["risk_score"] if queue else None)
if queue:
    decided = call(
        "POST",
        f"/transactions/{queue[0]['id']}/decide",
        {"action": "hold", "operator": "ops_demo", "notes": "test"},
    )
    print("decide", decided["decision"]["action"], decided["transaction"]["status"])
print("stats", call("GET", "/stats"))
print("stream", call("POST", "/stream/start"))
print("stop", call("POST", "/stream/stop"))
print("OK")
