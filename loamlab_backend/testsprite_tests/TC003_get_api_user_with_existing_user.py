import requests

BASE_URL = "http://localhost:3000"
TIMEOUT = 30

def test_get_api_user_with_existing_user():
    existing_email = "alice@example.com"
    headers = {
        "X-User-Email": existing_email
    }
    params = {
        "email": existing_email
    }

    try:
        response = requests.get(f"{BASE_URL}/api/user", headers=headers, params=params, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

    assert response.status_code == 200, f"Expected status code 200, got {response.status_code}"

    json_data = response.json()

    # Validate required fields presence and types
    assert "points" in json_data, "Response JSON missing 'points'"
    assert isinstance(json_data["points"], int), "'points' should be an integer"

    assert "lifetime_points" in json_data, "Response JSON missing 'lifetime_points'"
    assert isinstance(json_data["lifetime_points"], int), "'lifetime_points' should be an integer"

    assert "referral_code" in json_data, "Response JSON missing 'referral_code'"
    assert json_data["referral_code"] is None or isinstance(json_data["referral_code"], str), "'referral_code' should be string or null"

    assert "inviter_id" in json_data, "Response JSON missing 'inviter_id'"
    assert json_data["inviter_id"] is None or isinstance(json_data["inviter_id"], (str, int)), "'inviter_id' should be string, int or null"

test_get_api_user_with_existing_user()