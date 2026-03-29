import requests
import time
import uuid

BASE_URL = "http://localhost:3000"
TIMEOUT = 30

def test_post_api_render_with_sufficient_points():
    user_email = "testuser_sufficient_points@example.com"
    headers = {"X-User-Email": user_email}
    user_endpoint = f"{BASE_URL}/api/user"
    render_endpoint = f"{BASE_URL}/api/render"
    
    # Step 1: Check user points
    response = requests.get(user_endpoint, headers=headers, params={"email": user_email}, timeout=TIMEOUT)
    assert response.status_code in (200, 201), f"Unexpected status getting user info: {response.status_code}"
    user_data = response.json()
    
    points = user_data.get("points", 0)
    # Assume cost is some fixed value or query render cost from elsewhere; for test we'll assume cost 10 points
    cost = 10
    if points < cost:
        raise AssertionError(f"Test user does not have sufficient points ({points} available, {cost} required)")

    # Prepare render request body
    user_prompt = "A high quality 3D render of a modern house"
    resolution = "1024x768"
    render_body = {
        "user_prompt": user_prompt,
        "resolution": resolution
    }

    # POST /api/render to submit render task
    render_response = requests.post(render_endpoint, headers=headers, json=render_body, timeout=TIMEOUT)
    assert render_response.status_code == 200, f"Render request failed with status {render_response.status_code}"
    render_data = render_response.json()
    assert "job_id" in render_data, "Response missing job_id"
    assert "signed_upload_url" in render_data, "Response missing signed_upload_url"
    job_id = render_data["job_id"]
    signed_upload_url = render_data["signed_upload_url"]
    
    # PUT to signed_upload_url with dummy image bytes (simulate upload)
    dummy_image_bytes = b"fake_image_data_for_testing"
    upload_response = requests.put(signed_upload_url, data=dummy_image_bytes, timeout=TIMEOUT)
    assert upload_response.status_code == 200, f"Image upload failed with status {upload_response.status_code}"

    # Simulate submission to Coze Workflow API happens on backend, poll for workflow completion using polling

    # GET /api/render/progress or equivalent endpoint is not described,
    # PRD says GET progress_url (SSE or polling) exposed by proxy/Coze,
    # but no explicit progress_url given in response. Assume we can poll some endpoint for job result:
    # For exercise, simulate polling /api/render/status/{job_id} or /api/render/result/{job_id}
    # No endpoint given in PRD - fallback to GET /api/render/job_status/{job_id} (hypothetical)
    # Since not defined, assume GET /api/render/job_result?job_id=job_id 

    # We'll poll /api/render/job_result?job_id=job_id until final_image_url is received or timeout
    job_result_endpoint = f"{BASE_URL}/api/render/job_result"
    final_image_url = None
    max_poll_attempts = 20
    poll_interval = 3

    for attempt in range(max_poll_attempts):
        result_response = requests.get(job_result_endpoint, headers=headers, params={"job_id": job_id}, timeout=TIMEOUT)
        if result_response.status_code == 200:
            result_data = result_response.json()
            if "final_image_url" in result_data and result_data["final_image_url"]:
                final_image_url = result_data["final_image_url"]
                break
        time.sleep(poll_interval)

    assert final_image_url is not None, "Did not receive final_image_url after polling"

    # Validate final image URL is accessible (GET returns 200)
    final_image_response = requests.get(final_image_url, timeout=TIMEOUT)
    assert final_image_response.status_code == 200, f"Final image URL not accessible, status {final_image_response.status_code}"
    assert final_image_response.content, "Final image content is empty"

    # Verify points deduction: get user points again and check points decreased by at least cost
    post_points_response = requests.get(user_endpoint, headers=headers, params={"email": user_email}, timeout=TIMEOUT)
    assert post_points_response.status_code == 200, f"Failed to get user points after rendering, status {post_points_response.status_code}"
    post_user_data = post_points_response.json()
    post_points = post_user_data.get("points", 0)
    assert post_points <= points - cost, f"User points not properly deducted. Before: {points}, After: {post_points}"

test_post_api_render_with_sufficient_points()