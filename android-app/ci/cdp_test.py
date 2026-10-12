"""Drives the WebView of the debug app over Chrome DevTools: checks + screenshots."""
import json, sys, time, base64, urllib.request
import websocket  # websocket-client

OUT = sys.argv[1]
def log(kind, msg): print(f"{kind:5} {msg}", flush=True)

targets = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=10).read())
page = next((t for t in targets if t.get("type") == "page"), None)
if not page:
    log("FAIL", "no page target in the WebView"); sys.exit(0)
ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=60, suppress_origin=True)
_id = [0]
def cmd(method, **params):
    _id[0] += 1; my = _id[0]
    ws.send(json.dumps({"id": my, "method": method, "params": params}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == my: return m.get("result", m.get("error"))
def js(expr, wait=True):
    r = cmd("Runtime.evaluate", expression=expr, awaitPromise=wait, returnByValue=True)
    return (r or {}).get("result", {}).get("value")
def shot(name):
    r = cmd("Page.captureScreenshot", format="png")
    if r and "data" in r:
        open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(r["data"])); log("....", f"screenshot {name}.png")

cmd("Page.enable"); cmd("Runtime.enable")
for _ in range(30):
    if js("document.readyState") == "complete": break
    time.sleep(1)
log("....", f"page: {js('location.href')}")
ua = js("navigator.userAgent") or ""
log("PASS" if "RankerNodeApp/" in ua else "FAIL", f"app identifies itself to the site (UA has RankerNodeApp/)")
log("PASS" if js("typeof window.RankerNodeAndroid") == "object" else "FAIL", "download bridge present on the page")
log("PASS" if js("!!window.__aeroSaveBlob") else "FAIL", "website download helper active (new app.js is live)")
v = js("document.documentElement.classList.contains('aero-in-app')")
log("PASS" if v else "FAIL", "site switched to in-app mode (Get App hidden)")
time.sleep(2); shot("10-login")

# native bridge: write a small text file
r = js("""(function(){ const B=window.RankerNodeAndroid; if(!B) return 'no bridge';
  const a=B.begin('bridge-test.txt','text/plain'); if(a!=='ok') return 'begin='+a;
  B.chunk(btoa('hello from the RankerNode test')); B.end(); return 'ok'; })()""")
log("PASS" if r == "ok" else "FAIL", f"bridge begin/chunk/end → {r}")
time.sleep(3)
# what the notes 'Export as PDF' does: a blob download through the site's helper
r = js("""(async function(){ if(!window.__aeroSaveBlob) return 'helper missing';
  const pdf = '%PDF-1.4\\n1 0 obj<</Type/Catalog>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF\\n';
  await window.__aeroSaveBlob(new Blob([pdf], {type:'application/pdf'}), 'notes-export-test.pdf'); return 'ok'; })()""")
log("PASS" if r == "ok" else "FAIL", f"blob download through the site → {r}")
time.sleep(3)
# an <a download href=blob:> click, exactly like notes.js / admin exports
r = js("""(function(){ const u=URL.createObjectURL(new Blob(['a,b\\n1,2\\n'],{type:'text/csv'}));
  const a=document.createElement('a'); a.href=u; a.download='anchor-test.csv'; document.body.appendChild(a); a.click(); a.remove(); return 'clicked'; })()""")
log("....", f"anchor download → {r}")
time.sleep(3)

# landing page look + mobile layout
js("location.href='https://rankernode.example/'", wait=False); time.sleep(12); shot("11-landing")
js("window.scrollTo(0, document.body.scrollHeight*0.45)"); time.sleep(2); shot("12-landing-mid")
js("location.href='https://rankernode.example/app'", wait=False); time.sleep(10); shot("13-app-again")
ws.close()
