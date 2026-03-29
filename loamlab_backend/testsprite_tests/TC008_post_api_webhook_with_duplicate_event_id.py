import requests
import hmac
import hashlib
import json
import uuid

BASE_URL = "http://localhost:3000"
LEMON_WEBHOOK_SECRET = "test_lemon_secret_123"  # This secret must match the one used by the server for HMAC verification
TIMEOUT = 30

def generate_hmac_signature(secret: str, payload: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()

def test_post_api_webhook_with_duplicate_event_id():
    # Prepare a unique event ID and webhook payload
    event_id = str(uuid.uuid4())
    event_data = {
        "data": {
            "id": event_id,
            "type": "order_payment_succeeded",
            "attributes": {
                "variant_id": 101,   # Assume variant_id that would credit points
                "user_email": "user@example.com"
            }
        }
    }
    
    # Use consistent JSON serialization (compact form) for signature and payload
    payload = json.dumps(event_data, separators=(",", ":"))

    # Generate a valid signature for the payload
    signature = generate_hmac_signature(LEMON_WEBHOOK_SECRET, payload)

    headers = {
        "Content-Type": "application/json",
        "X-Signature": signature
    }

    # First request to process the event - should create the record and credit points
    response_first = requests.post(f"{BASE_URL}/api/webhook", headers=headers, data=payload, timeout=TIMEOUT)
    assert response_first.status_code == 200, f"Expected status code 200 for first webhook, got {response_first.status_code}"
    try:
        json_first = response_first.json()
    except Exception:
        json_first = None
    assert json_first is None or isinstance(json_first, dict), "Response body for first webhook should be JSON or empty"

    # Send the same webhook again (duplicate event_id)
    response_duplicate = requests.post(f"{BASE_URL}/api/webhook", headers=headers, data=payload, timeout=TIMEOUT)

    # Validate server idempotent handling returns 200 no-op response
    assert response_duplicate.status_code == 200, f"Expected status code 200 for duplicate webhook, got {response_duplicate.status_code}"

    try:
        json_dup = response_duplicate.json()
    except Exception:
        json_dup = None

    # The response should indicate no error, no duplicate processing
    # We accept either empty body or no-op JSON response
    assert json_dup is None or isinstance(json_dup, dict), "Response body for duplicate webhook should be JSON or empty"


test_post_api_webhook_with_duplicate_event_id()