// Tests for route files under both menu-items and restaurants;
// FUNCTIONAL tests to verify endpoint behavior--no development server utilized (browser tests are separate)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as searchMenu } from "./menu-items/route";
import { GET as geocode } from "./geocode/route";
import { GET as searchRestaurants } from "./restaurants/route";

const fetchMock = vi.fn<typeof fetch>();

function request(path: string) {
  return new Request(`http://localhost:3000${path}`);
}

beforeEach(() => {
  fetchMock.mockReset();

  // Any unconfigured call fails locally instead of reaching the internet.
  fetchMock.mockRejectedValue(new Error("Unconfigured mock fetch"));

  vi.stubGlobal("fetch", fetchMock);

  vi.stubEnv("SPOONACULAR_API_KEY", "test-spoonacular-key");
  vi.stubEnv("GOOGLE_MAPS_SERVER_API_KEY", "test-google-key");
});

afterEach(() => { // clean up back to normal state
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// menu search tests
describe("menu-items endpoint", () => {
  it.each([
    "",
    "?keyword=%20%20",
    "?keyword=burger&minProtein=-1",
    "?keyword=burger&maxCalories=abc",
    "?keyword=burger&minFat=20&maxFat=10",
    "?keyword=burger&offset=5",
    "?keyword=burger&offset=1000",
  ])("rejects invalid parameters: %s", async (query) => {
    const response = await searchMenu(request(`/api/menu-items${query}`));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards filters and pagination while preserving zero", async () => {
    const payload = {
      menuItems: [{ id: 1, title: "Test burger" }],
      totalMenuItems: 25,
      offset: 10,
    };

    fetchMock.mockResolvedValueOnce(Response.json(payload));

    const response = await searchMenu(
      request(
        "/api/menu-items?keyword=chicken%20sandwich" +
        "&minProtein=0&maxCalories=600&minFat=&offset=10",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [input] = fetchMock.mock.calls[0];
    const outgoing = new URL(String(input));

    expect(outgoing.origin).toBe("https://api.spoonacular.com");
    expect(outgoing.searchParams.get("query")).toBe("chicken sandwich");
    expect(outgoing.searchParams.get("minProtein")).toBe("0");
    expect(outgoing.searchParams.get("maxCalories")).toBe("600");
    expect(outgoing.searchParams.has("minFat")).toBe(false);
    expect(outgoing.searchParams.get("offset")).toBe("10");
    expect(outgoing.searchParams.get("number")).toBe("10");
    expect(outgoing.searchParams.get("addMenuItemInformation")).toBe("true");
  });

  it("returns a successful empty result", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ menuItems: [], totalMenuItems: 0 }),
    );

    const response = await searchMenu(
      request("/api/menu-items?keyword=burger"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ menuItems: [] });
  });
});

// ZIP-lookup tests
function zipResult(
  zip = "60601",
  country = "US",
  partial = false,
) {
  return {
    formatted_address: `${zip}, USA`,
    partial_match: partial,
    address_components: [
      {
        long_name: zip,
        short_name: zip,
        types: ["postal_code"],
      },
      {
        long_name: country,
        short_name: country,
        types: ["country"],
      },
    ],
    geometry: {
      location: { lat: 41.884, lng: -87.62 },
    },
  };
}

describe("geocode endpoint", () => {
  it.each(["", "abc", "1234", "123456"])(
    "rejects invalid ZIP: %s",
    async (zip) => {
      const response = await geocode(request(`/api/geocode?zip=${zip}`));

      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("returns coordinates for an exact US ZIP match", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ status: "OK", results: [zipResult()] }),
    );

    const response = await geocode(request("/api/geocode?zip=60601"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      zip: "60601",
      formattedAddress: "60601, USA",
      location: { lat: 41.884, lng: -87.62 },
    });

    const [input] = fetchMock.mock.calls[0];
    const outgoing = new URL(String(input));

    expect(outgoing.searchParams.get("components")).toBe(
      "postal_code:60601|country:US",
    );
  });

  it.each([
    ["wrong ZIP", zipResult("60602")],
    ["wrong country", zipResult("60601", "CA")],
    ["partial match", zipResult("60601", "US", true)],
  ])("rejects a %s", async (_label, result) => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ status: "OK", results: [result] }),
    );

    const response = await geocode(request("/api/geocode?zip=60601"));

    expect(response.status).toBe(404);
  });

  it("handles ZERO_RESULTS", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ status: "ZERO_RESULTS", results: [] }),
    );

    const response = await geocode(request("/api/geocode?zip=60601"));

    expect(response.status).toBe(404);
  });

  it("handles Google's error status inside an HTTP 200 response", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ status: "REQUEST_DENIED", results: [] }),
    );

    const response = await geocode(request("/api/geocode?zip=60601"));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      upstreamStatus: "REQUEST_DENIED",
    });
  });
});

// Restaurant filtering and pagination tests
function place(id: string, latitude: number, name = "Chipotle") {
  return {
    id,
    displayName: { text: name },
    formattedAddress: `${id} Test Street`,
    location: { latitude, longitude: 0 },
  };
}

describe("restaurants endpoint", () => {
  it.each([
    "lat=0&lng=0",
    "chain=Chipotle&lng=0",
    "chain=Chipotle&lat=abc&lng=0",
    "chain=Chipotle&lat=91&lng=0",
    "chain=Chipotle&lat=0&lng=-181",
  ])("rejects invalid parameters: %s", async (query) => {
    const response = await searchRestaurants(
      request(`/api/restaurants?${query}`),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("filters by chain and five-mile distance, then sorts nearest first", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        places: [
          place("inside", 0.072, "Chipotle Mexican Grill"),
          place("outside", 0.073),
          place("wrong-chain", 0.01, "Unrelated Cafe"),
          place("nearest", 0.01),
          { id: "missing-location", displayName: { text: "Chipotle" } },
        ],
      }),
    );

    const response = await searchRestaurants(
      request("/api/restaurants?chain=Chipotle&lat=0&lng=0"),
    );

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(
      body.restaurants.map((restaurant: { id: string }) => restaurant.id),
    ).toEqual(["nearest", "inside"]);

    expect(body.hasMore).toBe(false);
    expect(body.nextPageToken).toBeNull();
  });

  it("forwards the token and preserves pagination after filtering everything out", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        places: [place("outside", 0.073)],
        nextPageToken: "next-token",
      }),
    );

    const params = new URLSearchParams({
      chain: "Chipotle",
      lat: "0",
      lng: "0",
      pageToken: "previous+token/=",
    });

    const response = await searchRestaurants(
      request(`/api/restaurants?${params}`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      restaurants: [],
      hasMore: true,
      nextPageToken: "next-token",
    });

    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe(
      "https://places.googleapis.com/v1/places:searchText",
    );
    expect(options?.method).toBe("POST");
    expect(JSON.parse(String(options?.body))).toMatchObject({
      textQuery: "Chipotle",
      pageToken: "previous+token/=",
      locationBias: {
        circle: {
          center: { latitude: 0, longitude: 0 },
          radius: 8046.72,
        },
      },
    });

    const headers = new Headers(options?.headers);
    expect(headers.get("X-Goog-FieldMask")?.split(",")).toContain(
      "nextPageToken",
    );
  });
});

// failure tests for all 3 endpoints
const endpoints = [
  {
    name: "menu-items",
    handler: searchMenu,
    path: "/api/menu-items?keyword=burger",
    key: "SPOONACULAR_API_KEY",
  },
  {
    name: "geocode",
    handler: geocode,
    path: "/api/geocode?zip=60601",
    key: "GOOGLE_MAPS_SERVER_API_KEY",
  },
  {
    name: "restaurants",
    handler: searchRestaurants,
    path: "/api/restaurants?chain=Chipotle&lat=0&lng=0",
    key: "GOOGLE_MAPS_SERVER_API_KEY",
  },
];

describe.each(endpoints)("$name failure handling", ({ handler, path, key }) => {
  it("rejects missing configuration without contacting the provider", async () => {
    vi.stubEnv(key, "");

    const response = await handler(request(path));

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles a provider rate-limit response", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "Rate limited" }, { status: 429 }),
    );

    const response = await handler(request(path));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      upstreamStatus: 429,
      error: expect.any(String),
    });
  });

  it("handles a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network unavailable"));

    const response = await handler(request(path));

    expect(response.status).toBe(502);
    expect(await response.json()).toHaveProperty("error");
  });

  it("handles malformed JSON from the provider", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("not JSON", { status: 200 }),
    );

    const response = await handler(request(path));

    expect(response.status).toBe(502);
    expect(await response.json()).toHaveProperty("error");
  });
});

// test for when Spoonacular free API quota exhausted
it("identifies exhausted Spoonacular quota", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json(
      { message: "Daily quota exceeded" },
      { status: 402 },
    ),
  );

  const response = await searchMenu(
    request("/api/menu-items?keyword=burger"),
  );

  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    code: "SPOONACULAR_QUOTA_EXHAUSTED",
    upstreamStatus: 402,
    error: expect.any(String),
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});