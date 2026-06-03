# Offline Sync

UHP OPS installs as a PWA and supports offline capture for JSON API mutations.

## What Queues

The browser queues same-origin `/api/*` requests when all of these are true:

- Method is `POST`, `PUT`, `PATCH`, or `DELETE`
- Body is empty or a JSON/string body
- Request is not an auth route
- Request is not the live Morgan streaming chat route

Queued writes are stored in `localStorage` under `uhp-offline-mutation-queue-v1` and replayed when the browser returns online.

## What Does Not Queue

- File uploads and multipart form data
- Live Morgan chat/streaming requests
- Authentication requests
- Cross-origin calls

Those workflows should show a normal network error or require connectivity.

## User Behavior

When offline, the app shows a bottom-left banner with the number of saved updates. When the network returns, the app retries pending updates every 30 seconds and on the browser `online` event.

Failed replay attempts remain queued so the user does not lose work. Admin/developer tooling can inspect the browser `localStorage` key if a device needs recovery.
