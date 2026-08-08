#!/usr/bin/env python3
"""Generate a music track via Venice.ai async audio API.

Usage: gen_music.py <output.mp3> <model> <prompt> [--loop]
Requires VENICE_API_KEY env var.
"""
import sys
import os
import time
import json
import urllib.request

API = "https://api.venice.ai/api/v1"
KEY = os.environ["VENICE_API_KEY"]


def post(path, payload, want_json=True):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise SystemExit(f"HTTP {e.code}: {body}")
    ctype = resp.headers.get("Content-Type", "")
    data = resp.read()
    if "json" in ctype:
        return json.loads(data), ctype
    return data, ctype


def main():
    out_path, model, prompt = sys.argv[1], sys.argv[2], sys.argv[3]
    loop = "--loop" in sys.argv[4:]

    quote, _ = post("/audio/quote", {"model": model})
    print(f"quote: ${quote['quote']} for model {model}", file=sys.stderr)

    payload = {"model": model, "prompt": prompt}
    if loop:
        payload["loop"] = True
    try:
        queued, _ = post("/audio/queue", payload)
    except SystemExit as e:
        msg = str(e)
        if "does not support" in msg and "loop" in msg:
            payload.pop("loop", None)
            queued, _ = post("/audio/queue", payload)
        else:
            raise
    queue_id = queued["queue_id"]
    print(f"queued: {queue_id}", file=sys.stderr)

    while True:
        result, ctype = post("/audio/retrieve", {"model": model, "queue_id": queue_id})
        if "json" in ctype:
            status = result.get("status")
            print(f"status: {status}", file=sys.stderr)
            if status == "PROCESSING":
                time.sleep(5)
                continue
            raise SystemExit(f"unexpected json response: {result}")
        else:
            with open(out_path, "wb") as f:
                f.write(result)
            print(f"saved {out_path} ({len(result)} bytes, {ctype})", file=sys.stderr)
            print(json.dumps({"cost": quote["quote"], "model": model, "path": out_path}))
            return


if __name__ == "__main__":
    main()
