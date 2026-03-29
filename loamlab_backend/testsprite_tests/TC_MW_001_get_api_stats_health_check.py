import requests

BASE_URL = "https://loamlab-camera-backend.vercel.app"
TIMEOUT = 15


def test_get_api_stats_health_check():
    response = requests.get(f"{BASE_URL}/api/stats", timeout=TIMEOUT)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"

    data = response.json()
    assert data.get("code") == 0, f"Expected code=0, got {data.get('code')}"

    hours_saved = data.get("hours_saved")
    assert hours_saved is not None, "Response missing 'hours_saved'"
    assert isinstance(hours_saved, (int, float)), "'hours_saved' must be numeric"
    assert hours_saved >= 0, f"hours_saved must be non-negative, got {hours_saved}"

    stats = data.get("stats")
    assert stats is not None, "Response missing 'stats' object"
    assert "total_users" in stats, "'stats.total_users' missing"
    assert isinstance(stats["total_users"], int), "'stats.total_users' must be int"
    assert stats["total_users"] >= 1, "'stats.total_users' must be at least 1 (system has active users)"

    assert "total_points_issued" in stats, "'stats.total_points_issued' missing"
    assert "timestamp" in stats, "'stats.timestamp' missing"


test_get_api_stats_health_check()
