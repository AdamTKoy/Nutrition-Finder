import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const center = { lat: 41.884, lng: -87.62 };

function menuItem(id: number) {
  return {
    id,
    title: `Chicken bowl ${id}`,
    restaurantChain: "Chipotle",
    nutrition: {
      nutrients: [
        { name: "Protein", amount: 30, unit: "g" },
        { name: "Fat", amount: 12, unit: "g" },
        { name: "Calories", amount: 450, unit: "kcal" },
      ],
    },
  };
}

const firstBranch = {
  id: "branch-1",
  name: "Chipotle",
  address: "100 Test Street",
  location: center,
  distanceMiles: 1,
};

const secondBranch = {
  id: "branch-2",
  name: "Chipotle",
  address: "200 Test Street",
  location: { lat: 41.89, lng: -87.62 },
  distanceMiles: 2,
};

async function mockSearch(
  page: Page,
  options: { emptyFirstLocations?: boolean } = {},
) {
  const calls: URL[] = [];

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());

    // Block external browser requests, including Google Maps.
    if (url.origin !== "http://127.0.0.1:3100") {
      await route.abort();
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }

    calls.push(url);

    if (url.pathname === "/api/menu-items") {
      const offset = Number(url.searchParams.get("offset") ?? 0);

      await route.fulfill({
        json: {
          menuItems:
            offset === 0
              ? Array.from({ length: 10 }, (_, index) => menuItem(index + 1))
              : [menuItem(10), menuItem(11)],
          totalMenuItems: 12,
          offset,
        },
      });
      return;
    }

    if (url.pathname === "/api/geocode") {
      await route.fulfill({
        json: {
          zip: "60601",
          formattedAddress: "Chicago, IL 60601, USA",
          location: center,
        },
      });
      return;
    }

    if (url.pathname === "/api/restaurants") {
      const token = url.searchParams.get("pageToken");

      await route.fulfill({
        json: {
          restaurants: token
            ? [firstBranch, secondBranch]
            : options.emptyFirstLocations
              ? []
              : [firstBranch],
          hasMore: !token,
          nextPageToken: token ? null : "locations-page-2",
        },
      });
      return;
    }

    // Unknown API requests must never reach a real endpoint.
    await route.fulfill({
      status: 500,
      json: { error: `Missing test mock for ${url.pathname}` },
    });
  });

  return calls;
}

async function submitSearch(page: Page) {
  await page.goto("/");
  await page.getByLabel("Food keyword", { exact: false }).fill("chicken");
  await page.getByLabel("US ZIP code", { exact: false }).fill("60601");
  await page.locator("#proteinMin").fill("20");
  await page.locator("#caloriesMax").fill("600");
  await page.getByRole("button", {
    name: "Find nearby restaurants",
    exact: true,
  }).click();
}

//
// SEARCH, RESET
//
test("searches with filters and clears results on Reset", async ({ page }) => {
  const calls = await mockSearch(page);
  await submitSearch(page);

  await expect(page.getByText("100 Test Street", { exact: true }))
    .toBeVisible();

  await expect(page.getByRole("heading", {
    name: "Chicken bowl 1",
    exact: true,
  })).toBeVisible();

  const menuRequest = calls.find(
    (url) => url.pathname === "/api/menu-items",
  );

  expect(menuRequest?.searchParams.get("keyword")).toBe("chicken");
  expect(menuRequest?.searchParams.get("minProtein")).toBe("20");
  expect(menuRequest?.searchParams.get("maxCalories")).toBe("600");
  expect(menuRequest?.searchParams.has("minFat")).toBe(false);

  await page.getByRole("button", { name: "Reset", exact: true }).click();

  await expect(page.locator("#keyword")).toHaveValue("");
  await expect(page.locator("#zip")).toHaveValue("");
  await expect(page.locator("#proteinMin")).toHaveValue("");
  await expect(page.locator("#caloriesMax")).toHaveValue("");

  await expect(page.getByText("100 Test Street", { exact: true }))
    .toHaveCount(0);

  await expect(page.getByRole("button", {
    name: "Load more menu matches",
    exact: true,
  })).toHaveCount(0);
});

//
// PAGINATION
//
test("merges menu and location pages without repeated chain lookups", async ({
  page,
}) => {
  const calls = await mockSearch(page);
  await submitSearch(page);

  await expect(page.getByText("100 Test Street", { exact: true }))
    .toBeVisible();

  await page.getByRole("button", {
    name: "Load more menu matches",
    exact: true,
  }).click();

  await expect(page.getByRole("heading", {
    name: "Chicken bowl 11",
    exact: true,
  })).toBeVisible();

  await expect(page.getByRole("heading", {
    name: "Chicken bowl 10",
    exact: true,
  })).toHaveCount(1);

  const menuCalls = calls.filter(
    (url) => url.pathname === "/api/menu-items",
  );

  expect(menuCalls.map((url) => url.searchParams.get("offset")))
    .toEqual(["0", "10"]);

  expect(menuCalls[1].searchParams.get("minProtein")).toBe("20");
  expect(menuCalls[1].searchParams.get("maxCalories")).toBe("600");

  expect(calls.filter((url) => url.pathname === "/api/geocode"))
    .toHaveLength(1);

  expect(calls.filter((url) => url.pathname === "/api/restaurants"))
    .toHaveLength(1);

  await page.getByRole("button", {
    name: "Load more locations for Chipotle",
    exact: true,
  }).click();

  await expect(page.getByText("200 Test Street", { exact: true }))
    .toBeVisible();

  await expect(page.getByText("100 Test Street", { exact: true }))
    .toHaveCount(1);

  const locationCalls = calls.filter(
    (url) => url.pathname === "/api/restaurants",
  );

  expect(locationCalls).toHaveLength(2);
  expect(locationCalls[1].searchParams.get("pageToken"))
    .toBe("locations-page-2");

  await expect(page.getByRole("button", {
    name: "Load more locations for Chipotle",
    exact: true,
  })).toHaveCount(0);
});

//
// EMPTY FIRST LOCATION PAGE
//
test("can find nearby branches after an empty location page", async ({ page }) => {
  await mockSearch(page, { emptyFirstLocations: true });
  await submitSearch(page);

  const pending = page.locator("details").filter({
    hasText: "Check remaining location pages",
  });

  await expect(pending).toBeVisible();

  await expect(page.getByRole("heading", {
    name: "Nearby restaurant candidates",
    exact: true,
  })).toHaveCount(0);

  await pending.locator("summary").click();

  await page.getByRole("button", {
    name: "Check more Chipotle locations",
    exact: true,
  }).click();

  await expect(page.getByText("100 Test Street", { exact: true }))
    .toBeVisible();

  await expect(page.getByText("200 Test Street", { exact: true }))
    .toBeVisible();

  await expect(pending).toHaveCount(0);
});

//
// API CALL QUOTA
//
test("preserves results and stops menu retries after quota exhaustion", async ({
  page,
}) => {
  await mockSearch(page);

  // Registered last, this route takes precedence over mockSearch.
  await page.route("**/api/menu-items?*", async (route) => {
    const url = new URL(route.request().url());

    if (url.searchParams.get("offset") !== "10") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 503,
      json: {
        code: "SPOONACULAR_QUOTA_EXHAUSTED",
        error: "Menu search quota exhausted.",
        upstreamStatus: 402,
      },
    });
  });

  await submitSearch(page);

  await expect(page.getByText("100 Test Street", { exact: true }))
    .toBeVisible();

  const moreMenu = page.getByRole("button", {
    name: "Load more menu matches",
    exact: true,
  });

  await moreMenu.click();

  await expect(page.getByText("Menu search quota reached", { exact: true }))
    .toBeVisible();

  await expect(moreMenu).toBeDisabled();

  await expect(page.getByRole("button", {
    name: "Find nearby restaurants",
    exact: true,
  })).toBeDisabled();

  // Previously loaded results remain usable.
  await expect(page.getByText("100 Test Street", { exact: true }))
    .toBeVisible();

  await expect(page.getByRole("button", {
    name: "Load more locations for Chipotle",
    exact: true,
  })).toBeEnabled();

  await expect(page.getByText(
    /Click Load more menu matches to retry/,
  )).toHaveCount(0);

  // Reset clears results, but doesn't pretend quota has been restored.
  await page.getByRole("button", { name: "Reset", exact: true }).click();

  await expect(page.getByText("100 Test Street", { exact: true }))
    .toHaveCount(0);

  await expect(page.getByText("Menu search quota reached", { exact: true }))
    .toBeVisible();
});

// **REQUEST FAILURES**

//
// MENU PAGE (with successful retry)
//
test("retries the same menu page without losing or duplicating results", async ({
  page,
}) => {
  const calls = await mockSearch(page);
  const offsets: string[] = [];
  let failedOnce = false;

  await page.route("**/api/menu-items?*", async (route) => {
    const url = new URL(route.request().url());
    const offset = url.searchParams.get("offset") ?? "0";
    offsets.push(offset);

    if (offset === "10" && !failedOnce) {
      failedOnce = true;

      await route.fulfill({
        status: 502,
        json: {
          error: "Temporary menu service failure.",
          upstreamStatus: 503,
        },
      });
      return;
    }

    await route.fallback();
  });

  await submitSearch(page);

  await expect(page.getByText("100 Test Street", { exact: true }))
    .toBeVisible();

  const moreMenu = page.getByRole("button", {
    name: "Load more menu matches",
    exact: true,
  });

  const retryError = page.getByRole("alert").filter({
    hasText: "Temporary menu service failure.",
  });

  await moreMenu.click();

  await expect(retryError).toBeVisible();
  await expect(moreMenu).toBeEnabled();

  // Failure must preserve the first page.
  await expect(page.getByRole("heading", {
    name: "Chicken bowl 1",
    exact: true,
  })).toBeVisible();

  await expect(page.getByRole("heading", {
    name: "Chicken bowl 11",
    exact: true,
  })).toHaveCount(0);

  await expect(page.getByText("100 Test Street", { exact: true }))
    .toBeVisible();

  // Retry succeeds using the existing mock response.
  await moreMenu.click();

  await expect(page.getByRole("heading", {
    name: "Chicken bowl 11",
    exact: true,
  })).toBeVisible();

  await expect(retryError).toHaveCount(0);

  // Both attempts requested page two, not page three.
  expect(offsets).toEqual(["0", "10", "10"]);

  // Item 10 appears on both mocked pages but renders only once.
  await expect(page.getByRole("heading", {
    name: "Chicken bowl 10",
    exact: true,
  })).toHaveCount(1);

  // The successful chain lookup was reused across both attempts.
  expect(calls.filter((url) => url.pathname === "/api/restaurants"))
    .toHaveLength(1);

  expect(calls.filter((url) => url.pathname === "/api/geocode"))
    .toHaveLength(1);
});

//
// LOCATION PAGE (with successful retry)
//
test("retries the same location token without losing or duplicating branches", async ({
  page,
}) => {
  await mockSearch(page);
  const tokens: Array<string | null> = [];
  let failedOnce = false;

  await page.route("**/api/restaurants?*", async (route) => {
    const url = new URL(route.request().url());
    const token = url.searchParams.get("pageToken");
    tokens.push(token);

    if (token && !failedOnce) {
      failedOnce = true;

      await route.fulfill({
        status: 502,
        json: {
          error: "Temporary location service failure.",
          upstreamStatus: 503,
        },
      });
      return;
    }

    await route.fallback();
  });

  await submitSearch(page);

  await expect(page.getByText("100 Test Street", { exact: true }))
    .toBeVisible();

  const moreLocations = page.getByRole("button", {
    name: "Load more locations for Chipotle",
    exact: true,
  });

  const retryError = page.getByRole("alert").filter({
    hasText: "Temporary location service failure.",
  });

  await moreLocations.click();

  await expect(retryError).toBeVisible();
  await expect(moreLocations).toBeEnabled();

  await expect(page.getByText("100 Test Street", { exact: true }))
    .toBeVisible();

  await expect(page.getByText("200 Test Street", { exact: true }))
    .toHaveCount(0);

  await moreLocations.click();

  await expect(page.getByText("200 Test Street", { exact: true }))
    .toBeVisible();

  await expect(retryError).toHaveCount(0);

  expect(tokens).toEqual([
    null,
    "locations-page-2",
    "locations-page-2",
  ]);

  // The second page includes the original branch again.
  await expect(page.getByText("100 Test Street", { exact: true }))
    .toHaveCount(1);

  // The final page has no continuation token.
  await expect(moreLocations).toHaveCount(0);
});

// **MOBILE LAYOUT TESTS**

//
// NARROW SCREEN
//
test("mobile layout fits the screen before and after search", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockSearch(page);
  await page.goto("/");

  async function expectNoHorizontalOverflow() {
    const dimensions = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));

    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  }

  await expectNoHorizontalOverflow();

  await submitSearch(page);

  await expect(page.getByText("100 Test Street", { exact: true }))
    .toBeVisible();

  await expectNoHorizontalOverflow();

  await page.getByRole("button", {
    name: "Load more locations for Chipotle",
    exact: true,
  }).click();

  await expect(page.getByText("200 Test Street", { exact: true }))
    .toBeVisible();

  await expectNoHorizontalOverflow();
});

//
// KEYBOARD, LABEL (accessibility)
//
test("keyboard navigation supports labeled fields and search", async ({
  page,
}) => {
  await mockSearch(page);
  await page.goto("/");

  const keyword = page.getByRole("textbox", {
    name: "Food keyword",
    exact: false,
  });

  const zip = page.getByRole("textbox", {
    name: "US ZIP code",
    exact: false,
  });

  // Start navigating from the top of the page without clicking.
  await page.keyboard.press("Tab");
  await expect(keyword).toBeFocused();
  await page.keyboard.type("chicken");

  await page.keyboard.press("Tab");
  await expect(zip).toBeFocused();
  await page.keyboard.type("60601");

  const limits = [
    { name: "Minimum Protein (g)", value: "20" },
    { name: "Maximum Protein (g)", value: "" },
    { name: "Minimum Fat (g)", value: "" },
    { name: "Maximum Fat (g)", value: "" },
    { name: "Minimum Calories (kcal)", value: "" },
    { name: "Maximum Calories (kcal)", value: "600" },
  ];

  for (const { name, value } of limits) {
    await page.keyboard.press("Tab");

    await expect(page.getByRole("spinbutton", {
      name,
      exact: true,
    })).toBeFocused();

    if (value) {
      await page.keyboard.type(value);
    }
  }

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", {
    name: "Reset",
    exact: true,
  })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", {
    name: "Find nearby restaurants",
    exact: true,
  })).toBeFocused();

  await page.keyboard.press("Enter");

  await expect(page.getByText("100 Test Street", { exact: true }))
    .toBeVisible();

  await expect(page.getByRole("heading", {
    name: "Chicken bowl 1",
    exact: true,
  })).toBeVisible();
});

//
// AXE-CORE AUTOMATED ACCESSIBILITY TESTS
//
for (const width of [1280, 375]) {
  test(`accessibility scan at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockSearch(page);
    await page.goto("/");

    async function scanPage(state: string) {
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      const results = await new AxeBuilder({ page }).analyze();

      // Save the full report, including inconclusive checks.
      await testInfo.attach(`accessibility-${state}-${width}.json`, {
        body: JSON.stringify(results, null, 2),
        contentType: "application/json",
      });

      const issues = results.violations.map((violation) => ({
        rule: violation.id,
        impact: violation.impact,
        description: violation.help,
        helpUrl: violation.helpUrl,
        elements: violation.nodes.map((node) => ({
          target: node.target,
          explanation: node.failureSummary,
        })),
      }));

      // Soft assertions let both page states get scanned if one fails.
      expect.soft(
        issues,
        `Accessibility issues in ${state} at ${width}px`,
      ).toEqual([]);
    }

    await scanPage("initial-form");

    await submitSearch(page);

    await expect(page.getByText("100 Test Street", { exact: true }))
      .toBeVisible();

    await expect(page.getByRole("button", {
      name: "Find nearby restaurants",
      exact: true,
    })).toBeEnabled();

    await scanPage("loaded-results");
  });
}