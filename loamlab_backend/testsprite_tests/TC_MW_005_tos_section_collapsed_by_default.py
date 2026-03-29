import requests

BASE_URL = "https://loamlab-camera-backend.vercel.app"
TIMEOUT = 15


def test_tos_section_collapsed_by_default():
    response = requests.get(BASE_URL, timeout=TIMEOUT)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"

    html = response.text

    # terms-body div must exist
    assert 'id="terms-body"' in html, "Element id='terms-body' not found in HTML"

    # Must have max-height:0 as initial inline style (collapsed by default)
    # Search from id="terms-body" forward (not from onclick text which appears earlier)
    idx = html.index('id="terms-body"')
    snippet = html[max(0, idx - 10):idx + 150]
    assert "max-height:0" in snippet, (
        f"terms-body does not have max-height:0 (collapsed) initial state. snippet: {snippet!r}"
    )

    # toggleSection function must be present (accordion mechanism)
    assert "function toggleSection" in html, "toggleSection function not found in HTML"


test_tos_section_collapsed_by_default()
