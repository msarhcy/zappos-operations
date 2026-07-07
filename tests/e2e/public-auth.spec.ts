import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const hasOverflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth + 1;
  });
  expect(hasOverflow).toBe(false);
}

test("public root redirects unauthenticated users to auth", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByText("Welcome back")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("auth page exposes sign in and sign up forms", async ({ page }) => {
  await page.goto("/auth");
  await expect(page.getByText("Welcome back")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();

  const signUpTab = page.getByRole("tab", { name: /sign up/i });
  await expect(async () => {
    await signUpTab.click();
    await expect(signUpTab).toHaveAttribute("data-state", "active", { timeout: 1_000 });
  }).toPass();
  await expect(page.getByText("Create your account")).toBeVisible();
  await expect(page.getByLabel("Full name")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("forgot password page renders without authenticated state", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(page.getByText("Reset your password")).toBeVisible();
  await expect(page.getByRole("button", { name: /send reset link/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
