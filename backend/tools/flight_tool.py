import os
import re
from typing import Any

import airportsdata
import certifi
import pycountry
import requests
from dotenv import load_dotenv


load_dotenv()

# Use certifi's CA bundle for HTTPS requests.
os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

API_KEY = os.getenv("AVIATIONSTACK_API_KEY", "").strip()
DEFAULT_ORIGIN_IATA = os.getenv("DEFAULT_ORIGIN_IATA", "KTM").strip().upper()
BASE_URL = "https://api.aviationstack.com/v1/flights"

AIRPORTS = airportsdata.load("IATA")

# Keys in this dictionary must already be normalized with clean_text().
COUNTRY_ALIASES = {
    "usa": "US",
    "u s a": "US",
    "u s": "US",
    "america": "US",
    "united states": "US",
    "united states of america": "US",
    "uk": "GB",
    "u k": "GB",
    "britain": "GB",
    "great britain": "GB",
    "england": "GB",
    "uae": "AE",
    "united arab emirates": "AE",
    "dubai": "AE",  # Commonly used as a destination for DXB.
    "south korea": "KR",
    "korea": "KR",
    "russia": "RU",
    "vietnam": "VN",
    "bangladesh": "BD",
    "india": "IN",
    "japan": "JP",
    "china": "CN",
    "singapore": "SG",
    "malaysia": "MY",
    "thailand": "TH",
    "indonesia": "ID",
    "nepal": "NP",
    "qatar": "QA",
    "saudi arabia": "SA",
    "turkey": "TR",
    "canada": "CA",
    "australia": "AU",
    "germany": "DE",
    "france": "FR",
    "italy": "IT",
    "spain": "ES",
}

# Preferred airport used when the user supplies a country instead of a city.
COUNTRY_MAIN_AIRPORT = {
    "BD": "DAC",
    "IN": "DEL",
    "JP": "NRT",
    "US": "JFK",
    "GB": "LHR",
    "AE": "DXB",
    "SG": "SIN",
    "MY": "KUL",
    "TH": "BKK",
    "ID": "CGK",
    "CN": "PEK",
    "KR": "ICN",
    "NP": "KTM",
    "QA": "DOH",
    "SA": "JED",
    "TR": "IST",
    "CA": "YYZ",
    "AU": "SYD",
    "DE": "FRA",
    "FR": "CDG",
    "IT": "FCO",
    "ES": "MAD",
}

# Preferred airport for common city names. These are deliberate choices, not
# necessarily the only airport serving each city/region.
CITY_MAIN_AIRPORT = {
    "dhaka": "DAC",
    "delhi": "DEL",
    "new delhi": "DEL",
    "mumbai": "BOM",
    "kolkata": "CCU",
    "chennai": "MAA",
    "bangalore": "BLR",
    "bengaluru": "BLR",
    "tokyo": "NRT",
    "osaka": "KIX",
    "kyoto": "KIX",
    "kathmandu": "KTM",
    "pokhara": "PKR",
    "bhairahawa": "BWA",
    "new york": "JFK",
    "london": "LHR",
    "dubai": "DXB",
    "singapore": "SIN",
    "kuala lumpur": "KUL",
    "bangkok": "BKK",
    "doha": "DOH",
    "istanbul": "IST",
    "toronto": "YYZ",
    "sydney": "SYD",
    "paris": "CDG",
    "rome": "FCO",
    "madrid": "MAD",
    "frankfurt": "FRA",
}

STOP_WORDS = {
    "flight",
    "flights",
    "ticket",
    "tickets",
    "trip",
    "travel",
    "plan",
    "complete",
    "days",
    "day",
    "including",
    "hotel",
    "hotels",
    "sightseeing",
    "under",
    "budget",
    "info",
    "information",
    "please",
    "show",
    "find",
    "search",
    "get",
    "live",
    "status",
    "data",
}


def clean_text(text: str) -> str:
    """Lowercase text and normalize punctuation/whitespace."""
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    words = [word for word in text.split() if word not in STOP_WORDS]
    return " ".join(words).strip()


def country_name_to_code(text: str) -> str | None:
    """Resolve a country name or alias to its ISO alpha-2 code."""
    normalized = clean_text(text)
    if not normalized:
        return None

    if normalized in COUNTRY_ALIASES:
        return COUNTRY_ALIASES[normalized]

    try:
        return pycountry.countries.lookup(normalized).alpha_2
    except LookupError:
        pass

    # Allow a country name to be found within a longer location phrase.
    for country in pycountry.countries:
        name = clean_text(country.name)
        if name and re.search(rf"\b{re.escape(name)}\b", normalized):
            return country.alpha_2

    for alias, code in COUNTRY_ALIASES.items():
        if re.search(rf"\b{re.escape(alias)}\b", normalized):
            return code

    return None


def airport_country_matches(airport: dict[str, Any], country_code: str) -> bool:
    """Handle airport databases that store either a country name or code."""
    airport_country = str(airport.get("country", "")).strip()
    if not airport_country:
        return False

    if airport_country.upper() == country_code.upper():
        return True

    country = pycountry.countries.get(alpha_2=country_code.upper())
    if country and airport_country.casefold() in {
        country.name.casefold(),
        getattr(country, "official_name", "").casefold(),
        getattr(country, "common_name", "").casefold(),
    }:
        return True

    # Some datasets may use a different recognized country spelling.
    try:
        return (
            pycountry.countries.lookup(airport_country).alpha_2 == country_code.upper()
        )
    except LookupError:
        return False


def get_best_airport_for_country(country_code: str) -> str | None:
    """Return a configured preferred airport or a reasonable database match."""
    preferred = COUNTRY_MAIN_AIRPORT.get(country_code.upper())
    if preferred and preferred in AIRPORTS:
        return preferred

    candidates: list[tuple[int, str]] = []
    for iata, airport in AIRPORTS.items():
        if not iata or not airport_country_matches(airport, country_code):
            continue

        name = str(airport.get("name", "")).casefold()
        city = str(airport.get("city", "")).casefold()
        score = 0
        if "international" in name:
            score += 50
        if "intl" in name:
            score += 40
        if "capital" in name:
            score += 20
        if city:
            score += 5
        candidates.append((score, iata))

    if not candidates:
        return None

    candidates.sort(reverse=True)
    return candidates[0][1]


def resolve_location_to_iata(location: str | None) -> str | None:
    """Resolve an IATA code, city, or country to an airport IATA code."""
    if not location or not location.strip():
        return None

    raw_location = location.strip()

    # Accept a direct IATA code only if it exists in the airport database.
    if re.fullmatch(r"[A-Za-z]{3}", raw_location):
        code = raw_location.upper()
        if code in AIRPORTS:
            return code

    location_clean = clean_text(raw_location)
    if not location_clean:
        return None

    if location_clean in CITY_MAIN_AIRPORT:
        code = CITY_MAIN_AIRPORT[location_clean]
        return code if code in AIRPORTS else None

    country_code = country_name_to_code(location_clean)
    if country_code:
        airport = get_best_airport_for_country(country_code)
        if airport:
            return airport

    # Search the airport database for city/name matches.
    city_matches: list[tuple[int, str]] = []
    for iata, airport in AIRPORTS.items():
        city = clean_text(str(airport.get("city", "")))
        name = clean_text(str(airport.get("name", "")))
        score = 0

        if city == location_clean:
            score += 100
        elif city and location_clean in city:
            score += 70

        if name and location_clean in name:
            score += 50
        if "international" in name:
            score += 10

        if score > 0:
            city_matches.append((score, iata))

    if city_matches:
        city_matches.sort(reverse=True)
        return city_matches[0][1]

    return None


def find_location_mentions(query: str) -> list[tuple[str, int, int]]:
    """Find known country/city names in query order, preferring longer matches.

    Returns (matched_text, start_position, end_position) tuples.
    """
    candidates: list[tuple[str, int, int]] = []
    names = set(COUNTRY_ALIASES) | set(CITY_MAIN_AIRPORT)
    names.update(clean_text(country.name) for country in pycountry.countries)

    for name in names:
        if not name or len(name) < 2:
            continue
        pattern = rf"\b{re.escape(name)}\b"
        for match in re.finditer(pattern, query.casefold()):
            candidates.append((name, match.start(), match.end()))

    # Keep the longest non-overlapping match at each position, then restore
    # the order in which locations appeared in the user's query.
    candidates.sort(key=lambda item: (item[1], -(item[2] - item[1])))
    selected: list[tuple[str, int, int]] = []
    for candidate in candidates:
        _, start, end = candidate
        if any(
            start < chosen_end and end > chosen_start
            for _, chosen_start, chosen_end in selected
        ):
            continue
        selected.append(candidate)

    return sorted(selected, key=lambda item: item[1])


def _trim_location_phrase(value: str) -> str:
    """Remove common trailing query modifiers from a captured location."""
    value = value.strip(" \t\n,.;:!?-")
    value = re.split(
        r"\b(?:on|for|under|including|with|during|after|before|and show|please show)\b",
        value,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    return value.strip(" \t\n,.;:!?-")


def parse_route(query: str) -> tuple[str | None, str | None]:
    """Parse a natural-language query into (departure IATA, arrival IATA).

    A destination-only query uses DEFAULT_ORIGIN_IATA. An origin-only query
    returns (origin, None). Global queries return (None, None).
    """
    q = query.strip()
    if not q:
        return DEFAULT_ORIGIN_IATA, None

    q_lower = q.casefold()
    global_keywords = (
        "all country",
        "all countries",
        "global flight",
        "global flights",
        "all flight",
        "all flights",
        "worldwide flight",
        "worldwide flights",
    )
    if any(keyword in q_lower for keyword in global_keywords):
        return None, None

    # Explicit IATA route: KTM to NRT, or KTM -> NRT.
    code_route = re.search(
        r"\b([A-Za-z]{3})\s*(?:to|->|→)\s*([A-Za-z]{3})\b",
        q,
        flags=re.IGNORECASE,
    )
    if code_route:
        dep = resolve_location_to_iata(code_route.group(1))
        arr = resolve_location_to_iata(code_route.group(2))
        if dep and arr:
            return dep, arr

    # Natural-language route: from X to Y.
    match = re.search(
        r"\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+\b(?:on|for|under|including|with|during)\b|[.!?]|$)",
        q,
        flags=re.IGNORECASE,
    )
    if match:
        origin_text = _trim_location_phrase(match.group(1))
        dest_text = _trim_location_phrase(match.group(2))
        dep = resolve_location_to_iata(origin_text)
        arr = resolve_location_to_iata(dest_text)
        if dep or arr:
            return dep, arr

    # Natural-language route: to Y from X.
    match = re.search(
        r"\bto\s+(.+?)\s+from\s+(.+?)(?=\s+\b(?:on|for|under|including|with|during)\b|[.!?]|$)",
        q,
        flags=re.IGNORECASE,
    )
    if match:
        dest_text = _trim_location_phrase(match.group(1))
        origin_text = _trim_location_phrase(match.group(2))
        dep = resolve_location_to_iata(origin_text)
        arr = resolve_location_to_iata(dest_text)
        if dep or arr:
            return dep, arr

    mentions = find_location_mentions(q)

    # If the query says "from X" and mentions another destination elsewhere,
    # use X as the origin and the other location as the destination. This also
    # handles phrasing such as "Plan a Japan trip from Bangladesh".
    from_match = re.search(r"\bfrom\s+(.+?)(?=[.!?]|$)", q, flags=re.IGNORECASE)
    if from_match:
        origin_text = _trim_location_phrase(from_match.group(1))
        dep = resolve_location_to_iata(origin_text)
        origin_mentions = find_location_mentions(origin_text)
        origin_names = {item[0] for item in origin_mentions}
        other_mentions = [item for item in mentions if item[0] not in origin_names]
        if other_mentions:
            # Use the first location outside the origin phrase as destination.
            arr = resolve_location_to_iata(other_mentions[0][0])
            if dep or arr:
                return dep, arr
        if dep:
            return dep, None

    # If a query mentions two places without explicit route wording, preserve
    # their text order as origin then destination.
    if len(mentions) >= 2:
        first = resolve_location_to_iata(mentions[0][0])
        second = resolve_location_to_iata(mentions[1][0])
        if first or second:
            return first, second

    # Explicit destination-only query: use the configured default origin.
    to_match = re.search(r"\bto\s+(.+?)(?=[.!?]|$)", q, flags=re.IGNORECASE)
    if to_match:
        destination_text = _trim_location_phrase(to_match.group(1))
        arr = resolve_location_to_iata(destination_text)
        return (DEFAULT_ORIGIN_IATA if arr else None), arr

    # One recognized location without route wording is treated as destination.
    if len(mentions) == 1:
        arr = resolve_location_to_iata(mentions[0][0])
        return (DEFAULT_ORIGIN_IATA if arr else None), arr

    return None, None


def format_flight(flight: dict[str, Any]) -> str:
    """Format one AviationStack flight object for display."""
    airline = (flight.get("airline") or {}).get("name") or "Unknown airline"
    flight_number = (flight.get("flight") or {}).get("iata") or "Unknown flight number"
    status = flight.get("flight_status") or "Unknown"
    dep = flight.get("departure") or {}
    arr = flight.get("arrival") or {}

    dep_delay = dep.get("delay")
    arr_delay = arr.get("delay")
    dep_delay_text = f"{dep_delay} minutes" if dep_delay is not None else "N/A"
    arr_delay_text = f"{arr_delay} minutes" if arr_delay is not None else "N/A"

    return f"""Airline: {airline}
Flight: {flight_number}
Status: {status}

Departure:
- Airport: {dep.get("airport") or "Unknown departure airport"}
- IATA: {dep.get("iata") or "Unknown"}
- Terminal: {dep.get("terminal") or "N/A"}
- Gate: {dep.get("gate") or "N/A"}
- Scheduled: {dep.get("scheduled") or "Unknown"}
- Delay: {dep_delay_text}

Arrival:
- Airport: {arr.get("airport") or "Unknown arrival airport"}
- IATA: {arr.get("iata") or "Unknown"}
- Terminal: {arr.get("terminal") or "N/A"}
- Gate: {arr.get("gate") or "N/A"}
- Scheduled: {arr.get("scheduled") or "Unknown"}
- Delay: {arr_delay_text}"""


def search_flights(query: str, limit: int = 10) -> str:
    """Fetch flight-status data for the route inferred from query."""
    if not API_KEY:
        return (
            "Flight API error: AVIATIONSTACK_API_KEY is missing.\n"
            "Add it to your .env file, for example:\n"
            "AVIATIONSTACK_API_KEY=your_api_key_here"
        )

    if not isinstance(limit, int) or limit < 1:
        return "Invalid limit: provide a positive integer."

    if DEFAULT_ORIGIN_IATA not in AIRPORTS:
        return (
            f"Invalid DEFAULT_ORIGIN_IATA value: {DEFAULT_ORIGIN_IATA!r}. "
            "Set it to a valid IATA code, such as KTM."
        )

    dep_iata, arr_iata = parse_route(query)
    params: dict[str, Any] = {
        "access_key": API_KEY,
        "limit": min(limit, 100),
    }
    if dep_iata:
        params["dep_iata"] = dep_iata
    if arr_iata:
        params["arr_iata"] = arr_iata

    try:
        response = requests.get(BASE_URL, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.Timeout:
        return "Flight API request timed out. Please try again."
    except requests.exceptions.HTTPError as exc:
        return f"Flight API HTTP error: {exc}"
    except requests.exceptions.RequestException as exc:
        return f"Flight API request failed: {exc}"
    except ValueError:
        return "Flight API returned invalid JSON."

    if not isinstance(data, dict):
        return "Flight API returned an unexpected response format."

    if data.get("error"):
        error = data["error"]
        if isinstance(error, dict):
            return (
                "Flight API error:\n"
                f"Code: {error.get('code', 'Unknown')}\n"
                f"Message: {error.get('message', 'Unknown error')}"
            )
        return f"Flight API error: {error}"

    flight_data = data.get("data", [])
    if not isinstance(flight_data, list):
        return "Flight API returned an unexpected flight-data format."

    if not flight_data:
        if dep_iata and arr_iata:
            route_text = f" for route {dep_iata} to {arr_iata}"
        elif dep_iata:
            route_text = f" from {dep_iata}"
        elif arr_iata:
            route_text = f" to {arr_iata}"
        else:
            route_text = ""
        return (
            f"No live flight data found{route_text}.\n\n"
            "AviationStack provides flight status information, not ticket prices. "
            "Availability depends on the API plan and current data coverage."
        )

    if dep_iata and arr_iata:
        route_info = f"Live flights from {dep_iata} to {arr_iata}"
    elif dep_iata:
        route_info = f"Live flights from {dep_iata}"
    elif arr_iata:
        route_info = f"Live flights to {arr_iata}"
    else:
        route_info = "Live flights (unfiltered API results; not necessarily every worldwide flight)"

    valid_flights = [item for item in flight_data if isinstance(item, dict)]
    if not valid_flights:
        return "Flight API returned no valid flight records."

    formatted_flights = [format_flight(flight) for flight in valid_flights[:limit]]
    return f"{route_info}\n\n" + "\n\n---\n\n".join(formatted_flights)


if __name__ == "__main__":
    test_queries = [
        "Plan a 7 days Japan trip from Bangladesh",
        "flights from Nepal to Japan",
        "flights to Japan from Nepal",
        "flights from Nepal",
        "flights to Japan",
        "KTM to NRT",
        "all country flight info",
    ]

    for test_query in test_queries:
        print(f"\nQuery: {test_query}")
        print(f"Parsed route: {parse_route(test_query)}")
