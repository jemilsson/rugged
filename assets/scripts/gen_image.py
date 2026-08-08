#!/usr/bin/env python3
"""Generate a single image via Venice.ai image API, with fallback model.
Usage: gen_image.py <output_path> <width> <height> <prompt_file_or_-> [--model MODEL] [--fallback MODEL]
"""
import base64
import json
import os
import sys
import urllib.request

API_URL = "https://api.venice.ai/api/v1/image/generate"


def call(model, prompt, width, height, key):
    # nano-banana-pro / flux-2-pro only honor aspect_ratio, not width/height directly.
    ratios = {
        (1024, 1024): "1:1",
        (1280, 720): "16:9",
        (1376, 768): "16:9",
    }
    payload = {
        "model": model,
        "prompt": prompt,
        "format": "png",
    }
    ratio = ratios.get((width, height))
    if ratio:
        payload["aspect_ratio"] = ratio
    else:
        payload["width"] = width
        payload["height"] = height
    body = json.dumps(payload).encode()
    req = urllib.request.Request(API_URL, data=body, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read())


def main():
    out_path, width, height, prompt = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    model = "nano-banana-pro"
    fallback = "flux-2-pro"
    key = os.environ["VENICE_API_KEY"]

    try:
        data = call(model, prompt, width, height, key)
        used = model
    except Exception as e:
        sys.stderr.write(f"primary model failed: {e}\nfalling back to {fallback}\n")
        data = call(fallback, prompt, width, height, key)
        used = fallback

    images = data.get("images") or data.get("data")
    if not images:
        raise SystemExit(f"no images in response: {json.dumps(data)[:500]}")
    img_b64 = images[0]
    if isinstance(img_b64, dict):
        img_b64 = img_b64.get("b64_json") or img_b64.get("image")

    with open(out_path, "wb") as f:
        f.write(base64.b64decode(img_b64))

    print(f"OK model={used} -> {out_path}")


if __name__ == "__main__":
    main()
