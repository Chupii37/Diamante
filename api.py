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

    keys_to_remove = [k for k in headers.keys() if k.lower() == 'user-agent']
    for k in keys_to_remove:
        del headers[k]

    impersonate = "safari15_5"

    proxies = {"http": proxy, "https": proxy} if proxy else None

    try:
        req_kwargs = {
            "method": method,
            "url": url,
            "headers": headers,
            "proxies": proxies,
            "impersonate": impersonate,
            "timeout": 30
        }

        if payload:
            req_kwargs["json"] = payload

        r = requests.request(**req_kwargs)

        is_html_block = "<html" in r.text.lower() and r.status_code == 403
        response_text = "CLOUDFLARE_BLOCK_API" if is_html_block else r.text

        out = {
            "status_code": r.status_code,
            "headers": dict(r.headers),
            "text": response_text,
            "proxy_used": proxy
        }

        try:
            out["json"] = r.json()
        except Exception:
            out["json"] = None

        print(json.dumps(out))

    except Exception as e:
        print(json.dumps({"error": str(e), "status_code": 0, "proxy_used": proxy}))

if __name__ == "__main__":
    main()
