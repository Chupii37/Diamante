#!/usr/bin/env python3
import sys
import json
from curl_cffi import requests

def main():
    try:
        raw_payload = sys.argv[1]
        payload = json.loads(raw_payload)
    except Exception as e:
        print(json.dumps({"error": f"invalid_payload: {e}"}))
        return

    proxy = None
    if len(sys.argv) > 2 and sys.argv[2] and sys.argv[2] != "null":
        proxy = sys.argv[2]

    impersonate = "chrome120"
    if len(sys.argv) > 3 and sys.argv[3]:
        impersonate = sys.argv[3]

    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Access-Token": "key",
        "Origin": "https://campaign.diamante.io",
        "Referer": "https://campaign.diamante.io/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Content-Type": "application/json"
    }

    s = requests.Session()
    try:
        kwargs = {"impersonate": impersonate, "allow_redirects": True}
        if proxy:
            kwargs["proxies"] = {"http": proxy, "https": proxy}

        if proxy:
            try:
                ip_check = s.get("https://api.ipify.org?format=json", headers={"User-Agent": headers["User-Agent"]}, timeout=15, **kwargs)
                if ip_check.status_code != 200:
                    print(json.dumps({"error": "proxy_check_failed", "status_code": ip_check.status_code, "text": ip_check.text, "proxy_used": proxy}))
                    return
            except Exception as e:
                print(json.dumps({"error": "proxy_check_failed", "detail": str(e), "proxy_used": proxy}))
                return

        r = s.post(
            "https://campapi.diamante.io/api/v1/user/connect-wallet",
            data=json.dumps(payload),
            headers=headers,
            **kwargs
        )

        out = {
            "status_code": r.status_code,
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