import argparse
import requests
import json
import urllib.parse
# Note: While bs4 and scrapy are powerful tools for web scraping, 
# the openFDA provides a direct API that returns structured JSON data.
# Therefore, using the `requests` library to interact with the API 
# is the most efficient and robust way to get this information without needing to parse HTML.

def get_drug_label_info(drug_name):
    """
    Fetches drug label information from the openFDA API for a given drug name.
    It searches both brand (trade) names and generic names.
    
    Args:
        drug_name (str): The trade or generic name of the drug.
        
    Returns:
        dict: A full JSON dictionary of the label information, or None if not found/error.
    """
    # The base URL for the openFDA drug label API
    base_url = "https://api.fda.gov/drug/label.json"
    
    # We search both brand_name and generic_name
    # OpenFDA exact match API syntax requires quotes around the term if it has spaces
    search_term = f'"{drug_name.upper()}"'
    
    # Constructing the search query
    search_query = f'openfda.brand_name:{search_term} OR openfda.generic_name:{search_term}'
    
    # URL encode the query
    params = {
        'search': search_query,
        'limit': 1 # We fetch the first matched record
    }
    
    print(f"[*] Querying openFDA API for: {drug_name}")
    try:
        response = requests.get(base_url, params=params)
        response.raise_for_status() # Raise an exception for bad status codes
        
        data = response.json()
        
        if 'results' in data and len(data['results']) > 0:
            print(f"[+] Successfully retrieved label data for: {drug_name}")
            return data['results'][0]
        else:
            print(f"[-] No results found for: {drug_name}")
            return None
            
    except requests.exceptions.HTTPError as err:
        if response.status_code == 404:
             print(f"[-] No results found for: {drug_name} (404 Not Found)")
        else:
             print(f"[!] HTTP Error occurred: {err}")
        return None
    except Exception as e:
        print(f"[!] An error occurred: {e}")
        return None

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract drug label information from openFDA API.")
    parser.add_argument("drug_name", type=str, help="The trade or generic name of the drug (e.g., 'Tylenol' or 'Acetaminophen')")
    parser.add_argument("--output", "-o", type=str, help="Output JSON file path (optional)", default=None)
    
    args = parser.parse_args()
    
    drug_info = get_drug_label_info(args.drug_name)
    
    if drug_info:
        # If output file is specified, save it there
        if args.output:
            with open(args.output, 'w', encoding='utf-8') as f:
                json.dump(drug_info, f, indent=4)
            print(f"[+] Data saved to {args.output}")
        else:
            # Print a snippet of the result (first 500 characters) to verify it works without flooding the console
            json_str = json.dumps(drug_info, indent=4)
            print("\n--- Output JSON Snippet ---")
            print(json_str[:1500] + "\n... [Output Truncated] ...")
            print("---------------------------\n")
            print("To save the full JSON output to a file, use the --output flag.")
            print("Example: python fda_drug_label.py Tylenol --output tylenol.json")
