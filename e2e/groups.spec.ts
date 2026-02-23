import { test, expect } from '@playwright/test';

test.describe('Multi-group chat', () => {
  test('page loads with default group in sidebar', async ({ page }) => {
    await page.goto('/');
    // Sidebar should show at least "Main"
    await expect(page.getByText('Main')).toBeVisible();
    // Chat panel should be visible
    await expect(
      page.getByPlaceholder('Message your assistant'),
    ).toBeVisible();
  });

  test('create new group via New Chat button', async ({ page }) => {
    await page.goto('/');
    await page.getByText('+ New Chat').click();

    // Dialog should appear
    await expect(page.getByText('New Chat')).toBeVisible();

    // Enter a name and submit
    await page.getByLabel('Name').fill('Test Project');
    await page.getByRole('button', { name: 'Create' }).click();

    // New group should appear in sidebar
    await expect(page.getByText('Test Project')).toBeVisible();
  });

  test('switch between groups changes messages', async ({ page }) => {
    await page.goto('/');

    // Create a group first
    await page.getByText('+ New Chat').click();
    await page.getByLabel('Name').fill('Switch Test');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Switch Test')).toBeVisible();

    // Switch back to main
    await page.getByText('Main').click();
    // Header should reflect main group
    await expect(page.locator('header')).toContainText('Main');

    // Switch to new group
    await page.getByText('Switch Test').click();
    await expect(page.locator('header')).toContainText('Switch Test');
  });

  test('send message in group', async ({ page }) => {
    await page.goto('/');

    const input = page.getByPlaceholder('Message your assistant');
    await input.fill('Hello from e2e test');
    await page.getByRole('button', { name: 'Send' }).click();

    // Message should appear in chat
    await expect(page.getByText('Hello from e2e test')).toBeVisible();
  });

  test('delete a non-main group', async ({ page }) => {
    await page.goto('/');

    // Create a group to delete
    await page.getByText('+ New Chat').click();
    await page.getByLabel('Name').fill('Delete Me');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Delete Me')).toBeVisible();

    // Hover over the group to reveal delete button, then click it
    await page.getByText('Delete Me').hover();
    await page.locator('button[title="Delete group"]').click();

    // Group should disappear from sidebar
    await expect(page.getByText('Delete Me')).not.toBeVisible();
  });

  test('main group has no delete button', async ({ page }) => {
    await page.goto('/');

    // Hover over Main group
    await page.getByText('Main').hover();

    // No delete button should be present for main
    await expect(
      page.locator('button[title="Delete group"]'),
    ).not.toBeVisible();
  });

  test('new group persists on reload', async ({ page }) => {
    await page.goto('/');

    // Create a group
    await page.getByText('+ New Chat').click();
    await page.getByLabel('Name').fill('Persistent Group');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Persistent Group')).toBeVisible();

    // Reload page
    await page.reload();

    // Group should still be in sidebar
    await expect(page.getByText('Persistent Group')).toBeVisible();
  });
});
