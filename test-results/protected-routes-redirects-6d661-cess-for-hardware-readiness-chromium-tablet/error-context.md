# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: protected-routes.spec.ts >> redirects unauthenticated access for /hardware-readiness
- Location: tests/e2e/protected-routes.spec.ts:33:3

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/auth$/
Received string:  "http://127.0.0.1:4173/hardware-readiness"
Timeout: 10000ms

Call log:
  - Expect "toHaveURL" with timeout 10000ms
    22 × unexpected value "http://127.0.0.1:4173/hardware-readiness"

```

```yaml
- region "Notifications alt+T"
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | 
  3  | const protectedRoutes = [
  4  |   "/dashboard",
  5  |   "/command-centre",
  6  |   "/driver",
  7  |   "/vehicles",
  8  |   "/drivers",
  9  |   "/operations",
  10 |   "/operations-control",
  11 |   "/hardware-readiness",
  12 |   "/field-deployment",
  13 |   "/tracking",
  14 |   "/route-intelligence",
  15 |   "/brain",
  16 |   "/dispatch",
  17 |   "/documents",
  18 |   "/incidents",
  19 |   "/maintenance",
  20 |   "/notifications",
  21 |   "/customers",
  22 | ];
  23 | 
  24 | async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  25 |   const hasOverflow = await page.evaluate(() => {
  26 |     const root = document.documentElement;
  27 |     return root.scrollWidth > root.clientWidth + 1;
  28 |   });
  29 |   expect(hasOverflow).toBe(false);
  30 | }
  31 | 
  32 | for (const route of protectedRoutes) {
  33 |   test(`redirects unauthenticated access for ${route}`, async ({ page }) => {
  34 |     await page.goto(route);
> 35 |     await expect(page).toHaveURL(/\/auth$/);
     |                        ^ Error: expect(page).toHaveURL(expected) failed
  36 |     await expect(page.getByText("Welcome back")).toBeVisible();
  37 |     await expectNoHorizontalOverflow(page);
  38 |   });
  39 | }
  40 | 
```