import requests

BASE_URL = "https://loamlab-camera-backend.vercel.app"
TIMEOUT = 15


def test_faq_new_user_credits_60():
    response = requests.get(BASE_URL, timeout=TIMEOUT)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"

    html = response.text

    # English: must mention 60 credits for new users
    assert "60 free signup bonus credits" in html, (
        "FAQ English text '60 free signup bonus credits' not found"
    )
    assert "3 renders at 2K" in html, (
        "FAQ English text '3 renders at 2K' not found"
    )

    # Traditional Chinese
    assert "60 點" in html and "3 張 2K" in html, (
        "FAQ Traditional Chinese '60 點' or '3 張 2K' not found"
    )

    # Simplified Chinese
    assert "60 点" in html and "3 张 2K" in html, (
        "FAQ Simplified Chinese '60 点' or '3 张 2K' not found"
    )


test_faq_new_user_credits_60()
