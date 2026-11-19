# Firestore Security Specification

## 1. Data Invariants
1. Every document in `/users/{userId}`, `/users/{userId}/private/{docId}`, `/letters/{letterId}`, `/voice_sessions/{sessionId}`, `/admins/{userId}`, and all `/workspace_*` collections requires a verified Firebase Auth user (`request.auth != null && request.auth.token.email_verified == true`).
2. Document IDs must match `^[a-zA-Z0-9_\-]+$` with length `1..128`.
3. `ownerUid` (or `uid`) on create must equal `request.auth.uid`, and cannot change on update.
4. `createdAt` and `updatedAt` must equal `request.time` on create; `createdAt` is immutable on update and `updatedAt == request.time`.
5. Non-admin users cannot self-assign `role: "admin"` on `/users/{userId}` create or elevate `role` on update.
6. PII (`email`) is isolated in `/users/{userId}/private/{docId}` readable only by the owner or verified admin.
7. `allow list` rules strictly enforce `resource.data.ownerUid == request.auth.uid` (or bootstrapped verified admin email) without `get()`/`exists()` lookups.
8. All institutional vault collections (`/workspace_meta`, `/workspace_users`, `/workspace_templates`, `/workspace_letters`, `/workspace_media`) are strictly admin-only (`isAdmin()` for `get`/`create`/`update`/`delete`, `isBootstrappedAdmin()` for `list`), completely blocking access to password hashes, site configs, and media from non-admins.

## 2. Dirty Dozen Adversarial Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read or write on `/letters/{letterId}` or `/workspace_users/{docId}`.
2. Unverified email user (`email_verified: false`) trying to write `/workspace_meta/config` even with matching admin email.
3. Identity spoofing: user A creating `/letters/{letterId}` with `ownerUid: "user-B"`.
4. Shadow field injection: creating `/workspace_users/{docId}` with an extra unknown key `isSuperAdmin: true`.
5. Privilege escalation: regular user creating `/users/{uid}` with `role: "admin"` or reading `/workspace_users/{docId}`.
6. Role update escalation: regular user updating `/users/{uid}` changing `role` from `"user"` to `"admin"`.
7. Timestamp spoofing: creating `/workspace_meta/config` with `createdAt` set in the past instead of `request.time`.
8. Immutable owner mutation: updating `/letters/{letterId}` to change `ownerUid`.
9. Resource poisoning: creating `/workspace_media/{invalidId}` with a 1.5KB junk document ID or oversized `base64Data` (> 950000 chars).
10. PII leak: user B reading `/users/{userA}/private/info`.
11. Unbounded list injection: creating `/workspace_meta/config` with `departments` exceeding 200 items or `voice_sessions` exceeding 50 turns.
12. Query trust bypass: non-admin user listing `/letters` or `/workspace_users` without authorization.
