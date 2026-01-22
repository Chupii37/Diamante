import sys
import json
from curl_cffi import requests

def main():
    try:
        raw_payload = sys.argv[1]
        payload = json.loads(raw_payload)
    except Exception:
        payload = {}

    proxy = None
    if len(sys.argv) > 2 and sys.argv[2] and sys.argv[2] != "null":
        proxy = sys.argv[2]

    impersonate = "safari15_5"

    proxies = {"http": proxy, "https": proxy} if proxy else None
    
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Origin": "https://campaign.diamante.io",
        "Referer": "https://campaign.diamante.io/",
    }

    try:
        url = "https://campapi.diamante.io/api/v1/user/connect-wallet"

        r = requests.post(
            url,
            json=payload,
            headers=headers,
            proxies=proxies,
            impersonate=impersonate,
            timeout=30
        )

        is_html = "<!DOCTYPE html>" in r.text or "<html" in r.text
        response_text = "CLOUDFLARE_BLOCKED_ME" if (r.status_code == 403 and is_html) else r.text

        out = {
            "status_code": r.status_code,
            "headers": dict(r.headers),
            "text": response_text,
            "proxy_used": proxy
        }
        
        try:
            out["json"] = r.json()
        except:
            out["json"] = None

        print(json.dumps(out))

    except Exception as e:
        print(json.dumps({"error": str(e), "status_code": 0}))

if __name__ == "__main__":
    main()
