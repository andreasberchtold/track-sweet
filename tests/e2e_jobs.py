#!/usr/bin/env python3
"""Browser check of the Jobs app in demo mode (no Google account needed).

Usage:  python3 tests/e2e_jobs.py [folder-for-screenshots]
Needs:  Node.js, Python with Playwright, and Chrome (or set CHROME_PATH).
"""
import json
import os
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8803
BASE = f"http://localhost:{PORT}/apps/jobs/"
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None


def shot(page, name, full=False):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=full)


def saved(page):
    return json.loads(page.evaluate("localStorage.getItem('pa:demo:jobs')"))["content"]


def launch(p):
    if os.environ.get("CHROME_PATH"):
        return p.chromium.launch(executable_path=os.environ["CHROME_PATH"])
    return p.chromium.launch(channel="chrome")


def main():
    server = subprocess.Popen(["node", str(ROOT / "scripts" / "serve.mjs"), str(PORT)], stdout=subprocess.DEVNULL)
    time.sleep(0.8)
    errors = []
    today = date.today()
    try:
        with sync_playwright() as p:
            browser = launch(p)
            demo_config = "export default { googleClientId: '', driveFolder: 'Personal Apps' };"
            context = browser.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2)
            context.route("**/site.config.js", lambda r: r.fulfill(content_type="text/javascript", body=demo_config))
            page = context.new_page()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            status = page.locator(".pa-status")
            cards = page.locator(".jb-card")

            # 1. Empty start.
            page.goto(BASE)
            expect(page.get_by_text("No jobs yet.")).to_be_visible()

            # 2. Shared from a job board (Android share sheet opens ?title=&text=).
            page.goto(BASE + "?title=" + "Senior Software Engineer (80-100%25) - Example AG - jobs.ch"
                      + "&text=https%3A%2F%2Fwww.jobs.ch%2Fen%2Fvacancies%2Fdetail%2Fabc%2F%3Futm_source%3Dshare")
            expect(page.get_by_role("heading", name="Add job")).to_be_visible()
            expect(page.get_by_label("Job title")).to_have_value("Senior Software Engineer (80-100%)")
            expect(page.get_by_label("Company")).to_have_value("Example AG")
            expect(page.get_by_label("Workload")).to_have_value("80–100%")
            expect(page.get_by_label("Link", exact=True)).to_have_value("https://www.jobs.ch/en/vacancies/detail/abc/")
            assert "?" not in page.url, "the shared parameters are removed from the address"
            page.get_by_label("Location").fill("Zurich")
            shot(page, "1-shared")
            page.get_by_role("button", name="Add", exact=True).click()
            expect(cards).to_have_count(1)
            expect(cards.first).to_contain_text("Example AG · Zurich · 80–100%")

            # 3. Pasting a link that is already there warns.
            page.get_by_role("button", name="Add job").click()
            page.get_by_label("Link or posting").fill("https://www.jobs.ch/en/vacancies/detail/abc/?utm_medium=mail")
            expect(page.get_by_text("Already in the list:")).to_be_visible()
            page.get_by_label("Link or posting").fill(
                "Example Corp hiring Fullstack Developer in Zurich | LinkedIn\nhttps://www.linkedin.com/jobs/view/42")
            expect(page.get_by_text("Already in the list:")).to_be_hidden()
            expect(page.get_by_label("Job title")).to_have_value("Fullstack Developer")
            page.get_by_role("button", name="Add", exact=True).click()

            # 4. A third one, added straight away as applied.
            page.get_by_role("button", name="Add job").click()
            page.get_by_label("Job title").fill("Backend Engineer")
            page.get_by_label("Company").fill("Sample GmbH")
            page.get_by_role("button", name="Applied", exact=True).click()
            page.get_by_role("button", name="Add", exact=True).click()
            expect(page.get_by_role("tab", name="Applied")).to_have_attribute("aria-selected", "true")
            expect(cards).to_have_count(1)
            expect(cards.first).to_contain_text(f"Follow up")

            # 5. Judge the two waiting ones.
            page.get_by_role("tab", name="To judge").click()
            expect(cards).to_have_count(2)
            page.locator(".jb-card", has_text="Example AG").get_by_role("button", name="Interesting").click()
            page.get_by_role("button", name="Tech stack").click()
            page.get_by_role("button", name="Domain").click()
            shot(page, "2-judge")
            page.get_by_role("button", name="Save").click()
            page.locator(".jb-card", has_text="Example Corp").get_by_role("button", name="Not for me").click()
            page.get_by_role("button", name="Agency / recruiter").click()
            page.get_by_role("button", name="Save").click()
            expect(page.get_by_text("Nothing to judge right now.")).to_be_visible()

            # 6. Apply for the saved one.
            page.get_by_role("tab", name="Saved").click()
            page.locator(".jb-card", has_text="Example AG").get_by_role("button", name="Applied").click()
            page.get_by_role("tab", name="Applied").click()
            expect(cards).to_have_count(2)

            # 7. Details: contact, CV, interview.
            page.locator(".jb-card", has_text="Example AG").locator(".jb-card__main").click()
            page.get_by_label("Contact person").fill("Jane Doe")
            page.get_by_label("CV sent").fill("cv-2page.pdf")
            page.get_by_label("Status").select_option("interview")
            shot(page, "3-details", full=True)
            page.get_by_role("button", name="Save").click()
            expect(page.locator(".jb-card").first).to_contain_text("Interview")
            expect(status).to_have_text("Saved")

            doc = saved(page)
            jobs = {j["company"]: j for j in doc["collections"]["jobs"]}
            ex = jobs["Example AG"]
            assert ex["status"] == "interview", ex
            assert ex["verdict"] == "yes" and ex["reasons"] == ["Tech stack", "Domain"], ex
            assert ex["appliedOn"] == today.isoformat(), ex
            assert [e["status"] for e in ex["history"]] == ["found", "saved", "applied", "interview"], ex["history"]
            assert ex["contact"] == "Jane Doe" and ex["cv"] == "cv-2page.pdf"
            assert jobs["Example Corp"]["status"] == "dismissed"
            assert jobs["Example Corp"]["reasons"] == ["Agency / recruiter"]

            # 8. A follow-up that is due shows at the top.
            sample = jobs["Sample GmbH"]
            sample["followUpOn"] = (today - timedelta(days=1)).isoformat()
            page.evaluate("d => localStorage.setItem('pa:demo:jobs', JSON.stringify({rev: '99', content: d}))", doc)
            page.reload()
            expect(page.locator(".jb-due")).to_contain_text("Follow-up due")
            expect(page.locator(".jb-due")).to_contain_text("Backend Engineer, Sample GmbH")
            shot(page, "4-applied")

            # 9. Profile in the menu.
            page.get_by_label("Menu").click()
            page.get_by_label("Roles and keywords").fill("Software Engineer, .NET, TypeScript")
            page.get_by_role("button", name="Save", exact=True).click()
            expect(page.get_by_text("Not for me: Agency / recruiter (1)")).to_be_visible()
            page.keyboard.press("Escape")
            expect(status).to_have_text("Saved")
            assert saved(page)["settings"]["profile"]["roles"] == "Software Engineer, .NET, TypeScript"

            # 10. Sources: the built-in list, opening one, adding one.
            page.get_by_role("button", name="Sources", exact=True).click()
            sheet = page.locator(".pa-sheet")
            expect(sheet.get_by_role("heading", name="Job boards (20)")).to_be_visible()
            expect(sheet.locator(".jb-source").first).to_contain_text("★ ")
            jobsch = sheet.locator(".jb-source", has=page.get_by_text("jobs.ch", exact=True))
            expect(jobsch).to_contain_text("E-mail alert")
            with context.expect_page() as popup:
                sheet.locator(".jb-source", has_text="Swisscom").get_by_role("link", name="Open").click()
            popup.value.close()
            expect(sheet.locator(".jb-source", has_text="Swisscom")).to_contain_text("Opened today")
            sheet.get_by_role("button", name="Add source").click()
            page.get_by_label("Name").fill("Example Robotics")
            page.get_by_label("Link", exact=True).fill("https://example.com/careers")
            page.get_by_role("button", name="Save").click()
            expect(page.locator(".jb-source", has_text="Example Robotics")).to_contain_text("Not opened yet")
            shot(page, "5-sources")
            page.keyboard.press("Escape")
            expect(status).to_have_text("Saved")
            doc = saved(page)
            names = [s["name"] for s in doc["collections"]["sources"]]
            assert "Example Robotics" in names and "Proton" in names, names
            swc = next(s for s in doc["collections"]["sources"] if s["name"] == "Swisscom")
            assert swc["checkedOn"] == today.isoformat(), swc
            # Deleted defaults stay deleted after a reload.
            doc["collections"]["sources"] = [s for s in doc["collections"]["sources"] if s["name"] != "Proton"]
            page.evaluate("d => localStorage.setItem('pa:demo:jobs', JSON.stringify({rev: '100', content: d}))", doc)
            page.reload()
            expect(page.locator(".jb-card").first).to_be_visible()
            assert not any(s["name"] == "Proton" for s in saved(page)["collections"]["sources"])

            # 11. Dark theme, for the record.
            dark = browser.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2,
                                       color_scheme="dark", storage_state=context.storage_state())
            dark.route("**/site.config.js", lambda r: r.fulfill(content_type="text/javascript", body=demo_config))
            dpage = dark.new_page()
            dpage.goto(BASE)
            expect(dpage.locator(".jb-card")).to_have_count(2)
            shot(dpage, "6-dark", full=True)

            browser.close()
    finally:
        server.terminate()

    if errors:
        print("Console errors:")
        for e in errors:
            print("  ", e)
        sys.exit(1)
    print("Jobs browser check passed.")


if __name__ == "__main__":
    main()
