import { expect, test } from "@playwright/test";

const protectedRoutes = [
  "/dashboard",
  "/vehicles",
  "/drivers",
  "/operations",
  "/dispatch",
  "/documents",
];

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const hasOverflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth + 1;
  });
  expect(hasOverflow).toBe(false);
}

for (const route of protectedRoutes) {
  test(`redirects unauthenticated access for ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByText("Welcome back")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
