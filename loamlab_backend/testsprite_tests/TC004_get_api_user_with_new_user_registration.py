import requests
import uuid

BASE_URL = "http://localhost:3000"
TIMEOUT = 30

def test_get_api_user_with_new_user_registration():
    new_email = f"testuser_{uuid.uuid4().hex}@example.com"
    headers = {
        "X-User-Email": new_email
    }
    params = {
        "email": new_email
    }

    response = None
    try:
        response = requests.get(f"{BASE_URL}/api/user", headers=headers, params=params, timeout=TIMEOUT)
        assert response.status_code in [200, 201], f"Expected status code 200 or 201, got {response.status_code}"
        data = response.json()
        assert "points" in data, "Response JSON missing 'points'"
        if "lifetime_points" in data:
            assert isinstance(data["lifetime_points"], int) and data["lifetime_points"] >= 0, "'lifetime_points' should be a non-negative integer if present"
        # referral_code and inviter_id might be optional or null, but should be present keys
        assert "referral_code" in data, "Response JSON missing 'referral_code'"
        assert "inviter_id" in data, "Response JSON missing 'inviter_id'"
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"
    finally:
        # Cleanup: attempt to delete the user to avoid polluting the database
        # Assuming an admin API DELETE /api/user?email= for cleanup, if not available then skip
        try:
            requests.delete(f"{BASE_URL}/api/user", params=params, timeout=TIMEOUT)
        except Exception:
            pass

test_get_api_user_with_new_user_registration()
