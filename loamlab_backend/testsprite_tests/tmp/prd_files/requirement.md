# LoamLab Backend Requirement (PRD)

## Project Overview
This project is a serverless backend proxy for the LoamLab SketchUp rendering plugin. It bridges the SketchUp Ruby client with the Coze AI rendering engine, while managing user monetization and accounting.

## Core Services
1. **Rendering Proxy**:
   - Accepts image and prompt data from SketchUp.
   - Deducts points from the user's Supabase account according to resolution (1k, 2k, 4k).
   - Generates signed URLs for temporary storage of uploaded images.
   - Streams/Parses responses from Coze Workflow.

2. **Account Management**:
   - Tracks user energy points and lifetime points.
   - Handles automatic registration for new users.
   - Manages referral rewards (inviter/invited points).

3. **Versioning**:
   - Informs the plugin of new releases and download locations.

4. **Payment Webhook (LemonSqueezy)**:
   - Receives `order_created` and `subscription_payment_success` events.
   - Verifies `X-Signature` using `LEMON_WEBHOOK_SECRET`.
   - Distributes points based on `variant_id` (Starter/Pro/Studio/Topup).
   - Ensures idempotency using the `transactions` table.

## Frontend Requirements (UI/UX)
1. **Tool Dashboard**:
   - Renders a responsive header with language switcher and credits balance.
   - Displays a sidebar for tool selection (Render/Proxy/Composition).
   - Shows a "Sync Screen" button and a rendering progress bar.

2. **User Interaction**:
   - Clicking the "History" button opens a modal from the right.
   - Clicking the "Login" button triggers the Google Auth flow.
   - Clicking "Invite" opens a referral management modal.

## Security Requirements
- All user-specific requests must include `X-User-Email` in headers.
- Backend must verify point sufficiency before calling expensive AI APIs.
- Temporary storage files must be deleted after processing.

## Tech Stack
- Vercel (Deployment)
- Node.js (Runtime)
- Supabase (Database & Storage)
- Coze (AI Workflow)
