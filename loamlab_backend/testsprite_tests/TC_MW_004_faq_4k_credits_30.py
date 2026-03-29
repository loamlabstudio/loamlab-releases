import requests

BASE_URL = "https://loamlab-camera-backend.vercel.app"
TIMEOUT = 15


def test_faq_4k_credits_30():
    response = requests.get(BASE_URL, timeout=TIMEOUT)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"

    html = response.text

    # English
    assert "4K costs 30" in html, "FAQ English '4K costs 30' not found"

    # Traditional Chinese
    assert "4K 扣 30 點" in html, "FAQ Traditional Chinese '4K 扣 30 點' not found"

    # Simplified Chinese
    assert "4K 扣 30 点" in html, "FAQ Simplified Chinese '4K 扣 30 点' not found"

    # Confirm old wrong value (25) does not appear in credit context
    # Using a specific phrase that would indicate the wrong value
    assert "4K costs 25" not in html, "Old wrong value '4K costs 25' still present"
    assert "4K 扣 25" not in html, "Old wrong value '4K 扣 25' still present"


test_faq_4k_credits_30()
