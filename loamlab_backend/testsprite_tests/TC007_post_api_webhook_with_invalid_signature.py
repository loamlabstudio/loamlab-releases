import requests

BASE_URL = "http://localhost:3000"
WEBHOOK_PATH = "/api/webhook"
TIMEOUT = 30

def test_post_api_webhook_with_invalid_signature():
    url = f"{BASE_URL}{WEBHOOK_PATH}"
    # Example payload for a webhook event (structure based on typical payment events)
    payload = {
        "event_id": "evt_test_12345",
        "variant_id": 1,
        "user_email": "user@example.com",
        "amount": 1000,
        "currency": "USD",
        "event_type": "payment_succeeded"
    }
    # Intentionally invalid HMAC signature
    headers = {
        "Content-Type": "application/json",
        "X-Signature": "invalidsignature1234567890"
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

    assert response.status_code == 401, f"Expected status code 401, got {response.status_code}"
    json_resp = {}
    try:
        json_resp = response.json()
    except Exception:
        assert False, "Response is not valid JSON"

    # Validate error field and message
    assert "error" in json_resp, "Response JSON missing 'error' key"
    assert json_resp["error"] == "Invalid Signature", f"Expected error 'Invalid Signature', got '{json_resp['error']}'"

test_post_api_webhook_with_invalid_signature()
