#!/usr/bin/env python3
"""
Download the California CSLB contractor licence files.

Free, no registration, no fee. Two files matter:

  MasterLicenseData.csv  244k licences with a business phone on 99.9% of them
  PersonnelData.csv      406k named officers with titles, joined on LIC-NO

Why this matters twice over:
  1. Enrichment - licence number on a permit resolves to firm, phone, officers.
  2. Go-to-market - it is the prospect list for selling this product. Class A
     (general engineering) and C12 (earthwork and paving) licensees ARE the
     buyers, and the file hands you their phone numbers.

Email is never included: B&P Code section 27 forbids it.

The portal is ASP.NET WebForms behind an UpdatePanel, and the canonical URL
has no .aspx suffix - posting to ContractorList.aspx returns a redirect delta
with no links. The three-step dance below is what actually works.

  python3 scripts/cslb-fetch.py            # both files
  python3 scripts/cslb-fetch.py master
"""
import os, re, sys, time
import urllib.request, urllib.parse, http.cookiejar

URL = "https://www.cslb.ca.gov/onlineservices/dataportal/ContractorList"
OUT = os.environ.get("CSLB_DATA_DIR") or os.path.expanduser("~/.permit-stack-data")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"

TARGETS = {
    "master":    ("M", "ctl00$MainContent$lbMasterCSV",     "MasterLicenseData.csv"),
    "personnel": ("P", "ctl00$MainContent$lbtnPersonnelcsv", "PersonnelData.csv"),
}

def build_opener():
    jar = http.cookiejar.CookieJar()
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    o.addheaders = [("User-Agent", UA), ("Accept-Language", "en-US,en;q=0.9")]
    return o

def tokens(html):
    """Pull the WebForms state out of a page or an async delta."""
    out = {}
    for field in ("__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"):
        m = re.search(rf'id="{field}" value="([^"]*)"', html)
        if not m:
            # Async deltas encode state as |hiddenField|__VIEWSTATE|<value>|
            m = re.search(rf'\|hiddenField\|{field}\|([^|]*)\|', html)
        if m:
            out[field] = m.group(1)
    return out

def fetch(kind):
    status, event_target, filename = TARGETS[kind]
    opener = build_opener()

    # 1. Prime the session and capture the initial state.
    page = opener.open(URL, timeout=120).read().decode("utf-8", "replace")
    state = tokens(page)
    if "__VIEWSTATE" not in state:
        raise RuntimeError("could not read __VIEWSTATE; the portal markup changed")

    # 2. Select the file type via the async postback, which refreshes the tokens.
    form = {
        "ctl00$MainContent$smPanel": "ctl00$MainContent$uplinks|ctl00$MainContent$ddlStatus",
        "__EVENTTARGET": "ctl00$MainContent$ddlStatus",
        "__EVENTARGUMENT": "",
        "__ASYNCPOST": "true",
        "ctl00$MainContent$ddlStatus": status,
        **state,
    }
    req = urllib.request.Request(URL, data=urllib.parse.urlencode(form).encode(), method="POST")
    req.add_header("X-MicrosoftAjax", "Delta=true")
    req.add_header("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
    req.add_header("Referer", URL)
    delta = opener.open(req, timeout=180).read().decode("utf-8", "replace")
    state = {**state, **tokens(delta)}

    asof = re.search(r"(\d{1,2}/\d{1,2}/\d{4})", delta)
    print(f"  {filename}: portal reports data as of {asof.group(1) if asof else 'unknown'}")

    # 3. Full postback on the download link streams the CSV.
    form = {
        "__EVENTTARGET": event_target,
        "__EVENTARGUMENT": "",
        "ctl00$MainContent$ddlStatus": status,
        **state,
    }
    req = urllib.request.Request(URL, data=urllib.parse.urlencode(form).encode(), method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
    req.add_header("Referer", URL)

    os.makedirs(OUT, exist_ok=True)
    dest = os.path.join(OUT, filename)
    t0 = time.time()
    with opener.open(req, timeout=600) as resp:
        ctype = resp.headers.get("Content-Type", "")
        if "csv" not in ctype and "octet" not in ctype:
            raise RuntimeError(f"expected a CSV, got {ctype!r} - the postback did not return the file")
        size = 0
        with open(dest, "wb") as out:
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
                size += len(chunk)
    print(f"    {size/1e6:.1f} MB in {time.time()-t0:.0f}s -> {dest}")
    return dest

def main():
    want = sys.argv[1:] or ["master", "personnel"]
    for kind in want:
        if kind not in TARGETS:
            print(f"unknown target {kind!r}; choose from {', '.join(TARGETS)}")
            continue
        try:
            fetch(kind)
        except Exception as e:
            print(f"  {kind}: FAILED - {type(e).__name__}: {e}")

if __name__ == "__main__":
    main()
