import requests
import hmac
import hashlib
import json
import time
import base64

import os
BASE_URL = "http://localhost:3000"
DODO_WEBHOOK_SECRET = os.getenv("DODO_WEBHOOK_SECRET", "whsec_YOUR_WEBHOOK_SECRET_PLACEHOLDER")  # 測試用 secret
TEST_USER_EMAIL = "test_dodo_user@example.com"
TIMEOUT = 30

def test_post_api_dodo_webhook_with_valid_signature():
    # 步驟 1: 獲取充值前的點數
    headers_user = {"X-User-Email": TEST_USER_EMAIL}
    params = {"email": TEST_USER_EMAIL}
    try:
        pre_resp = requests.get(f"{BASE_URL}/api/user", headers=headers_user, params=params, timeout=TIMEOUT)
        # 如果用戶不存在，預期會自動註冊 (TC004 邏輯)
        pre_points = pre_resp.json().get("points", 0) if pre_resp.status_code in (200, 201) else 0
    except Exception as e:
        pre_points = 0
        print(f"User might not exist yet: {e}")

    # 步驟 2: 構建 Dodo Webhook Payload
    timestamp = str(int(time.time()))
    msg_id = f"msg_{timestamp}"
    variant_id = "pdt_0NblmUvFrwJe36ymTELWV" # STARTER (300 pts)
    
    event_payload = {
        "type": "payment.succeeded",
        "data": {
            "payment_id": f"pay_{timestamp}",
            "customer": {
                "email": TEST_USER_EMAIL
            },
            "product_id": variant_id,
            "total_amount": 2400,
            "currency": "USD"
        }
    }
    
    payload_string = json.dumps(event_payload, separators=(',', ':'))
    
    # 步驟 3: 計算 Dodo 簽章 (Standard Webhooks format)
    # 簽署內容 = msgId.msgTimestamp.body
    signed_content = f"{msg_id}.{timestamp}.{payload_string}"
    
    # Secret 處理: 移除 whsec_ 前綴並進行 base64 解碼
    secret_key = base64.b64decode(DODO_WEBHOOK_SECRET.replace('whsec_', ''))
    
    signature = hmac.new(
        key=secret_key,
        msg=signed_content.encode("utf-8"),
        digestmod=hashlib.sha256
    ).digest()
    
    signature_b64 = base64.b64encode(signature).decode('utf-8')
    
    headers_webhook = {
        "webhook-id": msg_id,
        "webhook-timestamp": timestamp,
        "webhook-signature": f"v1,{signature_b64}",
        "Content-Type": "application/json"
    }

    # 步驟 4: 發送 Webhook
    try:
        webhook_resp = requests.post(
            f"{BASE_URL}/api/webhook", 
            headers=headers_webhook, 
            data=payload_string, 
            timeout=TIMEOUT
        )
    except Exception as e:
        raise AssertionError(f"Error posting Dodo webhook: {e}")

    assert webhook_resp.status_code == 200, f"Expected 200 status but got {webhook_resp.status_code}. Response: {webhook_resp.text}"

    # 步驟 5: 驗證點數是否增加
    try:
        post_resp = requests.get(f"{BASE_URL}/api/user", headers=headers_user, params=params, timeout=TIMEOUT)
        assert post_resp.status_code in (200, 201)
        post_points = post_resp.json().get("points", 0)
        
        # Starter 方案應增加 300 點
        assert post_points == pre_points + 300, f"Points mismatch. Before: {pre_points}, After: {post_points}, Expected gain: 300"
        print(f"✅ Dodo Webhook Verification Successful: {pre_points} -> {post_points}")
    except Exception as e:
        raise AssertionError(f"Error verifying points after webhook: {e}")

if __name__ == "__main__":
    test_post_api_dodo_webhook_with_valid_signature()
