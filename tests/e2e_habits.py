#!/usr/bin/env python3
"""Browser check of the habit tracker in demo mode (no Google account needed).

Usage:  python3 tests/e2e_habits.py [folder-for-screenshots]
Needs:  Node.js, Python with Playwright, and Chrome.
"""
import json
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8802
BASE = f"http://localhost:{PORT}/apps/habits/"
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None


def shot(page, name, full=False):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=full)


def saved(page):
    return json.loads(page.evaluate("localStorage.getItem('pa:demo:habits')"))["content"]


def main():
    server = subprocess.Popen(["node", str(ROOT / "scripts" / "serve.mjs"), str(PORT)], stdout=subprocess.DEVNULL)
    time.sleep(0.8)
    errors = []
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome")
            # Run in demo mode (data in the browser) whatever site.config.js says.
            demo_config = "export default { googleClientId: '', driveFolder: 'Personal Apps' };"
            new_context = browser.new_context

            def demo_context(**kwargs):
                ctx = new_context(**kwargs)
                ctx.route("**/site.config.js", lambda r: r.fulfill(content_type="text/javascript", body=demo_config))
                return ctx

            browser.new_context = demo_context
            context = browser.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2)
            page = context.new_page()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            status = page.locator(".pa-status")

            # 1. First start: set up pull-ups from "how many in one go".
            page.goto(BASE)
            expect(page.get_by_role("heading", name="Start a habit")).to_be_visible()
            expect(page.get_by_label("Exercise", exact=True)).to_have_value("Pull-ups")
            page.get_by_label("How many can you do in one go, when fresh?").fill("8")
            expect(page.get_by_label("Quick amount 1")).to_have_value("3")
            expect(page.get_by_label("Quick amount 3")).to_have_value("6")
            expect(page.get_by_label("Weekly goal", exact=True)).to_have_value("50")
            page.get_by_role("button", name="Start").click()
            expect(page.get_by_text("of 50 pull-ups")).to_be_visible()
            expect(page.get_by_text("Today: nothing logged yet")).to_be_visible()
            expect(page.get_by_role("heading", name="Make a plan")).to_be_visible()

            # 2. Log with the quick buttons; one message at a time; undo works.
            for _ in range(3):
                page.get_by_label("Log 6 pull-ups").click()
            expect(page.locator(".pa-toast")).to_have_count(1)
            expect(page.get_by_text("Today: 18 pull-ups in 3 sets")).to_be_visible()
            page.get_by_role("button", name="Undo").click()
            expect(page.get_by_text("Today: 12 pull-ups in 2 sets")).to_be_visible()
            expect(page.locator(".hb-big")).to_have_text("12")

            # 3. A set for yesterday through "Other" (counts for the week only if yesterday is in it).
            page.get_by_role("button", name="Other", exact=True).click()
            page.get_by_label("Pull-ups", exact=True).fill("7")
            page.get_by_label("Day", exact=True).fill((today - timedelta(days=1)).isoformat())
            page.get_by_role("button", name="Log set").click()
            expect(page.get_by_text("Today: 12 pull-ups in 2 sets")).to_be_visible()
            expected_week = 12 + (7 if today.weekday() > 0 else 0)
            expect(page.locator(".hb-big")).to_have_text(str(expected_week))

            # 4. Reaching the goal is celebrated.
            while int(page.locator(".hb-big").inner_text()) < 50:
                page.get_by_label("Log 6 pull-ups").click()
            expect(page.locator(".hb-cheer")).to_be_visible()
            page.wait_for_timeout(450)
            shot(page, "2-cheer")
            expect(page.locator(".hb-cheer")).to_have_count(0, timeout=4000)
            expect(page.locator(".hb-status")).to_contain_text("Goal reached")

            # 5. A plan in "after X, I do Y" form.
            page.get_by_role("button", name="Write a plan").click()
            page.get_by_label("Plan", exact=True).fill("After my run, I do two easy sets at the doorway bar.")
            page.get_by_role("button", name="Save plan").click()
            expect(page.get_by_text("After my run, I do two easy sets at the doorway bar.")).to_be_visible()

            # 6. Change the goal through the number in the headline.
            page.get_by_role("button", name="Weekly goal 50. Change goal").click()
            page.get_by_label("Pull-ups this week").fill("60")
            page.get_by_role("button", name="Save goal").click()
            expect(page.get_by_text("of 60 pull-ups")).to_be_visible()
            expect(status).to_have_text("Saved")

            # 7. Charts and records are there; picking a week shows its numbers.
            expect(page.get_by_role("heading", name="Last 12 weeks")).to_be_visible()
            page.locator(".hb-col").last.click()
            expect(page.locator(".hb-detail").first).to_contain_text("This week: ")
            expect(page.locator(".hb-detail").first).to_contain_text("of 60")
            page.locator(".hb-col").first.click()
            expect(page.locator(".hb-detail").first).to_contain_text("Week of ")
            expect(page.get_by_text("Week streak")).to_be_visible()
            shot(page, "1-main", full=True)

            # 8. Everything survives a reload.
            page.reload()
            expect(page.get_by_text("of 60 pull-ups")).to_be_visible()
            doc = saved(page)
            habit = doc["collections"]["habits"][0]
            assert habit["name"] == "Pull-ups" and habit["unit"] == "reps", habit
            assert habit["quick"] == [3, 4, 6], habit
            assert habit["goals"][monday.isoformat()] == 60, habit
            assert all(l["habitId"] == habit["id"] for l in doc["collections"]["logs"])

            # 9. A second exercise counted in seconds; switching between them.
            page.get_by_label("Menu").click()
            expect(page.get_by_text("Development version, not deployed")).to_be_visible()
            page.get_by_role("button", name="Add exercise").click()
            page.get_by_label("Exercise", exact=True).fill("Hangboard")
            page.get_by_role("button", name="Seconds").click()
            expect(page.get_by_label("Quick amount 1")).to_have_value("10")
            page.get_by_label("How many can you do in one go, when fresh?").fill("40")
            expect(page.get_by_label("Weekly goal", exact=True)).to_have_value("240")
            page.get_by_role("button", name="Start").click()
            switch = page.get_by_role("group", name="Exercise")
            expect(switch.get_by_role("button")).to_have_text(["Pull-ups", "Hangboard"])
            expect(page.get_by_text("of 240 seconds")).to_be_visible()
            page.get_by_label("Log 20 seconds").click()
            expect(page.get_by_text("Today: 20 seconds in 1 set")).to_be_visible()
            switch.get_by_role("button", name="Pull-ups").click()
            expect(page.get_by_text("of 60 pull-ups")).to_be_visible()

            # 10. Archive and restore.
            page.get_by_label("Menu").click()
            page.locator(".hb-habitlist li", has_text="Hangboard").get_by_role("button", name="Edit").click()
            page.get_by_role("button", name="Archive").click()
            page.get_by_role("button", name="Archive").last.click()
            expect(page.get_by_role("group", name="Exercise")).to_have_count(0)
            page.get_by_label("Menu").click()
            page.get_by_role("button", name="Restore").click()
            expect(page.get_by_role("group", name="Exercise")).to_be_visible()

            # 11. A new week: last week's result and a suggested goal.
            last_monday = (monday - timedelta(days=7)).isoformat()
            doc = saved(page)
            pull = next(h for h in doc["collections"]["habits"] if h["name"] == "Pull-ups")
            pull["goals"] = {last_monday: 50}
            doc["collections"]["logs"] = [
                {"id": f"x{i}", "habitId": pull["id"], "amount": 10, "date": (monday - timedelta(days=7 - i)).isoformat(),
                 "at": "2026-01-01T08:00:00Z", "createdAt": "2026-01-01T08:00:00Z", "updatedAt": "2026-01-01T08:00:00Z"}
                for i in range(5)
            ]
            page.evaluate("d => localStorage.setItem('pa:demo:habits', JSON.stringify({rev: '99', content: d}))", doc)
            page.reload()
            page.get_by_role("group", name="Exercise").get_by_role("button", name="Pull-ups").click()
            expect(page.get_by_text("New week, fresh start")).to_be_visible()
            expect(page.get_by_text("Last week: 50 of 50. Goal reached.")).to_be_visible()
            shot(page, "3-new-week")
            page.get_by_role("button", name="Go for 55").click()
            expect(page.get_by_text("New week, fresh start")).to_have_count(0)
            expect(page.get_by_text("of 55 pull-ups")).to_be_visible()
            expect(status).to_have_text("Saved")

            # 12. Dark theme, for the record.
            dark = browser.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2,
                                       color_scheme="dark", storage_state=context.storage_state())
            dpage = dark.new_page()
            dpage.goto(BASE)
            expect(dpage.get_by_text("of 55 pull-ups")).to_be_visible()
            shot(dpage, "4-dark", full=True)

            browser.close()
    finally:
        server.terminate()

    if errors:
        print("Console errors:")
        for e in errors:
            print("  ", e)
        sys.exit(1)
    print("Habit tracker browser check passed.")


if __name__ == "__main__":
    main()
