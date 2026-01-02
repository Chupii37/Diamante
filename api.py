#!/usr/bin/env python3
import sys
import json
from curl_cffi import requests

def main():
    try:
        url = sys.argv[1]
        method = sys.argv[2].upper()
        payload = json.loads(sys.argv[3]) if sys.argv[3] != "null" else None
        headers = json.loads(sys.argv[4])
        proxy = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else None
    except Exception as e:
        print(json.dumps({"error": f"invalid_args: {e}"}))
        return

    s = requests.Session()

    kwargs = {
        "headers": headers,
        "impersonate": "chrome110",
        "allow_redirects": True
    }

    if proxy:
        kwargs["proxies"] = {"http": proxy, "https": proxy}

    try:
        if method == "GET":
            r = s.get(url, **kwargs)
        else:
            r = s.post(url, json=payload, **kwargs)

        out = {
            "status": r.status_code,
            "headers": dict(r.headers),
            "text": r.text,
            "proxy_used": proxy
        }

        try:
            out["json"] = r.json()
        except Exception:
            out["json"] = None

        print(json.dumps(out))
    except Exception as e:
        print(json.dumps({"error": str(e), "proxy_used": proxy}))

if __name__ == "__main__":
    main()