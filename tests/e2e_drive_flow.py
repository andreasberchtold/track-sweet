#!/usr/bin/env python3
"""Browser check of the Google sign-in and Drive flow, without Google.

The real app code runs in Chrome, but three things are replaced:
  - site.config.js gets a made-up client ID (so the app leaves demo mode),
  - Google's sign-in script is a stand-in that grants or blocks a token,
  - www.googleapis.com is a small in-memory imitation of the Drive API.

This proves the app's own logic (sign-in screens, saving, reconnecting,
merging a change from another device). It cannot prove that the real
Google services behave like the imitation; that needs your own account.

Usage:  python3 tests/e2e_drive_flow.py
Needs:  Node.js, Python with Playwright, and Chrome.
"""
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8792
BASE = f"http://localhost:{PORT}/apps/movies/"

FAKE_GIS = """
window.google = { accounts: { oauth2: { initTokenClient(config) {
  return { requestAccessToken(options) {
    const log = JSON.parse(sessionStorage.getItem('test:requests') || '[]');
    log.push(options); sessionStorage.setItem('test:requests', JSON.stringify(log));
    setTimeout(() => {
      if (localStorage.getItem('test:block')) config.error_callback({ type: 'popup_failed_to_open' });
      else config.callback({ access_token: 'tok', expires_in: 3599 });
    }, 20);
  } };
} } } };
"""

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
}


class FakeDrive:
    def __init__(self):
        self.files = {}
        self.next_id = 1
        self.fail_next_with_401 = False
        self.requests = 0
        self.about_calls = 0

    def meta(self, f):
        return {"id": f["id"], "headRevisionId": f"rev-{f['rev']}", "version": str(f["rev"]),
                "modifiedTime": "t", "trashed": False, "parents": f.get("parents", [])}

    def data_file(self):
        return next(f for f in self.files.values() if f["name"] == "movies.json")

    def handle(self, route):
        request = route.request
        if request.method == "OPTIONS":
            route.fulfill(status=204, headers=CORS)
            return
        self.requests += 1
        url = urlparse(request.url)
        query = parse_qs(url.query)

        def reply(status, body):
            route.fulfill(status=status, headers={**CORS, "Content-Type": "application/json"},
                          body=body if isinstance(body, str) else json.dumps(body))

        if request.headers.get("authorization") != "Bearer tok":
            reply(401, {"error": {"message": "missing token"}})
            return
        if self.fail_next_with_401:
            self.fail_next_with_401 = False
            reply(401, {"error": {"message": "Invalid Credentials"}})
            return

        path = url.path
        if path == "/drive/v3/about":
            self.about_calls += 1
            reply(200, {"user": {"emailAddress": "me@example.com"}})
        elif path == "/drive/v3/files" and request.method == "GET":
            q = query["q"][0]
            name = re.search(r"name = '([^']*)'", q).group(1)
            parent = re.search(r"'([^']+)' in parents", q)
            found = [f for f in self.files.values()
                     if f["name"] == name and (not parent or parent.group(1) in f.get("parents", []))]
            reply(200, {"files": [self.meta(f) for f in found]})
        elif path == "/drive/v3/files" and request.method == "POST":
            f = {"id": f"id-{self.next_id}", "rev": 1, **json.loads(request.post_data)}
            self.next_id += 1
            self.files[f["id"]] = f
            reply(200, {"id": f["id"]})
        elif path == "/upload/drive/v3/files" and request.method == "POST":
            boundary = request.headers["content-type"].split("boundary=")[1]
            parts = request.post_data.split(f"--{boundary}")[1:-1]
            bodies = [p.split("\r\n\r\n", 1)[1].rstrip("\r\n") for p in parts]
            f = {"id": f"id-{self.next_id}", "rev": 1, **json.loads(bodies[0]), "body": bodies[1]}
            self.next_id += 1
            self.files[f["id"]] = f
            reply(200, self.meta(f))
        else:
            f = self.files.get(path.rsplit("/", 1)[1])
            if not f:
                reply(404, {"error": {"message": "not found"}})
            elif request.method == "PATCH":
                f["body"] = request.post_data
                f["rev"] += 1
                reply(200, self.meta(f))
            elif query.get("alt") == ["media"]:
                reply(200, f["body"])
            else:
                reply(200, self.meta(f))


def main():
    server = subprocess.Popen(["node", str(ROOT / "scripts" / "serve.mjs"), str(PORT)], stdout=subprocess.DEVNULL)
    time.sleep(0.8)
    errors = []
    drive = FakeDrive()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome")
            context = browser.new_context(viewport={"width": 412, "height": 880})
            context.route("**/site.config.js", lambda r: r.fulfill(
                content_type="text/javascript",
                body="export default { googleClientId: 'test-client', driveFolder: 'Personal Apps' };"))
            context.route("https://accounts.google.com/gsi/client", lambda r: r.fulfill(
                content_type="text/javascript", body=FAKE_GIS))
            context.route("https://www.googleapis.com/**", drive.handle)
            page = context.new_page()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "401" not in m.text else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            status = page.locator(".pa-status")

            # 1. First visit: explains where data goes, asks to sign in, loads nothing before.
            page.goto(BASE)
            expect(page.get_by_text("Sign in to start")).to_be_visible()
            expect(page.get_by_text('folder "Personal Apps"')).to_be_visible()
            assert drive.requests == 0
            page.get_by_role("button", name="Sign in with Google").click()
            expect(page.get_by_text("Nothing here yet")).to_be_visible()
            folder = next(f for f in drive.files.values() if f.get("mimeType", "").endswith("folder"))
            assert drive.data_file()["parents"] == [folder["id"]]

            # 2. An entry ends up in the Drive file.
            page.locator(".mv-add").click()
            page.get_by_role("searchbox").fill("Alien")
            page.get_by_role("button", name='Add "Alien" without search').click()
            page.get_by_label("Rate 8 of 10").click()
            page.get_by_role("button", name="Add to list").click()
            expect(status).to_have_text("Saved")
            saved = json.loads(drive.data_file()["body"])
            assert saved["collections"]["titles"][0]["title"] == "Alien"
            assert saved["collections"]["titles"][0]["rating"] == 8
            assert "\n" in drive.data_file()["body"], "the file should be human-readable"

            # 3. Next visit: signed in quietly, straight to the list.
            page.reload()
            expect(page.get_by_role("button", name="Alien")).to_be_visible()
            requests = json.loads(page.evaluate("sessionStorage.getItem('test:requests')"))
            assert requests[-1]["login_hint"] == "me@example.com", requests

            # 4. Browser blocks the quiet attempt: one tap continues.
            page.evaluate("localStorage.setItem('test:block', '1')")
            page.reload()
            expect(page.get_by_text("Welcome back")).to_be_visible()
            page.evaluate("localStorage.removeItem('test:block')")
            page.get_by_role("button", name="Continue as me@example.com").click()
            expect(page.get_by_role("button", name="Alien")).to_be_visible()

            # 5. The sign-in expires mid-session: the change waits, then saves after reconnecting.
            # (Wait for the start-up requests of the three page loads first, so that the
            # simulated expiry hits the save and not a background request.)
            while drive.about_calls < 3:
                page.wait_for_timeout(50)
            drive.fail_next_with_401 = True
            page.get_by_role("button", name="Alien").click()
            page.get_by_label("Rate 9 of 10").click()
            page.get_by_role("button", name="Save changes").click()
            expect(status).to_have_text("Signed out. Tap to reconnect")
            assert json.loads(drive.data_file()["body"])["collections"]["titles"][0]["rating"] == 8
            status.click()
            expect(status).to_have_text("Saved")
            assert json.loads(drive.data_file()["body"])["collections"]["titles"][0]["rating"] == 9

            # 6. Another device added a title meanwhile: both survive.
            doc = json.loads(drive.data_file()["body"])
            doc["collections"]["titles"].append({
                "id": "other-device", "title": "Brazil", "mediaType": "movie", "status": "watched",
                "rating": 7, "watchedOn": "2026-11-01", "createdAt": "2026-11-01T10:00:00.000Z",
                "updatedAt": "2026-11-01T10:00:00.000Z"})
            drive.data_file()["body"] = json.dumps(doc)
            drive.data_file()["rev"] += 1
            page.get_by_role("button", name="Alien").click()
            page.get_by_label("Notes").fill("In space")
            page.get_by_role("button", name="Save changes").click()
            expect(status).to_have_text("Saved")
            expect(page.get_by_role("button", name="Brazil")).to_be_visible()
            titles = {t["title"]: t for t in json.loads(drive.data_file()["body"])["collections"]["titles"]}
            assert titles["Alien"]["notes"] == "In space" and "Brazil" in titles, titles

            # 7. The menu shows where the data lives; sign out returns to the sign-in screen.
            page.get_by_label("Menu").click()
            expect(page.get_by_text("as me@example.com")).to_be_visible()
            expect(page.get_by_role("link", name="Open folder in Drive")).to_have_attribute(
                "href", f"https://drive.google.com/drive/folders/{folder['id']}")
            page.get_by_role("button", name="Sign out").click()
            expect(page.get_by_text("Sign in to start")).to_be_visible()

            browser.close()
    finally:
        server.terminate()

    if errors:
        print("Console errors:")
        for e in errors:
            print("  ", e)
        sys.exit(1)
    print("Sign-in and Drive flow browser check passed.")


if __name__ == "__main__":
    main()
