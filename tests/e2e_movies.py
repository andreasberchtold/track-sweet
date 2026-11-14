#!/usr/bin/env python3
"""Browser check of the movie tracker in demo mode (no Google account needed).

Starts the local server, drives the app like a user would, and fails on any
console error. TMDB is replaced by canned answers, so no key is needed.

Usage:  python3 tests/e2e_movies.py [folder-for-screenshots]
Needs:  Node.js, Python with Playwright, and Chrome.
"""
import json
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8791
BASE = f"http://localhost:{PORT}/apps/movies/"
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None

# Search answers for the "Import a list" step, by query.
LIST_SEARCH = {
    "Suspiria": [
        {"id": 900, "media_type": "movie", "title": "Suspiria", "release_date": "2018-10-26", "poster_path": None},
        {"id": 901, "media_type": "movie", "title": "Suspiria", "release_date": "1977-02-01", "poster_path": None},
    ],
    "Saltburn": [{"id": 902, "media_type": "movie", "title": "Saltburn", "release_date": "2023-11-17", "poster_path": None}],
    "Butterfly effect": [{"id": 903, "media_type": "movie", "title": "The Butterfly Effect", "release_date": "2004-01-23", "poster_path": None}],
    "True detective": [{"id": 904, "media_type": "tv", "name": "True Detective", "first_air_date": "2014-01-12", "poster_path": None}],
    "Rachel McAdams": [{"id": 905, "media_type": "movie", "title": "About Time", "release_date": "2013-09-04", "poster_path": None}],
}

LIST_TEXT = """📺 Series / Movies

  ❏ Suspiria (1977)
  ❏ Saltburn (2023) -> alleine schauen: https://www.imdb.com/title/tt17351924/
  ❏ Butterfly effect -> tip from Ben
  ❏ Rachel McAdams?
  ❏ True detective?
"""

SEARCH = {
    "results": [
        {"id": 1396, "media_type": "tv", "name": "Breaking Bad", "first_air_date": "2008-01-20", "poster_path": None},
        {"id": 27205, "media_type": "movie", "title": "Inception", "release_date": "2010-07-15", "poster_path": None},
        {"id": 5, "media_type": "person", "name": "Somebody"},
    ]
}


def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"))


def main():
    server = subprocess.Popen(
        ["node", str(ROOT / "scripts" / "serve.mjs"), str(PORT)], stdout=subprocess.DEVNULL
    )
    time.sleep(0.8)
    errors = []
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
            context = browser.new_context(
                viewport={"width": 412, "height": 880}, device_scale_factor=2, color_scheme="light"
            )
            page = context.new_page()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))

            def tmdb(route):
                url = route.request.url
                if "/search/multi" in url:
                    assert "api_key=test-key" in url, url
                    query = parse_qs(urlparse(url).query)["query"][0]
                    route.fulfill(json={"results": LIST_SEARCH[query]} if query in LIST_SEARCH else SEARCH)
                elif "/find/tt17351924" in url:
                    route.fulfill(json={"movie_results": [{"id": 902, "poster_path": None}], "tv_results": []})
                elif "/movie/90" in url or "/tv/904" in url:
                    tid = urlparse(url).path.rsplit("/", 1)[1]  # a distinct IMDb id per title
                    route.fulfill(json={"imdb_id": f"tt990{tid}", "runtime": 99, "episode_run_time": [55],
                                        "number_of_seasons": 4, "external_ids": {"imdb_id": f"tt990{tid}"}})
                elif "/tv/1396" in url:
                    route.fulfill(json={"number_of_seasons": 5, "episode_run_time": [47],
                                        "external_ids": {"imdb_id": "tt0903747"}})
                elif "/find/tt0110912" in url:
                    route.fulfill(json={"movie_results": [{"id": 680, "poster_path": None}], "tv_results": []})
                elif "/find/" in url:
                    route.fulfill(json={"movie_results": [], "tv_results": []})
                elif "/movie/680" in url:
                    route.fulfill(json={"imdb_id": "tt0110912", "runtime": 154})
                elif "/movie/238" in url:
                    route.fulfill(json={"imdb_id": "tt0068646", "runtime": 175})
                elif "/movie/27205" in url:
                    route.fulfill(json={"imdb_id": "tt1375666", "runtime": 148,
                                        "genres": [{"id": 28, "name": "Action"}, {"id": 878, "name": "Science Fiction"}]})
                else:
                    route.fulfill(status=404, json={})

            page.route("https://api.themoviedb.org/**", tmdb)

            def omdb(route):
                imdb = parse_qs(urlparse(route.request.url).query)["i"][0]
                if imdb == "tt1375666":
                    route.fulfill(json={"Response": "True", "imdbRating": "8.8", "Ratings": [
                        {"Source": "Internet Movie Database", "Value": "8.8/10"},
                        {"Source": "Rotten Tomatoes", "Value": "87%"}]})
                else:
                    route.fulfill(json={"Response": "True", "imdbRating": "7.1", "Ratings": []})

            page.route("https://www.omdbapi.com/**", omdb)

            # 1. Opens in demo mode with an empty list.
            page.goto(BASE)
            expect(page.get_by_text("Demo mode")).to_be_visible()
            expect(page.get_by_text("Nothing here yet")).to_be_visible()
            shot(page, "1-empty")

            # 2. Add a title by hand (no TMDB key yet).
            page.get_by_role("button", name="Add title").first.click()
            page.get_by_role("searchbox").fill("Stalker")
            page.get_by_role("button", name='Add "Stalker" without search').click()
            page.get_by_label("Rate 9 of 10").click()
            expect(page.get_by_text("9 of 10")).to_be_visible()
            page.get_by_label("Notes").fill("Slow, strange, wonderful")
            page.wait_for_timeout(400)
            shot(page, "2-editor")
            page.get_by_role("button", name="Add to list").click()
            expect(page.get_by_role("button", name="Stalker")).to_be_visible()
            expect(page.get_by_text("1 watched")).to_be_visible()

            # 3. Save a TMDB key in the menu, then search.
            page.get_by_label("Menu").click()
            page.get_by_label("TMDB key").fill("test-key")
            page.get_by_label("OMDb key (for IMDb and Rotten Tomatoes ratings)").fill("omdb-key")
            page.get_by_role("button", name="Save search settings").click()
            page.locator(".mv-add").click()
            page.get_by_role("searchbox").fill("bre")
            page.get_by_role("button", name="Breaking Bad").click()
            expect(page.get_by_text("0 of 5")).to_be_visible()
            page.get_by_role("button", name="Watching", exact=True).click()
            page.get_by_label("One season more").click()
            page.get_by_label("One season more").click()
            page.get_by_label("Rate 10 of 10").click()
            page.get_by_role("button", name="Add to list").click()
            expect(page.get_by_text("Watching now")).to_be_visible()
            expect(page.get_by_text("2 of 5 seasons")).to_be_visible()

            # 4. Something for the watchlist.
            page.get_by_role("button", name="Watchlist", exact=True).click()
            page.locator(".mv-add").click()
            page.get_by_role("searchbox").fill("inc")
            page.get_by_role("button", name="Inception").click()
            expect(page.get_by_text("Movie, 2010, 2 h 28 min")).to_be_visible()
            expect(page.locator(".mv-editor").get_by_text("Action, Science Fiction")).to_be_visible()
            expect(page.locator(".mv-ratings")).to_have_text("IMDb 8.8Rotten Tomatoes 87%")
            expect(page.get_by_role("link", name="Open on IMDb")).to_have_attribute(
                "href", "https://www.imdb.com/title/tt1375666/")
            page.get_by_role("button", name="Girlfriend").last.click()
            page.get_by_role("button", name="Friends").last.click()
            page.get_by_role("button", name="Add to list").click()
            expect(page.get_by_text("1 to watch")).to_be_visible()

            # 4b. A second, shorter one to watch alone, typed in by hand.
            page.locator(".mv-add").click()
            page.get_by_role("searchbox").fill("zzz")
            page.get_by_role("button", name='Add "zzz" without search').click()
            page.get_by_role("textbox", name="Title").fill("Le Samourai")
            page.get_by_label("Running time in minutes").fill("105")
            page.get_by_role("button", name="Alone").last.click()
            page.get_by_role("button", name="Add to list").click()
            expect(page.get_by_text("2 to watch")).to_be_visible()

            # Watchlist rows show running time, who it is for, and an IMDb link.
            rows = page.locator(".mv-item")
            inception = rows.filter(has_text="Inception")
            expect(inception).to_contain_text("Movie, 2010, 2 h 28 min")
            expect(inception.locator(".mv-row__genres")).to_have_text("Action, Science Fiction")
            genre = page.get_by_label("Genre")
            expect(genre.locator("option")).to_have_text(["All genres", "Action (1)", "Science Fiction (1)"])
            genre.select_option("Action")
            expect(rows).to_have_count(1)
            genre.select_option("all")
            expect(inception.locator(".mv-tag")).to_have_text(["Friends", "Girlfriend"])
            expect(inception.locator(".mv-imdb")).to_have_text("8.8")
            expect(inception.get_by_role("link", name="Inception on IMDb, rated 8.8")).to_have_attribute(
                "href", "https://www.imdb.com/title/tt1375666/")
            expect(rows.filter(has_text="Le Samourai").get_by_role("link")).to_have_attribute(
                "href", "https://www.imdb.com/find/?s=tt&q=Le%20Samourai")
            shot(page, "3-watchlist")

            # Filter by company, and sort by running time.
            who = page.get_by_role("group", name="Watch with")
            who.get_by_role("button", name="Girlfriend").click()
            expect(rows).to_have_count(1)
            expect(rows).to_contain_text("Inception")
            who.get_by_role("button", name="Alone").click()
            expect(rows).to_contain_text(["Le Samourai"])
            who.get_by_role("button", name="Anyone").click()
            page.get_by_label("Sort by").select_option("shortest")
            expect(rows.locator(".mv-row__title")).to_have_text(["Le Samourai", "Inception"])
            page.get_by_label("Sort by").select_option("recent")

            # 5. The data survives a reload (it was saved, not just kept in memory).
            page.get_by_role("button", name="Watched", exact=True).click()
            expect(page.locator(".pa-status")).to_have_text("Saved")
            page.reload()
            expect(page.get_by_role("button", name="Stalker")).to_be_visible()
            expect(page.get_by_role("button", name="Breaking Bad")).to_be_visible()
            shot(page, "4-watched")

            saved = json.loads(page.evaluate("localStorage.getItem('pa:demo:movies')"))
            titles = saved["content"]["collections"]["titles"]
            assert len(titles) == 4, titles
            by_title = {t["title"]: t for t in titles}
            assert by_title["Inception"]["watchWith"] == ["friends", "partner"], by_title["Inception"]
            assert by_title["Inception"]["runtime"] == 148 and by_title["Inception"]["imdbId"] == "tt1375666"
            assert by_title["Breaking Bad"]["imdbId"] == "tt0903747"
            assert by_title["Le Samourai"]["watchWith"] == ["solo"] and by_title["Le Samourai"]["runtime"] == 105
            assert saved["content"]["settings"]["tmdbKey"] == "test-key"

            # 6. A change made in another tab is not overwritten.
            other = context.new_page()
            other.goto(BASE)
            other.get_by_role("button", name="Stalker").click()
            other.get_by_label("Rate 7 of 10").click()
            other.get_by_role("button", name="Save changes").click()
            expect(other.locator(".pa-status")).to_have_text("Saved")
            other.close()
            page.get_by_role("button", name="Breaking Bad").click()
            page.get_by_label("One season more").click()
            page.get_by_role("button", name="Save changes").click()
            expect(page.locator(".pa-status")).to_have_text("Saved")
            expect(page.get_by_label("Rated 7 of 10")).to_be_visible()
            expect(page.get_by_text("3 of 5 seasons")).to_be_visible()

            # 7. Delete and undo.
            page.get_by_role("button", name="Stalker").click()
            page.get_by_role("button", name="Delete", exact=True).click()
            page.get_by_role("button", name="Delete", exact=True).last.click()
            expect(page.get_by_role("button", name="Stalker")).to_have_count(0)
            page.get_by_role("button", name="Undo").click()
            expect(page.get_by_role("button", name="Stalker")).to_be_visible()

            # 7b. Change the "watch with" tags in the menu: rename one, remove one, add one.
            page.get_by_label("Menu").click()
            names = page.get_by_label("Tag name")
            expect(names).to_have_count(3)
            names.nth(1).fill("Date night")
            page.get_by_role("button", name="Remove Alone").click()
            page.get_by_role("button", name="Add tag").click()
            names.nth(2).fill("Family")
            page.get_by_role("button", name="Save tags").click()
            expect(page.locator(".pa-status")).to_have_text("Saved")
            page.get_by_role("button", name="Watchlist", exact=True).click()
            who = page.get_by_role("group", name="Watch with")
            expect(who.get_by_role("button")).to_have_text(["Anyone", "Friends", "Date night", "Family"])
            # The renamed tag stays on its title; the removed one is gone from its title.
            expect(rows.filter(has_text="Inception").locator(".mv-tag")).to_have_text(["Friends", "Date night"])
            expect(rows.filter(has_text="Le Samourai").locator(".mv-tag")).to_have_count(0)
            page.get_by_role("button", name="Le Samourai").click()
            page.get_by_role("button", name="Family").last.click()
            page.get_by_role("button", name="Save changes").click()
            who.get_by_role("button", name="Family").click()
            expect(rows).to_have_count(1)
            expect(rows).to_contain_text("Le Samourai")
            expect(page.locator(".pa-status")).to_have_text("Saved")
            saved = json.loads(page.evaluate("localStorage.getItem('pa:demo:movies')"))["content"]
            tags = saved["settings"]["watchWithTags"]
            assert [t["label"] for t in tags] == ["Friends", "Date night", "Family"], tags
            assert tags[1]["id"] == "partner", tags
            by_title = {t["title"]: t for t in saved["collections"]["titles"]}
            assert by_title["Inception"]["watchWith"] == ["friends", "partner"]
            assert by_title["Le Samourai"]["watchWith"] == [tags[2]["id"]], by_title["Le Samourai"]
            page.reload()
            page.get_by_role("button", name="Watchlist", exact=True).click()
            expect(who.get_by_role("button")).to_have_text(["Anyone", "Friends", "Date night", "Family"])
            page.get_by_role("button", name="Watched", exact=True).click()

            # 7c. Import a SIMKL export, twice: the second run must not duplicate anything.
            sample = str(ROOT / "tests" / "fixtures" / "simkl-sample.json")
            page.get_by_label("Menu").click()
            page.get_by_label("SIMKL export file").set_input_files(sample)
            expect(page.get_by_text(
                "Found 2 watched, 1 watching, 1 on the watchlist, 1 not interesting.")).to_be_visible()
            page.get_by_role("button", name="Import 5 titles").click()
            expect(page.get_by_text("Imported 5 titles", exact=True)).to_be_visible()
            godfather = rows.filter(has_text="The Godfather")
            expect(godfather).to_contain_text("Rewatch with commentary")
            expect(godfather.get_by_label("Rated 9 of 10")).to_be_visible()
            expect(godfather.get_by_role("link")).to_have_attribute("href", "https://www.imdb.com/title/tt0068646/")
            expect(page.get_by_text("Last watched S02E05")).to_be_visible()
            page.get_by_role("button", name="Watchlist", exact=True).click()
            expect(rows.filter(has_text="Pulp Fiction")).to_contain_text("Movie, 1994, 2 h 34 min")
            expect(page.locator(".pa-status")).to_have_text("Saved")
            page.get_by_label("Menu").click()
            page.get_by_label("SIMKL export file").set_input_files(sample)
            page.get_by_role("button", name="Import 5 titles").click()
            expect(page.get_by_text("Imported 0 titles, 5 were already in your list")).to_be_visible()
            saved = json.loads(page.evaluate("localStorage.getItem('pa:demo:movies')"))["content"]
            assert len(saved["collections"]["titles"]) == 9, len(saved["collections"]["titles"])

            # 7d. The "Not interesting" tab holds SIMKL's dropped titles; a title can be moved out again.
            page.get_by_role("button", name="Not interesting", exact=True).click()
            expect(page.get_by_text("1 not interesting")).to_be_visible()
            expect(rows).to_contain_text(["Some Dud"])
            shot(page, "9-not-interesting")
            page.get_by_role("button", name="Some Dud").click()
            expect(page.get_by_label("Rate 5 of 10")).to_have_count(0)
            shot(page, "9b-not-interesting-editor")
            page.get_by_role("button", name="Watchlist", exact=True).last.click()
            page.get_by_role("button", name="Save changes").click()
            expect(page.get_by_text("4 to watch")).to_be_visible()
            page.get_by_role("button", name="Some Dud").click()
            page.get_by_role("button", name="Not interesting", exact=True).last.click()
            page.get_by_role("button", name="Save changes").click()
            expect(page.get_by_text("1 not interesting")).to_be_visible()
            expect(page.locator(".pa-status")).to_have_text("Saved")
            pulp = next(t for t in saved["collections"]["titles"] if t["title"] == "Pulp Fiction")
            assert pulp["tmdbId"] == 680 and pulp["simklId"] == 54130 and pulp["status"] == "watchlist", pulp
            page.get_by_role("button", name="Watched", exact=True).click()

            # 7e. Import a pasted list: default tag, "alleine" note, matches to check, skip one.
            page.get_by_label("Menu").click()
            page.get_by_label("Tag name").first.fill("3er")
            page.get_by_role("button", name="Add tag").click()
            page.get_by_label("Tag name").last.fill("Alone")
            page.get_by_role("button", name="Save tags").click()
            page.get_by_label("Menu").click()
            page.get_by_role("button", name="Paste a list").click()
            page.get_by_label("Your list").fill(LIST_TEXT)
            expect(page.get_by_role("group", name="Watch with by default").get_by_role("button", name="3er")).to_have_attribute("aria-pressed", "true")
            page.get_by_role("button", name="Find titles").click()
            expect(page.get_by_text("5 titles found.")).to_be_visible()
            rows = page.locator(".mv-li__row")
            expect(rows).to_have_count(5)
            suspiria = rows.nth(0)
            expect(suspiria.locator(".mv-row__meta")).to_have_text("Movie, 1977")
            expect(suspiria.locator(".mv-tag--check")).to_have_count(0)
            saltburn = rows.nth(1)
            expect(saltburn.get_by_role("button", name="Alone")).to_have_attribute("aria-pressed", "true")
            expect(saltburn.get_by_role("button", name="3er")).to_have_attribute("aria-pressed", "false")
            expect(saltburn.get_by_label("Note for Saltburn")).to_have_value("")
            butterfly = rows.nth(2)
            expect(butterfly.locator(".mv-row__title")).to_have_text("The Butterfly Effect")
            expect(butterfly.get_by_label("Note for The Butterfly Effect")).to_have_value("tip from Ben")
            mcadams = rows.nth(3)
            expect(mcadams.locator(".mv-tag--check")).to_be_visible()
            mcadams.get_by_label("Add About Time").uncheck()
            expect(rows.nth(4).locator(".mv-tag--check")).to_be_visible()
            shot(page, "10-list-review")
            page.get_by_role("button", name="Add 4 to watchlist").click()
            expect(page.get_by_text("Added 4 to your watchlist")).to_be_visible()
            expect(page.locator(".pa-status")).to_have_text("Saved")
            doc = json.loads(page.evaluate("localStorage.getItem('pa:demo:movies')"))["content"]
            listed = {t["title"]: t for t in doc["collections"]["titles"]}
            assert listed["Suspiria"]["tmdbId"] == 901 and listed["Suspiria"]["status"] == "watchlist", listed["Suspiria"]
            assert listed["Suspiria"]["watchWith"] == ["friends"], listed["Suspiria"]
            alone_id = next(t["id"] for t in doc["settings"]["watchWithTags"] if t["label"] == "Alone")
            assert listed["Saltburn"]["watchWith"] == [alone_id], listed["Saltburn"]
            assert listed["The Butterfly Effect"]["notes"] == "tip from Ben"
            assert listed["The Butterfly Effect"]["runtime"] == 99
            assert listed["True Detective"]["mediaType"] == "tv"
            assert "About Time" not in listed
            page.get_by_role("button", name="Watchlist", exact=True).click()
            expect(page.locator(".mv-item").filter(has_text="Saltburn").locator(".mv-tag")).to_have_text(["Alone"])
            page.get_by_role("button", name="Watched", exact=True).click()

            # 8. Dark theme and a wide screen, for the record.
            dark = browser.new_context(
                viewport={"width": 412, "height": 880}, device_scale_factor=2, color_scheme="dark",
                storage_state=context.storage_state(),
            )
            dpage = dark.new_page()
            dpage.goto(BASE)
            dpage.get_by_role("button", name="Breaking Bad").click()
            expect(dpage.get_by_text("10 of 10")).to_be_visible()
            dpage.wait_for_timeout(400)
            shot(dpage, "5-dark-editor")
            wide = browser.new_context(viewport={"width": 1280, "height": 800}, storage_state=context.storage_state())
            wpage = wide.new_page()
            wpage.goto(BASE)
            expect(wpage.get_by_role("button", name="Stalker")).to_be_visible()
            shot(wpage, "6-desktop")

            browser.close()
    finally:
        server.terminate()

    if errors:
        print("Console errors:")
        for e in errors:
            print("  ", e)
        sys.exit(1)
    print("Movie tracker browser check passed.")


if __name__ == "__main__":
    main()
