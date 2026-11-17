#!/opt/homebrew/bin/python3
"""Citation health: look up every DOI in a .bib for retractions, expressions of concern and corrections.

Adapted from Lattice's src-tauri/src/citation_health.rs
(https://github.com/leo1oel/lattice, Apache-2.0). DOIs come from `doi` fields,
doi.org URLs, and arXiv identifiers (arXiv's DataCite DOI 10.48550/arXiv.<id>).
Crossref /works/{doi} supplies `updated-by` (Retraction Watch and publisher
notices), `update-to` (the cited DOI is itself a notice) and `relation`;
DataCite /dois/{doi} covers Zenodo, arXiv and other DataCite DOIs. Only DOIs
are sent; the User-Agent carries no contact address. Responses are cached
under CACHE (default build/cite-cache) for 24 hours.

Exit 0 = nothing retracted or under an expression of concern (corrections and
unknown DOIs are warnings), 1 = a cited work is retracted or under concern,
or with --strict any warning, 2 = usage error.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "paper-cite-health/1.0"
CROSSREF = "https://api.crossref.org/works/"
DATACITE = "https://api.datacite.org/dois/"
DATACITE_PREFIXES = ("10.5281/", "10.48550/")
CACHE_TTL = 24 * 60 * 60
TIMEOUT = 20

ENTRY = re.compile(r"@(\w+)\s*[{(]\s*([^,\s]+)\s*,")
DOI_FIELD = re.compile(r"\bdoi\s*=\s*[{\"]\s*([^}\"]+?)\s*[}\"]", re.IGNORECASE)
DOI_URL = re.compile(r"doi\.org/(10\.\d{4,9}/[^\s}\"]+)", re.IGNORECASE)
ARXIV_ID = re.compile(r"(?:arxiv[:\s/]*|arxiv\.org/(?:abs|pdf)/)(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?", re.IGNORECASE)

SEVERITY = {"retracted": 4, "expression of concern": 3, "corrected": 2, "replaced": 2}


def classify(update_type):
    kind = (update_type or "").lower().replace("-", "_").replace(" ", "_")
    if kind in ("retraction", "partial_retraction", "withdrawal", "removal"):
        return "retracted"
    if kind == "expression_of_concern":
        return "expression of concern"
    if kind in ("correction", "corrigendum", "erratum", "addendum", "clarification"):
        return "corrected"
    if kind in ("new_version", "new_edition", "replacement", "reinstatement"):
        return "replaced"
    return None


# ---------------------------------------------------------------- bib

def normalize_doi(doi):
    doi = doi.strip().replace("\\_", "_").replace("{", "").replace("}", "")
    doi = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", doi, flags=re.IGNORECASE)
    return doi.rstrip(".,;").lower()


def bib_entries(text):
    """[(key, body)] for each entry."""
    matches = list(ENTRY.finditer(text))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        if match.group(1).lower() not in ("comment", "string", "preamble"):
            yield match.group(2), text[match.end():end]


def dois_in(body):
    found = [normalize_doi(d) for d in DOI_FIELD.findall(body)]
    found += [normalize_doi(d) for d in DOI_URL.findall(body)]
    found += ["10.48550/arxiv." + a.lower() for a in ARXIV_ID.findall(body)]
    return list(dict.fromkeys(found))


def collect(bib_paths):
    """{doi: [entry keys]}"""
    cited = {}
    for path in bib_paths:
        with open(path, encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        for key, body in bib_entries(text):
            for doi in dois_in(body):
                cited.setdefault(doi, []).append(key)
    return cited


# ---------------------------------------------------------------- fetch

class Fetcher:
    def __init__(self, cache_dir, offline):
        self.cache_dir = cache_dir
        self.offline = offline
        self.network = 0
        os.makedirs(cache_dir, exist_ok=True)

    def cache_path(self, url):
        return os.path.join(self.cache_dir, hashlib.sha256(url.encode()).hexdigest()[:32] + ".json")

    def read_cache(self, url):
        try:
            with open(self.cache_path(url), encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return None

    def request(self, url):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        self.network += 1
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                return {"status": response.status, "body": json.loads(response.read().decode("utf-8"))}
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return {"status": 404, "body": None}
            raise

    def get(self, url):
        """(status, body, stale) or (None, None, None) when unavailable."""
        cached = self.read_cache(url)
        if cached and (self.offline or time.time() - cached["fetched_at"] < CACHE_TTL):
            return cached["status"], cached["body"], False
        if self.offline:
            return None, None, None
        try:
            result = self.request(url)
        except (urllib.error.URLError, OSError, ValueError):
            if cached:
                return cached["status"], cached["body"], True
            return None, None, None
        result.update(url=url, fetched_at=time.time())
        with open(self.cache_path(url), "w", encoding="utf-8") as handle:
            json.dump(result, handle)
        time.sleep(0.2)
        return result["status"], result["body"], False


# ---------------------------------------------------------------- verdicts

def crossref_notices(message, doi):
    """[(kind, description)] from one Crossref work record."""
    notices = []
    for update in message.get("updated-by") or []:
        kind = classify(update.get("type"))
        if kind:
            date = (update.get("updated") or {}).get("date-time", "")[:10]
            notices.append((kind, f"{update.get('type')} {update.get('DOI', '')} {date} ({update.get('source', 'crossref')})".strip()))
    for update in message.get("update-to") or []:
        if (update.get("DOI") or "").lower() != doi:
            notices.append(("notice", f"the cited DOI is itself a {update.get('type')} notice for {update.get('DOI')}"))
    for relation, targets in (message.get("relation") or {}).items():
        kind = "retracted" if "retract" in relation else "expression of concern" if "concern" in relation else None
        if kind:
            ids = ", ".join(t.get("id", "") for t in targets)
            notices.append((kind, f"relation {relation}: {ids}"))
    return notices


def datacite_notices(attributes):
    notices = []
    if attributes.get("state") not in (None, "findable"):
        notices.append(("notice", f"DataCite state is {attributes.get('state')}"))
    for related in attributes.get("relatedIdentifiers") or []:
        if related.get("relationType") == "IsObsoletedBy":
            notices.append(("replaced", f"IsObsoletedBy {related.get('relatedIdentifier')}"))
    return notices


def lookup(fetcher, doi):
    """(registry or None, notices, stale, unavailable)"""
    order = ["datacite", "crossref"] if doi.startswith(DATACITE_PREFIXES) else ["crossref", "datacite"]
    unavailable = False
    for registry in order:
        base = DATACITE if registry == "datacite" else CROSSREF
        status, body, stale = fetcher.get(base + urllib.parse.quote(doi, safe="/"))
        if status is None:
            unavailable = True
            continue
        if status != 200 or not body:
            continue
        if registry == "crossref":
            return registry, crossref_notices(body.get("message") or {}, doi), stale, False
        return registry, datacite_notices((body.get("data") or {}).get("attributes") or {}), stale, False
    return None, [], False, unavailable


def report_doi(doi, keys, result):
    """(failures, warnings) for one DOI, printing its lines."""
    registry, notices, stale, unavailable = result
    label = f"{doi} [{', '.join(keys)}]"
    if registry is None:
        print(f"WARN {label}: {'lookup unavailable (network)' if unavailable else 'neither Crossref nor DataCite knows this DOI'}")
        return 0, 1
    worst = max((SEVERITY.get(kind, 1) for kind, _ in notices), default=0)
    suffix = " (cached result, registry unreachable)" if stale else ""
    if worst >= 3:
        print(f"FAIL {label}: {registry}{suffix}")
    elif notices:
        print(f"WARN {label}: {registry}{suffix}")
    else:
        print(f"ok   {label}: {registry}, no notices{suffix}")
    for kind, description in notices:
        print(f"       {kind}: {description}")
    return (1, 0) if worst >= 3 else (0, 1 if notices or stale else 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("bib", nargs="+")
    parser.add_argument("--cache", default="build/cite-cache")
    parser.add_argument("--offline", action="store_true", help="use the cache only, whatever its age")
    parser.add_argument("--strict", action="store_true", help="fail on warnings too")
    args = parser.parse_args()
    cited = collect(args.bib)
    fetcher = Fetcher(args.cache, args.offline)
    failures = warnings = 0
    for doi in sorted(cited):
        fail, warn = report_doi(doi, cited[doi], lookup(fetcher, doi))
        failures += fail
        warnings += warn
    print(f"cite-health: {len(cited)} DOIs, {failures} retracted or under concern, {warnings} warnings, "
          f"{fetcher.network} network requests")
    return 1 if failures or (args.strict and warnings) else 0


if __name__ == "__main__":
    sys.exit(main())
