import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __chat: {
      append: (n: number, opts?: { behavior?: 'auto' | 'smooth' | false }) => void;
      prepend: (n: number) => void;
      length: () => number;
      scrollToBottom: (behavior?: 'auto' | 'smooth') => void;
      setRtl: (rtl: boolean) => void;
      ids: () => string[];
    };
  }
}

const scroller = (page: Page) => page.locator('[data-virtuoso-scroller="true"]');

async function ready(page: Page) {
  await page.goto('/?harness=1');
  await page.waitForFunction(() => Boolean(window.__chat));
  await expect(scroller(page)).toBeVisible();
  await expect(page.locator('[data-testid^="msg-"]').first()).toBeVisible();
  await page.waitForTimeout(150);
}

async function scrollTo(page: Page, top: number) {
  await scroller(page).evaluate((el, value) => {
    el.scrollTop = value;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, top);
}

async function bottomGap(page: Page) {
  return scroller(page).evaluate(
    (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
  );
}

test.describe('ChatMessageList e2e', () => {
  test.beforeEach(async ({ page }) => {
    await ready(page);
  });

  test('scrolls to bottom on a new message when pinned', async ({ page }) => {
    await page.evaluate(() => window.__chat.scrollToBottom('auto'));
    await expect.poll(() => bottomGap(page)).toBeLessThanOrEqual(4);

    const lastId = await page.evaluate(() => {
      window.__chat.append(1, { behavior: 'auto' });
      return window.__chat.ids().at(-1);
    });

    await expect(page.getByTestId(`msg-${lastId}`)).toBeVisible();
    await expect.poll(() => bottomGap(page)).toBeLessThanOrEqual(4);
  });

  test('preserves scroll position when older messages are prepended', async ({ page }) => {
    const beforeLength = await page.evaluate(() => window.__chat.length());
    await scrollTo(page, 0);

    await page.evaluate(() => window.__chat.prepend(5));

    await expect
      .poll(() => page.evaluate(() => window.__chat.length()))
      .toBe(beforeLength + 5);
    await expect
      .poll(() => scroller(page).evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    const firstId = await page.evaluate(() => window.__chat.ids()[0]);
    expect(firstId.startsWith('p')).toBe(true);
  });

  test('updates sticky headers as group visibility changes', async ({ page }) => {
    await page.evaluate(() => window.__chat.scrollToBottom('auto'));
    await expect(page.getByTestId('sticky-header')).toHaveAttribute(
      'data-group-key',
      'Today',
    );

    await scrollTo(page, 0);
    await expect(page.getByTestId('sticky-header')).toHaveAttribute(
      'data-group-key',
      'Earlier',
    );
  });

  test('shows and hides the scroll-to-bottom button away from the live edge', async ({
    page,
  }) => {
    await scrollTo(page, 0);
    const button = page.getByRole('button', { name: /scroll to latest/i });
    await expect(button).toBeVisible();

    await page.evaluate(() => window.__chat.append(1, { behavior: false }));
    await expect(button).toContainText('1');

    await button.click();
    await expect.poll(() => bottomGap(page)).toBeLessThanOrEqual(24);
    await expect(button).toBeHidden();
  });

  test('passes grouped-message context to itemContent', async ({ page }) => {
    await scrollTo(page, 0);
    await expect(page.locator('[data-first-in-group="false"]').first()).toBeVisible();
    await expect(page.locator('[data-last-in-group="false"]').first()).toBeVisible();

    const middle = page.locator('[data-first-in-group="false"]').first();
    await expect(middle).not.toHaveAttribute('data-prev', '');
    await expect(middle).not.toHaveAttribute('data-next', '');
  });

  test('supports RTL mode', async ({ page }) => {
    await page.evaluate(() => window.__chat.setRtl(true));
    const root = page.locator('.cml-root');
    await expect(root).toHaveAttribute('dir', 'rtl');
    await expect
      .poll(() => root.evaluate((el) => getComputedStyle(el).direction))
      .toBe('rtl');
  });
});
