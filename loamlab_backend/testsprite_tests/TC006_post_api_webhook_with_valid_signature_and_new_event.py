import requests
import hmac
import hashlib
import json
import time

import os
BASE_URL = "http://localhost:3000"
LEMON_WEBHOOK_SECRET = os.getenv("LEMON_WEBHOOK_SECRET", "test_lemon_secret_placeholder")  # 使用環境變數或預設展位符
TEST_USER_EMAIL = "testuser@example.com"
TIMEOUT = 30

def test_post_api_webhook_with_valid_signature_and_new_event():
    # Step 1: Get user points before webhook
    headers_user = {"X-User-Email": TEST_USER_EMAIL}
    params = {"email": TEST_USER_EMAIL}
    try:
        pre_resp = requests.get(f"{BASE_URL}/api/user", headers=headers_user, params=params, timeout=TIMEOUT)
        assert pre_resp.status_code in (200, 201), f"Failed to get user before webhook, status {pre_resp.status_code}"
        pre_data = pre_resp.json()
        pre_points = pre_data.get("points", 0)
    except Exception as e:
        raise AssertionError(f"Error fetching user before webhook: {e}")

    # Step 2: Construct new payment event payload with unique event id and variant_id
    timestamp = int(time.time() * 1000)
    event_id = f"evt_{timestamp}"
    variant_id = "variant_123"  # Example variant_id that maps to some points
    # We assume  variant_id "variant_123" credits 100 points (according to API logic)
    event_payload = {
        "id": event_id,
        "type": "payment_succeeded",
        "data": {
            "attributes": {
                "user_email": TEST_USER_EMAIL,
                "variant_id": variant_id,
                "transaction_id": f"txn_{timestamp}"
            }
        }
    }

    # Step 3: Compute HMAC SHA256 signature over JSON payload using LEMON_WEBHOOK_SECRET
    json_payload = json.dumps(event_payload)
    signature = hmac.new(
        key=LEMON_WEBHOOK_SECRET.encode("utf-8"),
        msg=json_payload.encode("utf-8"),
        digestmod=hashlib.sha256
    ).hexdigest()
    headers_webhook = {"X-Signature": signature, "Content-Type": "application/json"}

    # Step 4: POST the webhook event using json param to ensure proper Content-Type and encoding
    try:
        webhook_resp = requests.post(f"{BASE_URL}/api/webhook", headers=headers_webhook, json=event_payload, timeout=TIMEOUT)
    except Exception as e:
        raise AssertionError(f"Error posting webhook: {e}")

    # Step 5: Validate 200 response acknowledging processing
    assert webhook_resp.status_code == 200, f"Expected 200 status from webhook but got {webhook_resp.status_code}"

    # Step 6: Verify points credited to user based on variant_id
    try:
        post_resp = requests.get(f"{BASE_URL}/api/user", headers=headers_user, params=params, timeout=TIMEOUT)
        assert post_resp.status_code == 200, f"Expected 200 status from user endpoint after webhook, got {post_resp.status_code}"
        post_data = post_resp.json()
        post_points = post_data.get("points")
        # Points should increase compared to pre_points
        assert post_points is not None, "User points not found after webhook"
        assert post_points > pre_points, f"Points not increased after webhook, before: {pre_points}, after: {post_points}"
    except Exception as e:
        raise AssertionError(f"Error fetching user after webhook: {e}")

test_post_api_webhook_with_valid_signature_and_new_event()
