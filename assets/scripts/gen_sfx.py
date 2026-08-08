#!/usr/bin/env python3
"""Generate SFX for Rugged via Venice.ai async audio API (elevenlabs-sound-effects-v2).

Usage: python3 gen_sfx.py
Reads VENICE_API_KEY from env. Writes mp3 files into ../sfx/.
"""
import base64
import json
import os
import sys
import time
import urllib.request

MODEL = "elevenlabs-sound-effects-v2"
API_KEY = os.environ["VENICE_API_KEY"]
BASE = "https://api.venice.ai/api/v1/audio"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "sfx")

SFX = [
    ("rug.mp3", "Fabric whoosh, coin scatter, descending sci-fi zap, sudden rug pull sound effect", 1.5),
    ("meeting.mp3", "Urgent alarm klaxon, emergency meeting call sound effect", 2),
    ("vote.mp3", "Short confirm blip, UI select sound effect", 0.5),
    ("slash.mp3", "Airlock hiss followed by sad descending synth tone, elimination sound effect", 2),
    ("win-crew.mp3", "Triumphant 8-bit chiptune fanfare, victory sound effect", 3),
    ("win-rugger.mp3", "Evil synth laugh sting, villain victory sound effect", 3),
    ("step.mp3", "Soft single footstep tick, subtle UI sound effect", 0.2),
]


def post(path, payload):
    req = urllib.request.Request(
        f"{BASE}/{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            ctype = resp.headers.get("Content-Type", "")
            data = resp.read()
            if ctype.startswith("audio/"):
                return {"_raw_audio": data}
            return json.loads(data)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"HTTP {e.code} for {path}: {body}")


def _dur_seconds(duration):
    # Round to nearest int, but never collapse to 0 for a short requested clip.
    return max(1, int(round(duration)))


def quote(prompt, duration):
    r = post("quote", {"model": MODEL, "duration_seconds": _dur_seconds(duration)})
    return r["quote"]


def queue(prompt, duration):
    payload = {"model": MODEL, "prompt": prompt, "duration_seconds": _dur_seconds(duration)}
    r = post("queue", payload)
    return r["queue_id"]


def retrieve(queue_id):
    while True:
        r = post("retrieve", {"model": MODEL, "queue_id": queue_id})
        if "_raw_audio" in r:
            return r["_raw_audio"]
        if r.get("status") == "PROCESSING":
            time.sleep(2)
            continue
        # some responses may embed base64 audio in json
        if "audio_base64" in r:
            return base64.b64decode(r["audio_base64"])
        raise RuntimeError(f"Unexpected retrieve response: {r}")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    total_cost = 0.0
    results = []
    for fname, prompt, duration in SFX:
        q = quote(prompt, duration)
        total_cost += q
        print(f"[quote] {fname}: ${q:.4f}", file=sys.stderr)
        qid = queue(prompt, duration)
        print(f"[queue] {fname}: {qid}", file=sys.stderr)
        audio = retrieve(qid)
        out_path = os.path.join(OUT_DIR, fname)
        with open(out_path, "wb") as f:
            f.write(audio)
        print(f"[done] {fname}: {len(audio)} bytes", file=sys.stderr)
        results.append((fname, q, len(audio)))

    print(f"\nTotal quoted cost: ${total_cost:.4f}", file=sys.stderr)
    for fname, q, size in results:
        print(f"{fname}: ${q:.4f}, {size} bytes")


if __name__ == "__main__":
    main()
