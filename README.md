# EuSphere

EduSphere is a responsive educational platform with a React/Vite/TypeScript frontend and an Express/PostgreSQL backend.

## Requirements

- Node.js 20+
- PostgreSQL 15+
- npm 10+

## Installation

```bash
npm install
Copy-Item .env.example .env
```

Set strong values for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in `.env`.
For Google sign-in on the TypeScript API, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env`. For the documented `npm run dev:all` legacy API, set the same variables in `backend/.env`.

## Database setup

For a new database using the TypeScript server schema, create the database and user, then run its migrations:

```sql
CREATE USER edusphere WITH PASSWORD 'change-me';
CREATE DATABASE edusphere OWNER edusphere;
```

```bash
psql "$env:DATABASE_URL" -f server/db/migrations/001_initial.sql
psql "$env:DATABASE_URL" -f server/db/migrations/002_learning_ai.sql
psql "$env:DATABASE_URL" -f server/db/migrations/003_student_education_profiles.sql
psql "$env:DATABASE_URL" -f server/db/migrations/004_assessment_experience.sql
psql "$env:DATABASE_URL" -f server/db/migrations/005_admin_content_cms.sql
psql "$env:DATABASE_URL" -f server/db/migrations/006_teacher_verification.sql
psql "$env:DATABASE_URL" -f server/db/migrations/012_password_reset_codes.sql
psql "$env:DATABASE_URL" -f server/db/migrations/013_super_admin.sql
psql "$env:DATABASE_URL" -f server/db/migrations/014_admin_dashboard.sql
psql "$env:DATABASE_URL" -f server/db/migrations/015_google_auth_identities.sql
```

These migrations belong only to the TypeScript server schema. Never run them against the existing legacy `edusphere_db`.

The TypeScript migrations above are for a separate TypeScript-server database. The dashboard started by `npm run dev:all` uses the legacy API and its database; apply legacy migrations from `backend/migrations/` to that database instead. Never run the TypeScript migrations against the legacy `edusphere_db`.

## Running

```bash
npm run dev:all
```

- Frontend: `http://localhost:5173`
- Legacy API (for the existing `edusphere_db` schema): `http://localhost:5000`
- Health check: `http://localhost:5000/health`

`npm run dev:all` runs Vite and the legacy API for the existing `edusphere_db`. Keep `backend/.env` configured for that database. The separate TypeScript API can still be run with `npm run dev:server`, but it expects the TypeScript server schema.

The standalone admin dashboard requires `backend/migrations/012_admin_account.sql`, `backend/migrations/013_admin_cms.sql`, and `backend/migrations/014_admin_dashboard.sql` to be applied to the legacy database. The `server/db/migrations/014_admin_dashboard.sql` migration is only for the TypeScript server database and must not be run against `edusphere_db`.
Google OAuth requires registering `http://localhost:5173/api/auth/google/callback` as an authorized redirect URI in Google Cloud Console (or the exact URL set in `GOOGLE_REDIRECT_URI`). Apply `backend/migrations/016_google_auth_identities.sql` to the legacy database; the TypeScript API uses `server/db/migrations/015_google_auth_identities.sql`. Existing accounts with the same verified Google email are linked to their existing role, including administrator accounts.

## Production builds

```bash
npm run build:server
npm run build
```

## API overview

### Authentication

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/verify-email`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- `POST /api/auth/google/complete`

### Learning

- `GET /api/learning/subjects`
- `GET /api/learning/courses`
- `GET /api/learning/courses/:id`
- `POST /api/learning/courses/:id/enroll`
- `POST /api/learning/lessons/:id/progress`

### Student

- `PUT|DELETE /api/student/bookmarks/:lessonId`
- `PUT /api/student/notes/:lessonId`
- `POST /api/student/quizzes/:quizId/attempts`
- `POST /api/student/assignments/:assignmentId/submissions`
- `POST /api/student/exams/:examId/attempts`
- `GET /api/student/me/progress`
- `GET /api/student/me/notifications`
- `GET /api/student/me/achievements`
- `GET /api/student/me/certificates`

### Administration

- `GET /api/admin/overview`
- `GET /api/admin/taxonomy`
- `GET /api/admin/review`
- `GET /api/admin/teachers`
- `POST /api/admin/teachers`
- `PATCH /api/admin/teachers/:id/status`
- `PUT /api/admin/teachers/:id/permissions`
- `GET /api/admin/content/:type`
- `POST /api/admin/content/:type`
- `PATCH /api/admin/content/:type/:contentId`
- `PATCH /api/admin/content/:type/:contentId/status`
- `DELETE /api/admin/content/:type/:contentId`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id/status`
- `GET /api/admin/audit-logs` (Super Admin only)
- `GET|POST /api/admin/schools`
- `PATCH|DELETE /api/admin/schools/:id`
- `GET /api/admin/results`
- `GET /api/admin/activities`
- `GET /api/admin/notifications`
- `PATCH /api/admin/notifications/read`
- `GET|POST /api/admin/classes`
- `GET /api/messages`
- `POST /api/messages`
- `POST /api/messages/:conversationId/messages`
- `PATCH /api/messages/:conversationId/read`

Uploads are limited to JPEG, PNG, WebP, PDF, and MP4 files with a 10 MB limit at `POST /api/uploads`.

## Security

Passwords are hashed with bcrypt. Access tokens expire after 15 minutes. Refresh tokens are stored hashed in PostgreSQL and rotated on refresh. API requests use parameterized SQL, Zod validation, Helmet, strict CORS, rate limits, HttpOnly refresh cookies, role permissions, and centralized error responses.

Frontend role switches are for local development navigation only. Production authorization is enforced by backend middleware and database relationships.

## Deployment

1. Provision PostgreSQL and object storage.
2. Build the frontend with `VITE_API_URL` set to the public backend origin, without the `/api` suffix. For example, `https://api.example.com`.
3. Set these backend environment variables:
	- `NODE_ENV=production`
	- `PORT=5000` (or the port supplied by the hosting provider)
	- `DATABASE_URL=<private PostgreSQL connection string>`
	- `JWT_ACCESS_SECRET=<random value of at least 32 characters>`
	- `JWT_REFRESH_SECRET=<different random value of at least 32 characters>`
	- `CLIENT_ORIGIN=<public frontend URL>`
	- `COOKIE_SAME_SITE=none` when the frontend and backend use different sites over HTTPS
4. In Vercel, add `VITE_API_URL` under Project Settings > Environment Variables for Production, Preview, and Development as appropriate, then redeploy. Do not add backend secrets to Vercel frontend variables.
5. Run the migration with `psql` or your migration runner.
6. Build frontend and backend.
7. Serve `dist/` from a CDN/static host and run `npm run start:server` behind TLS.
8. Configure email delivery for verification/password-reset messages and an object-storage adapter for accepted uploads.
9. Add automated integration tests against an isolated PostgreSQL database before release.
# EduSphere

EduSphere is a responsive educational platform with a React/Vite/TypeScript frontend and an Express/PostgreSQL backend.

## Requirements

- Node.js 20+
- PostgreSQL 15+
- npm 10+

## Installation

```bash
npm install
Copy-Item .env.example .env
```

Set strong values for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in `.env`.
For password recovery emails, also set `RESEND_API_KEY` and `MAIL_FROM` to a verified sender address. Without `RESEND_API_KEY`, development logs the one-time code locally; production refuses to send reset requests until email delivery is configured.

## Database setup

Create the database and user, then run the migration:

```sql
CREATE USER edusphere WITH PASSWORD 'change-me';
CREATE DATABASE edusphere OWNER edusphere;
```

```bash
psql "$env:DATABASE_URL" -f server/db/migrations/001_initial.sql
psql "$env:DATABASE_URL" -f server/db/migrations/002_learning_ai.sql
psql "$env:DATABASE_URL" -f server/db/migrations/003_student_education_profiles.sql
psql "$env:DATABASE_URL" -f server/db/migrations/004_assessment_experience.sql
psql "$env:DATABASE_URL" -f server/db/migrations/005_admin_content_cms.sql
psql "$env:DATABASE_URL" -f server/db/migrations/006_teacher_verification.sql
psql "$env:DATABASE_URL" -f server/db/migrations/012_password_reset_codes.sql
psql "$env:DATABASE_URL" -f server/db/migrations/013_super_admin.sql
psql "$env:DATABASE_URL" -f server/db/migrations/014_admin_dashboard.sql
```

The `npm run dev:server` and `npm run start:server` scripts use the TypeScript API and migrations under `server/`. Apply only migrations that are missing from the target database, in order; `002_learning_ai.sql` depends on the initial schema. The `backend/` directory contains a separate legacy CommonJS API and schema—do not mix its migrations with the active server database.

## Running

```bash
npm run dev
npm run dev:server
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:5001`
- Health check: `http://localhost:5001/health`

## Legacy course-library backend

The separate CommonJS backend can use the additive migration at `backend/migrations/003_course_library.sql`. It creates education levels, grades, university faculties/departments/programs, subjects, courses, modules, structured lessons, notes, examples, exercises, quizzes, enrollments, progress, bookmarks, and recently viewed lessons without modifying existing users. These tables and APIs are distinct from the `server/` TypeScript API and must not be mixed with its migrations.

Teacher AI review state is stored by the additive migration `backend/migrations/004_teacher_drafts.sql`; generated drafts remain editable and unpublished until a teacher explicitly publishes them.

Apply it only when deploying the legacy `backend/server.js` service:

```powershell
Get-Content backend/migrations/003_course_library.sql | psql "$env:DATABASE_URL"
```

The active API exposes:

- `GET /api/learning/taxonomy`
- `GET /api/learning/courses?search=<term>&level=<id>&grade=<id>`
- `GET /api/learning/courses/:id`
- `GET /api/learning/search?q=<term>`
- `GET /api/learning/me/progress`
- `POST /api/learning/courses/:id/enroll`
- `POST /api/learning/lessons/:id/progress`
- `PUT /api/learning/lessons/:id/bookmark`
- `POST /api/learning/admin/subjects`
- `POST /api/learning/admin/courses`
- `POST /api/learning/admin/levels`
- `POST /api/learning/admin/grades`
- `POST /api/learning/admin/faculties`
- `POST /api/learning/admin/departments`
- `POST /api/learning/admin/programs`
- `POST /api/learning/courses/:id/modules`
- `POST /api/learning/modules/:id/lessons`
- `PATCH /api/learning/lessons/:id`
- `POST /api/learning/lessons/:id/notes`
- `POST /api/learning/lessons/:id/examples`
- `POST /api/learning/lessons/:id/exercises`
- `POST /api/learning/courses/:id/quizzes`
- `POST /api/learning/quizzes/:id/questions`
- `POST /api/learning/quizzes/:id/attempts`
- `PATCH /api/learning/courses/:id/status`

Teacher AI drafts:

- `POST /api/ai/generate`
- `GET /api/ai/drafts`
- `PATCH /api/ai/drafts/:id`
- `POST /api/ai/drafts/:id/publish`
## Production builds

```bash
npm run build:server
npm run build
```

## API overview

### Authentication

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/verify-email`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

### Learning

- `GET /api/learning/subjects`
- `GET /api/learning/courses`
- `GET /api/learning/courses/:id`
- `POST /api/learning/courses/:id/enroll`
- `POST /api/learning/lessons/:id/progress`
- `GET /api/learning/taxonomy`
- `GET /api/learning/search?q=<query>`

### Edusphere AI

- `POST /api/ai/chat` (authenticated students, teachers, and admins; private conversations are owner-scoped)
- `POST /api/ai/generate` (authenticated teachers/admins; stores editable draft content)

AI requests require the optional server-side `AI_API_KEY`. When it is absent or the provider fails, the API returns a friendly `503` response; no key is sent to the browser.

### Student

- `PUT|DELETE /api/student/bookmarks/:lessonId`
- `PUT /api/student/notes/:lessonId`
- `POST /api/student/quizzes/:quizId/attempts`
- `POST /api/student/assignments/:assignmentId/submissions`
- `POST /api/student/exams/:examId/attempts`
- `GET /api/student/me/progress`
- `GET /api/student/me/notifications`
- `GET /api/student/me/achievements`
- `GET /api/student/me/certificates`

### Administration

- `GET /api/admin/overview`
- `GET /api/admin/taxonomy`
- `GET /api/admin/review`
- `GET /api/admin/teachers`
- `POST /api/admin/teachers`
- `PATCH /api/admin/teachers/:id/status`
- `PUT /api/admin/teachers/:id/permissions`
- `GET /api/admin/content/:type`
- `POST /api/admin/content/:type`
- `PATCH /api/admin/content/:type/:contentId`
- `PATCH /api/admin/content/:type/:contentId/status`
- `DELETE /api/admin/content/:type/:contentId`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id/status`
- `GET /api/admin/audit-logs` (Super Admin only)
- `GET|POST /api/admin/schools`
- `PATCH|DELETE /api/admin/schools/:id`
- `GET /api/admin/results`
- `GET /api/admin/activities`
- `GET /api/admin/notifications`
- `PATCH /api/admin/notifications/read`
- `GET|POST /api/admin/classes`
- `GET /api/messages`
- `POST /api/messages`
- `POST /api/messages/:conversationId/messages`
- `PATCH /api/messages/:conversationId/read`

Uploads are limited to JPEG, PNG, WebP, PDF, and MP4 files with a 10 MB limit at `POST /api/uploads`.

## Security

Passwords are hashed with bcrypt. Access tokens expire after 15 minutes. Refresh tokens are stored hashed in PostgreSQL and rotated on refresh. API requests use parameterized SQL, Zod validation, Helmet, strict CORS, rate limits, HttpOnly refresh cookies, role permissions, and centralized error responses.

Frontend role switches are for local development navigation only. Production authorization is enforced by backend middleware and database relationships.

## Deployment

1. Provision PostgreSQL and object storage.
2. Build the frontend with `VITE_API_URL` set to the public backend origin, without the `/api` suffix. For example, `https://api.example.com`.
3. Set these backend environment variables:
	- `NODE_ENV=production`
	- `PORT=5000` (or the port supplied by the hosting provider)
	- `DATABASE_URL=<private PostgreSQL connection string>`
	- `JWT_ACCESS_SECRET=<random value of at least 32 characters>`
	- `JWT_REFRESH_SECRET=<different random value of at least 32 characters>`
	- `CLIENT_ORIGIN=<public frontend URL>`
	- `COOKIE_SAME_SITE=none` when the frontend and backend use different sites over HTTPS
4. In Vercel, add `VITE_API_URL` under Project Settings > Environment Variables for Production, Preview, and Development as appropriate, then redeploy. Do not add backend secrets to Vercel frontend variables.
5. Run the migration with `psql` or your migration runner.
6. Build frontend and backend.
7. Serve `dist/` from a CDN/static host and run `npm run start:server` behind TLS.
8. Configure email delivery for verification/password-reset messages and an object-storage adapter for accepted uploads.
9. Add automated integration tests against an isolated PostgreSQL database before release.
