import { test, expect } from '@playwright/test';

test.describe('Multi-group chat', () => {
  test('page loads with default group in sidebar', async ({ page }) => {
    await page.goto('/');
    // Sidebar should show at least "main" group
    await expect(page.locator('aside').getByRole('button', { name: 'main' })).toBeVisible();
    // Chat panel should be visible
    await expect(
      page.getByPlaceholder('Message your assistant'),
    ).toBeVisible();
  });

  test('create new group via New Chat button', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '+ New Chat' }).click();

    // Dialog should appear
    await expect(page.getByRole('heading', { name: 'New Chat' })).toBeVisible();

    // Enter a name and submit
    await page.getByLabel('Name').fill('Test Project');
    await page.getByRole('button', { name: 'Create' }).click();

    // New group should appear in sidebar (wait for the group to be created)
    await expect(page.locator('aside div[role="button"]', { hasText: 'Test Project' }).first()).toBeVisible({ timeout: 10000 });
  });

  test('switch between groups changes messages', async ({ page }) => {
    await page.goto('/');

    // Create a group first
    await page.getByRole('button', { name: '+ New Chat' }).click();
    await page.getByLabel('Name').fill('Switch Test');
    await page.getByRole('button', { name: 'Create' }).click();

    // Group button should be visible in sidebar (wait for creation)
    const switchTestButton = page.locator('aside div[role="button"]', { hasText: 'Switch Test' }).first();
    await expect(switchTestButton).toBeVisible({ timeout: 10000 });

    // Close dialog manually if it's still open (press Escape)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500); // Wait for dialog animation

    // Switch back to main
    await page.locator('aside div[role="button"]', { hasText: 'main' }).first().click();
    // Header should reflect main group
    await expect(page.locator('header')).toContainText('main');

    // Switch to new group
    await switchTestButton.click();
    await expect(page.locator('header')).toContainText('Switch Test');
  });

  test('send message in group', async ({ page }) => {
    await page.goto('/');

    const input = page.getByPlaceholder('Message your assistant');
    await input.fill('Hello from e2e test');
    await page.getByRole('button', { name: 'Send' }).click();

    // Message should appear in chat (in the message bubble) - use first() to get the most recent one
    await expect(page.locator('article').filter({ hasText: 'Hello from e2e test' }).first()).toBeVisible({ timeout: 10000 });
  });

  test('delete a non-main group', async ({ page }) => {
    await page.goto('/');

    // Create a group to delete
    await page.getByRole('button', { name: '+ New Chat' }).click();
    await page.getByLabel('Name').fill('Delete Me');
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for group to appear in sidebar (group created successfully)
    const groupButton = page.locator('aside div[role="button"]', { hasText: 'Delete Me' }).first();
    await expect(groupButton).toBeVisible({ timeout: 10000 });

    // Close dialog manually if it's still open (press Escape)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500); // Wait for dialog animation

    // Hover over the group to reveal delete button, then click it
    await groupButton.hover();
    await groupButton.locator('button[title="Delete group"]').click();

    // Group should disappear from sidebar
    await expect(groupButton).not.toBeVisible();
  });

  test('main group has no delete button', async ({ page }) => {
    await page.goto('/');

    // Hover over main group
    const mainButton = page.locator('aside').getByRole('button', { name: 'main' });
    await mainButton.hover();

    // No delete button should be present for main
    await expect(
      mainButton.locator('button[title="Delete group"]'),
    ).not.toBeVisible();
  });

  test('new group persists on reload', async ({ page }) => {
    await page.goto('/');

    // Create a group
    await page.getByRole('button', { name: '+ New Chat' }).click();
    await page.getByLabel('Name').fill('Persistent Group');
    await page.getByRole('button', { name: 'Create' }).click();

    // Group should appear in sidebar (wait for creation)
    await expect(page.locator('aside div[role="button"]', { hasText: 'Persistent Group' }).first()).toBeVisible({ timeout: 10000 });

    // Reload page
    await page.reload();

    // Group should still be in sidebar
    await expect(page.locator('aside div[role="button"]', { hasText: 'Persistent Group' }).first()).toBeVisible();
  });
});
