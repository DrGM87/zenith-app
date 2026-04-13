import argparse
import requests
import json

class ClinicalTrialsAPI:
    """
    How to use it:
    The script requires you to specify the -o (or --output) argument BEFORE you specify the command, so that it consistently knows where to dump the resulting JSON format.

    Example 1: Search for 10 trials dealing with the intervention "Aspirin" and Output to JSON

    python clinical_trials.py -o aspirin_trials.json search --intervention "Aspirin" --size 10
    Example 2: Search for trials by Condition instead (e.g. "Diabetes")

    python clinical_trials.py -o diabetes_trials.json search --condition "Diabetes" --status "RECRUITING"
    Example 3: Get exactly 1 specific study by its NCT ID
 
    python clinical_trials.py -o nct02008354_data.json get NCT02008354
    Note: Like the openFDA system, this ClinicalTrials JSON payload is deeply structured natively.

    A wrapper class for querying the ClinicalTrials.gov API v2.
    Base URL: https://clinicaltrials.gov/api/v2
    """
    BASE_URL = "https://clinicaltrials.gov/api/v2"

    def __init__(self):
        pass

    def _make_request(self, endpoint, params=None):
        url = f"{self.BASE_URL}/{endpoint}"
        try:
            print(f"[*] Requesting URL: {url} with params: {params}")
            response = requests.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.HTTPError as e:
            if response.status_code == 404:
                print("[-] Resource not found (404).")
            else:
                print(f"[!] HTTP Error: {e}")
            return None
        except Exception as e:
            print(f"[!] Request Error: {e}")
            return None

    def get_version(self):
        """
        Returns information about the API version and data timestamp.
        """
        return self._make_request("version")

    def get_study_by_id(self, nct_id):
        """
        Retrieves a specific study by its NCT ID (e.g., NCT00000105).
        """
        return self._make_request(f"studies/{nct_id}")

    def search_studies(self, term=None, condition=None, intervention=None, status=None, page_size=10):
        """
        Searches studies based on various queries.
        
        Args:
            term (str): General keyword search.
            condition (str): Medical condition search.
            intervention (str): Intervention/Treatment search.
            status (str): Filter by overall status (e.g., RECRUITING, COMPLETED).
            page_size (int): Number of results to return (max 1000).
        """
        params = {"pageSize": page_size}
        if term:
            params["query.term"] = term
        if condition:
            params["query.cond"] = condition
        if intervention:
            params["query.intr"] = intervention
        if status:
            params["filter.overallStatus"] = status

        return self._make_request("studies", params=params)

    def get_field_values(self, field_name):
        """
        Returns all values found in a specific API field (e.g., "overallStatus").
        """
        return self._make_request(f"stats/field/values", params={"field": field_name})


def save_to_json(data, filename):
    if data:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4)
        print(f"[+] Data successfully saved to {filename}")
    else:
        print("[-] No data to save.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ClinicalTrials.gov Data API v2 CLI")
    
    # Subparsers for different endpoint operations
    subparsers = parser.add_subparsers(dest="command", required=True, help="Available API commands")
    
    # 1. Version
    parser_version = subparsers.add_parser("version", help="Get API version and data timestamp")
    
    # 2. Get Single Study
    parser_get = subparsers.add_parser("get", help="Get a specific study by its NCT ID")
    parser_get.add_argument("nct_id", type=str, help="NCT Identifier (e.g., NCT02008354)")
    
    # 3. Search Studies
    parser_search = subparsers.add_parser("search", help="Search for studies")
    parser_search.add_argument("--term", type=str, help="General keyword search term")
    parser_search.add_argument("--condition", type=str, help="Medical condition")
    parser_search.add_argument("--intervention", type=str, help="Intervention/Treatment (e.g., drug name)")
    parser_search.add_argument("--status", type=str, help="Overall status (e.g., RECRUITING, COMPLETED)")
    parser_search.add_argument("--size", type=int, default=10, help="Number of results (pageSize)")
    
    # 4. Field Values
    parser_fields = subparsers.add_parser("fields", help="Get all unique values for a field")
    parser_fields.add_argument("field_name", type=str, help="Field name (e.g., overallStatus)")

    # Global argument for output
    parser.add_argument("-o", "--output", type=str, required=True, help="Output JSON filename (Required)")

    args = parser.parse_args()
    api = ClinicalTrialsAPI()
    result = None

    if args.command == "version":
        result = api.get_version()
    elif args.command == "get":
        result = api.get_study_by_id(args.nct_id)
    elif args.command == "search":
        result = api.search_studies(
            term=args.term,
            condition=args.condition,
            intervention=args.intervention,
            status=args.status,
            page_size=args.size
        )
    elif args.command == "fields":
        result = api.get_field_values(args.field_name)

    # Save output to JSON
    save_to_json(result, args.output)
