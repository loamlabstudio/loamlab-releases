import requests

def test_get_api_user_missing_x_user_email_header():
    base_url = "http://localhost:3000"
    url = f"{base_url}/api/user"
    params = {"email": "missingheader@example.com"}
    try:
        response = requests.get(url, params=params, timeout=30)
        # Expecting a 400 error due to missing X-User-Email header
        assert response.status_code == 400, f"Expected status code 400 but got {response.status_code}"
        json_data = response.json()
        assert "error" in json_data, "Response JSON should contain 'error'"
        assert json_data["error"] == "missing_header", f"Expected error 'missing_header' but got '{json_data['error']}'"
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_get_api_user_missing_x_user_email_header()