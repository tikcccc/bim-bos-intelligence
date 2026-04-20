<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/ffa5fe6d-26a5-4082-abc3-c1f479cf1bc4

## Architecture

The project now supports a split deployment model:

- Frontend: React/Vite app deployed to Firebase Hosting
- Backend: Express server deployed to an external host
- Firebase client services: Auth + Firestore remain in the frontend
- AI: Google API key remains server-side only

Frontend calls the backend through `VITE_API_BASE_URL`. If the variable is empty, the app falls back to same-origin `/api` for local integrated runs.

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Copy backend env values from [.env.backend.example](.env.backend.example)
3. Optional: copy frontend env values from [.env.frontend.example](.env.frontend.example)
4. Run the integrated app locally:
   `npm run dev`

## Frontend deploy to Firebase Hosting

1. Set `VITE_API_BASE_URL` to your external backend origin
2. Build the frontend:
   `npm run build`
3. Login to Firebase:
   `firebase login`
4. Initialize Hosting if needed:
   `firebase init hosting`
5. Deploy:
   `firebase deploy --only hosting`

The repo includes [firebase.json](firebase.json) configured for SPA hosting from `dist/`.

## Backend deploy externally

Deploy [server.ts](server.ts) and the [server](server) folder to any Node host.

Required backend env:

- `GEMINI_API_KEY`
- `CORS_ORIGIN`
- `EMAIL_PASSWORD` if you use IMAP/SMTP features
- `PORT` for the platform runtime

`CORS_ORIGIN` accepts a comma-separated allowlist, for example:

`https://your-project.web.app,https://your-project.firebaseapp.com`
