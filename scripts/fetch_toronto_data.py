import requests
import pandas as pd
import os

BASE_URL = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/"

def search_package(query):
    """Search for datasets on Toronto Open Data portal."""
    url = f"{BASE_URL}package_search?q={query}"
    response = requests.get(url).json()
    if response["success"]:
        return response["result"]["results"]
    return []

def get_resource_list(package_id):
    """Get list of resources for a specific package."""
    url = f"{BASE_URL}package_show?id={package_id}"
    response = requests.get(url).json()
    if response["success"]:
        return response["result"]["resources"]
    return []

def download_resource(url, filename):
    """Download a resource file."""
    path = os.path.join("data", filename)
    print(f"Downloading to {path}...")
    response = requests.get(url)
    with open(path, "wb") as f:
        f.write(response.content)
    print("Done.")

if __name__ == "__main__":
    # Example: Search for traffic data
    query = "traffic"
    print(f"Searching for '{query}'...")
    packages = search_package(query)
    for p in packages:
        print(f"- {p['title']} (ID: {p['id']})")
    
    # Suggestion: Download first resource of the first package as a test
    if packages:
        pkg_id = packages[0]["id"]
        resources = get_resource_list(pkg_id)
        for r in resources:
            if r["format"].lower() in ["csv", "json"]:
                # download_resource(r["url"], f"{r['name']}.{r['format'].lower()}")
                print(f"Found {r['name']} ({r['format']}): {r['url']}")
                break
