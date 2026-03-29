import requests

BASE_URL = "http://localhost:3000"
TIMEOUT = 30

def test_post_api_render_with_insufficient_points():
    # Email for a user expected to have insufficient points
    user_email = "user_with_insufficient_points@example.com"
    render_endpoint = f"{BASE_URL}/api/render"
    user_endpoint = f"{BASE_URL}/api/user"

    headers = {"X-User-Email": user_email}

    # Step 1: Verify user points are less than cost by getting user info
    try:
        user_resp = requests.get(user_endpoint, headers=headers, params={"email": user_email}, timeout=TIMEOUT)
        assert user_resp.status_code == 200, f"Expected 200 OK from /api/user but got {user_resp.status_code}"
        user_data = user_resp.json()
        points = user_data.get("points")
        assert points is not None, "User points missing in response"
        # We do not know the exact cost but we assume insufficient points means 0 or less than some positive cost.
        assert points < 1, "User does not have insufficient points for rendering"
    except requests.RequestException as e:
        assert False, f"Exception during user point check: {e}"

    # Step 2: Attempt to POST /api/render with user having insufficient points
    payload = {
        "user_prompt": "Test prompt with insufficient points",
        "resolution": "1920x1080"
    }

    try:
        render_resp = requests.post(render_endpoint, headers=headers, json=payload, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"POST /api/render request failed: {e}"

    # Step 3: Validate response is 402 with "insufficient_credits" error
    assert render_resp.status_code == 402, f"Expected status 402, got {render_resp.status_code}"
    try:
        resp_json = render_resp.json()
    except Exception:
        assert False, "Response is not valid JSON"

    error = resp_json.get("error")
    assert error == "insufficient_credits", f"Expected error 'insufficient_credits', got {error}"

test_post_api_render_with_insufficient_points()