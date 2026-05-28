# LoamLab SPRINT Plan

## CONTEXT_DIGEST
- **OTP Length Mismatch**: Supabase now sends 8-digit OTP codes, but the UI is hardcoded with `maxlength="6"` and a 6-character placeholder, preventing users from entering the full code.
- **Google Login Redirect Failure**: When clicking "Continue with Google", the UI switches to the polling state but fails to open the external browser. This is caused by a JS exception in `app.js:startOAuthFlow` where `crypto.randomUUID` or `crypto.getRandomValues` throws an error if `window.crypto` is undefined in the SketchUp CEF environment, breaking the execution before `sketchup.open_browser` is called.

## TASKS

### 1. Update OTP Input Length [DONE]
- **影響檔案**: `loamlab_plugin/ui/index.html`, `loamlab_plugin/ui/app.js`
- **Description**: 
  - In `index.html`, update the `#login-code-input` element to allow 8 digits: change `maxlength="6"` to `maxlength="8"`, and update the placeholder to `--------`.
  - In `app.js`, review the OTP verification logic (`btn-verify-otp` click handler). If there is a strict length check (`token.length < 6`), consider updating it to match the 8-digit requirement (e.g., `< 6` is technically fine to allow 8, but updating it to `< 8` makes it strictly correct).

### 2. Fix Google Login Browser Redirect Exception [DONE]
- **影響檔案**: `loamlab_plugin/ui/app.js`
- **Description**: 
  - Fix the JS exception in `startOAuthFlow()` that prevents the external browser from opening.
  - The line `if (typeof crypto.randomUUID === 'function')` throws an error if `window.crypto` is undefined (common in older SketchUp CEF environments without HTTPS).
  - Update the fallback logic to safely check for `window.crypto` (e.g., `if (window.crypto && typeof window.crypto.randomUUID === 'function')`).
  - Provide a safe fallback UUID generator using `Math.random()` if `window.crypto` is completely unavailable, ensuring `sessionUuid` is always generated and `sketchup.open_browser(loginUrl)` is successfully called.

status: DONE
