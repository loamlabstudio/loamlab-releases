import requests

BASE_URL = "https://loamlab-camera-backend.vercel.app"
TIMEOUT = 15
OLD_EMAIL = "support@loamlab.studio"
NEW_EMAIL = "loamlabstudio@gmail.com"
MIN_OCCURRENCES = 10


def test_marketing_page_email_correctness():
    response = requests.get(BASE_URL, timeout=TIMEOUT)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"

    html = response.text

    # Old placeholder email must NOT appear anywhere
    assert OLD_EMAIL not in html, (
        f"Old email '{OLD_EMAIL}' still found in marketing page HTML"
    )

    # New Gmail must appear at least MIN_OCCURRENCES times
    count = html.count(NEW_EMAIL)
    assert count >= MIN_OCCURRENCES, (
        f"Expected '{NEW_EMAIL}' to appear at least {MIN_OCCURRENCES} times, found {count}"
    )


test_marketing_page_email_correctness()
