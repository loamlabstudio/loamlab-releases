import requests

BASE_URL = "https://loamlab-camera-backend.vercel.app"
TIMEOUT = 15


def test_privacy_section_collapsed_by_default():
    response = requests.get(BASE_URL, timeout=TIMEOUT)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"

    html = response.text

    # privacy-body div must exist
    assert 'id="privacy-body"' in html, "Element id='privacy-body' not found in HTML"

    # Must have max-height:0 as initial inline style (collapsed by default)
    idx = html.index('id="privacy-body"')
    snippet = html[max(0, idx - 10):idx + 150]
    assert "max-height:0" in snippet, (
        f"privacy-body does not have max-height:0 (collapsed) initial state. snippet: {snippet!r}"
    )

    # privacy-icon must exist for the arrow rotation effect
    assert 'id="privacy-icon"' in html, "Element id='privacy-icon' not found in HTML"


test_privacy_section_collapsed_by_default()
