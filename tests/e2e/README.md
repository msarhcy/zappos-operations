# E2E notes

These smoke tests intentionally do not fake authenticated success. They cover public/auth surfaces and verify protected routes redirect when no Supabase session exists.

Authenticated dashboard and operational page assertions require seeded Supabase credentials and company data. Add those as explicit test fixtures before testing authenticated workflows.
