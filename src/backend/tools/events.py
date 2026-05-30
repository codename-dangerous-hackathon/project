import re
import json
import time
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.eventbrite.ca/d/canada--toronto/dementia/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-CA,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}


def fetch_page(session, url):
    resp = session.get(url, timeout=20)
    print(f"  HTTP {resp.status_code} — {url}")
    resp.raise_for_status()
    return resp.text


def get_total_pages(soup):
    pagination = soup.find(string=re.compile(r"\d+\s+of\s+\d+"))
    if pagination:
        match = re.search(r"(\d+)\s+of\s+(\d+)", pagination)
        if match:
            return int(match.group(2))
    return 1


def parse_events(html):
    soup = BeautifulSoup(html, "html.parser")
    events = []
    seen_urls = set()

    # Target the specific event card links Eventbrite uses
    for link in soup.find_all("a", class_="event-card-link"):
        href = link.get("href", "")
        if not href or "/e/" not in href:
            continue

        clean_url = href.split("?")[0]
        if clean_url in seen_urls:
            continue
        seen_urls.add(clean_url)

        # Title is in the h3 inside the link
        h3 = link.find("h3")
        title = h3.get_text(strip=True) if h3 else link.get("aria-label", "").replace("View ", "")
        if not title:
            continue

        event_id_match = re.search(r"-(\d+)$", clean_url)
        event_id = event_id_match.group(1) if event_id_match else None

        # Date and location are siblings in the parent section
        section = link.find_parent("section") or link.find_parent("div")
        date_text = ""
        location_text = ""

        if section:
            paragraphs = section.find_all("p")
            for p in paragraphs:
                text = p.get_text(strip=True)
                if re.search(r"(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Today|Tomorrow|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)", text):
                    date_text = text
                elif "·" in text:
                    location_text = text

        events.append({
            "id": event_id,
            "title": title,
            "date": date_text,
            "location": location_text,
            "url": clean_url,
        })

    return soup, events


def scrape_all_events():
    all_events = []
    session = requests.Session()
    session.headers.update(HEADERS)

    print("Warming up session...")
    try:
        session.get("https://www.eventbrite.ca/", timeout=15)
        time.sleep(1)
    except Exception:
        pass

    print("Loading page 1...")
    html = fetch_page(session, BASE_URL)
    soup, events = parse_events(html)
    total_pages = get_total_pages(soup)
    print(f"  Total pages: {total_pages} | Events found: {len(events)}")
    all_events.extend(events)

    for page_num in range(2, total_pages + 1):
        time.sleep(2)
        url = f"{BASE_URL}?page={page_num}"
        print(f"Loading page {page_num}...")
        html = fetch_page(session, url)
        _, events = parse_events(html)
        print(f"  Events found: {len(events)}")
        all_events.extend(events)

    seen = set()
    unique = []
    for e in all_events:
        if e["url"] not in seen:
            seen.add(e["url"])
            unique.append(e)

    return unique


def main():
    print("=" * 60)
    print("Eventbrite Scraper — Toronto Dementia Events")
    print("=" * 60 + "\n")

    events = scrape_all_events()

    print(f"\n{'=' * 60}")
    print(f"TOTAL UNIQUE EVENTS: {len(events)}")
    print("=" * 60 + "\n")

    for i, e in enumerate(events, 1):
        print(f"[{i}] {e['title']}")
        if e["date"]:
            print(f"     Date    : {e['date']}")
        if e["location"]:
            print(f"     Location: {e['location']}")
        print(f"     URL     : {e['url']}")
        print()

    with open("events.json", "w", encoding="utf-8") as f:
        json.dump(events, f, indent=2, ensure_ascii=False)
    print("Saved to events.json")


if __name__ == "__main__":
    main()