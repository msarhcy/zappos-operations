# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: public-auth.spec.ts >> public root redirects unauthenticated users to auth
- Location: tests/e2e/public-auth.spec.ts:25:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/
Call log:
  - navigating to "http://127.0.0.1:4173/", waiting until "load"

```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | 
  3   | async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  4   |   const hasOverflow = await page.evaluate(() => {
  5   |     const root = document.documentElement;
  6   |     return root.scrollWidth > root.clientWidth + 1;
  7   |   });
  8   |   expect(hasOverflow).toBe(false);
  9   | }
  10  | 
  11  | async function switchToSignUp(page: import("@playwright/test").Page) {
  12  |   const signUpTab = page.getByRole("tab", { name: /sign up/i });
  13  |   await expect(async () => {
  14  |     await signUpTab.click();
  15  |     await expect(signUpTab).toHaveAttribute("data-state", "active", { timeout: 1_000 });
  16  |   }).toPass();
  17  | }
  18  | 
  19  | const supabaseCorsHeaders = {
  20  |   "access-control-allow-origin": "*",
  21  |   "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  22  |   "access-control-allow-methods": "GET, POST, OPTIONS",
  23  | };
  24  | 
  25  | test("public root redirects unauthenticated users to auth", async ({ page }) => {
> 26  |   await page.goto("/");
      |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/
  27  |   await expect(page).toHaveURL(/\/auth$/);
  28  |   await expect(page.getByText("Welcome back")).toBeVisible();
  29  |   await expectNoHorizontalOverflow(page);
  30  | });
  31  | 
  32  | test("auth page exposes sign in and sign up forms", async ({ page }) => {
  33  |   await page.goto("/auth");
  34  |   await expect(page.getByText("Welcome back")).toBeVisible();
  35  |   await expect(page.getByLabel("Email")).toBeVisible();
  36  |   await expect(page.getByLabel("Password")).toBeVisible();
  37  | 
  38  |   await switchToSignUp(page);
  39  |   await expect(page.getByText("Create your account")).toBeVisible();
  40  |   await expect(page.getByLabel("Full name")).toBeVisible();
  41  |   await expectNoHorizontalOverflow(page);
  42  | });
  43  | 
  44  | test("signup requiring email confirmation shows a clear confirmation state", async ({ page }) => {
  45  |   const email = "new-user@example.com";
  46  | 
  47  |   await page.route("**/auth/v1/signup**", async (route) => {
  48  |     if (route.request().method() === "OPTIONS") {
  49  |       await route.fulfill({ status: 204, headers: supabaseCorsHeaders });
  50  |       return;
  51  |     }
  52  | 
  53  |     await route.fulfill({
  54  |       status: 200,
  55  |       headers: supabaseCorsHeaders,
  56  |       contentType: "application/json",
  57  |       body: JSON.stringify({
  58  |         id: "00000000-0000-4000-8000-000000000001",
  59  |         aud: "authenticated",
  60  |         role: "authenticated",
  61  |         email,
  62  |         email_confirmed_at: null,
  63  |         confirmation_sent_at: new Date().toISOString(),
  64  |         app_metadata: { provider: "email", providers: ["email"] },
  65  |         user_metadata: { full_name: "New User" },
  66  |         identities: [{ id: "identity-1", provider: "email", identity_data: { email } }],
  67  |       }),
  68  |     });
  69  |   });
  70  | 
  71  |   await page.goto("/auth");
  72  |   await switchToSignUp(page);
  73  |   await page.getByLabel("Full name").fill("New User");
  74  |   await page.getByLabel("Email").fill(email);
  75  |   await page.getByLabel("Password").fill("ValidPassword!123");
  76  |   await page.getByRole("button", { name: /create account/i }).click();
  77  | 
  78  |   await expect(page.getByText("Check your email")).toBeVisible();
  79  |   await expect(page.getByText(`We sent a confirmation link to ${email}.`)).toBeVisible();
  80  |   await expect(page.getByText(`Finish confirming ${email} before signing in.`)).toBeVisible();
  81  |   await page.getByRole("button", { name: /back to sign in/i }).click();
  82  |   await expect(page.getByText("Welcome back")).toBeVisible();
  83  |   await expect(page.getByLabel("Email")).toHaveValue(email);
  84  |   await expectNoHorizontalOverflow(page);
  85  | });
  86  | 
  87  | test("email confirmation callback errors do not look like wrong credentials", async ({ page }) => {
  88  |   await page.goto("/auth#error_description=Email%20not%20confirmed");
  89  |   await expect(
  90  |     page.getByText("Check your email to confirm your account before signing in.").first(),
  91  |   ).toBeVisible();
  92  |   await expect(page.getByText(/wrong credentials/i)).toHaveCount(0);
  93  |   await expectNoHorizontalOverflow(page);
  94  | });
  95  | 
  96  | test("forgot password page renders without authenticated state", async ({ page }) => {
  97  |   await page.goto("/forgot-password");
  98  |   await expect(page.getByText("Reset your password")).toBeVisible();
  99  |   await expect(page.getByRole("button", { name: /send reset link/i })).toBeVisible();
  100 |   await expectNoHorizontalOverflow(page);
  101 | });
  102 | 
```