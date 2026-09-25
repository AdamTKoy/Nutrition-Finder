"use client";

import { useRef, useState, type SubmitEvent } from "react";
import RestaurantLinks from "@/components/RestaurantLinks";
import RestaurantMap from "@/components/RestaurantMap";

const nutrients = [
  { key: "protein", label: "Protein", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
  { key: "calories", label: "Calories", unit: "kcal" },
] as const;

type Coordinates = {
  lat: number;
  lng: number;
};

type LocationResults = {
  restaurants: Restaurant[];
  hasMore: boolean;
  nextPageToken: string | null;
};

type MenuItem = {
  id: number;
  title: string;
  restaurantChain?: string;
  nutrition?: {
    nutrients?: Nutrient[];
  };
};

type MenuSearchResponse = {
  menuItems?: MenuItem[];
  error?: string;
  totalMenuItems?: number;
  upstreamStatus?: number;
};

type Nutrient = {
  name: string;
  amount: number;
  unit: string;
};

type Restaurant = {
  id: string;
  name: string;
  address: string;
  location: Coordinates;
  distanceMiles: number;
};

type RestaurantGroup = {
  chain: string;
  items: MenuItem[];
  restaurants: Restaurant[];
  hasMore: boolean;
  nextPageToken: string | null;
};

type SearchSession = {
  query: string;
  zip: string;
  offset: number;
  location?: Coordinates;
  items: Map<number, MenuItem>;
  locations: Map<string, LocationResults>;
};

// since our class extends Error, other standard error handling will continue to work
class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    const details = data.upstreamStatus ? ` (${data.upstreamStatus})` : "";

    throw new ApiError(
      (data.error ?? "The request failed.") + details,
      typeof data.code === "string" ? data.code : undefined,
    );
  }

  return data as T;
}

function formatNutrient(item: MenuItem, name: string): string {
  const nutrient = item.nutrition?.nutrients?.find(
    (entry) => entry.name.toLowerCase() === name.toLowerCase(),
  );

  if (
    !nutrient ||
    typeof nutrient.amount !== "number" ||
    !Number.isFinite(nutrient.amount) ||
    nutrient.amount < 0
  ) {
    return "Not available";
  }

  const amount = nutrient.amount.toLocaleString("en-US", {
    maximumFractionDigits: 1,
  });

  return `${amount} ${nutrient.unit ?? ""}`.trim();
}

export default function Home() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [groups, setGroups] = useState<RestaurantGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMoreMenu, setHasMoreMenu] = useState(false);
  const [loadingChain, setLoadingChain] = useState<string | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);

  const sessionRef = useRef<SearchSession | null>(null);
  const busyRef = useRef(false);

  function clearSearch() {
    if (busyRef.current) return;

    sessionRef.current = null;
    setHasMoreMenu(false);
    setGroups([]);
    setError("");
    setMessage("");
  }

  const nearbyGroups = groups.filter((group) => group.restaurants.length > 0);

  const pendingGroups = groups.filter(
    (group) => group.restaurants.length === 0 && Boolean(group.nextPageToken),
  );

  const mapRestaurants = nearbyGroups.flatMap((group) => group.restaurants);

  // - existing results remain while another page loads
  // - new menu items merge in with pre-existing restaurants when applicable
  // - repeated chains don't trigger another API request
  // - editing parameter field or clicking 'Reset' clears both session and 'Load more menu matches' button
  // - new search restarts result page offset to 0
  async function loadNextPage() {
    const session = sessionRef.current;
    if (!session || busyRef.current || quotaExhausted) return;

    busyRef.current = true;
    setIsLoading(true);
    setError("");
    setMessage("Loading menu matches…");

    try {
      const params = new URLSearchParams(session.query);
      params.set("offset", String(session.offset));

      const menu = await fetchJson<MenuSearchResponse>(
        `/api/menu-items?${params}`,
      );

      if (
        !Array.isArray(menu.menuItems) ||
        typeof menu.totalMenuItems !== "number" ||
        !Number.isInteger(menu.totalMenuItems) ||
        menu.totalMenuItems < 0
      ) {
        throw new Error("The menu search returned an unexpected response.");
      }

      // Prepare the next results without overwriting existing results yet.
      const combinedItems = new Map(session.items);

      for (const item of menu.menuItems) {
        combinedItems.set(item.id, item);
      }

      const chains = new Map<string, { chain: string; items: MenuItem[] }>();

      let missingChainCount = 0;

      for (const item of combinedItems.values()) {
        const chain = item.restaurantChain?.trim();

        if (!chain) {
          missingChainCount++;
          continue;
        }

        const key = chain.toLowerCase();
        const existing = chains.get(key);

        if (existing) {
          existing.items.push(item);
        } else {
          chains.set(key, { chain, items: [item] });
        }
      }

      // Look up coordinates only once during this search.
      if (chains.size > 0 && !session.location) {
        setMessage("Looking up your ZIP code…");

        const geo = await fetchJson<{ location: Coordinates }>(
          `/api/geocode?${new URLSearchParams({ zip: session.zip })}`,
        );

        if (
          !geo.location ||
          !Number.isFinite(geo.location.lat) ||
          !Number.isFinite(geo.location.lng)
        ) {
          throw new Error("The ZIP lookup returned invalid coordinates.");
        }

        session.location = geo.location;
      }

      for (const [key, group] of chains) {
        // Reuse successful lookups, including those with zero locations.
        if (session.locations.has(key)) continue;

        const center = session.location;
        if (!center) throw new Error("Search coordinates are missing.");

        setMessage(`Finding nearby locations: ${group.chain}…`);

        const params = new URLSearchParams({
          chain: group.chain,
          lat: String(center.lat),
          lng: String(center.lng),
        });

        const result = await fetchJson<LocationResults>(
          `/api/restaurants?${params}`,
        );

        if (!Array.isArray(result.restaurants)) {
          throw new Error("Unexpected restaurant response.");
        }

        session.locations.set(key, result);
      }

      const found: RestaurantGroup[] = [];

      for (const [key, group] of chains) {
        const locations = session.locations.get(key);

        // user can request another page even when filters rejected all locations on first page
        if (locations) {
          found.push({ ...group, ...locations });
        }
      }

      // Commit only after this page's lookups succeed.
      session.items = combinedItems;

      const nextOffset = session.offset + 10;
      const more =
        menu.menuItems.length > 0 &&
        nextOffset < menu.totalMenuItems &&
        nextOffset <= 990;

      session.offset = nextOffset;
      setGroups(found);
      setHasMoreMenu(more);

      const moreLocations = Array.from(session.locations.values()).some(
        (result) => result.hasMore,
      );

      const chainsWithLocations = found.filter(
        (group) => group.restaurants.length > 0,
      ).length;

      setMessage(
        [
          `Loaded ${combinedItems.size} unique menu matches.`,
          chainsWithLocations > 0
            ? `Nearby candidates found for ${chainsWithLocations} chains.`
            : "No nearby candidates found among the location pages checked.",
          missingChainCount > 0
            ? `${missingChainCount} menu items had no restaurant name.`
            : "",
          moreLocations
            ? "Some chains have additional Google location pages not checked."
            : "",
          !more && nextOffset > 990 && menu.totalMenuItems > 1000
            ? "Reached the menu pagination limit. Narrow your search for other matches."
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (error) {
      setMessage("");

      if (
        error instanceof ApiError &&
        error.code === "SPOONACULAR_QUOTA_EXHAUSTED"
      ) {
        setQuotaExhausted(true);
        setError("");
      } else {
        setError(
          `${
            error instanceof Error ? error.message : "The search failed."
          } Existing results are unchanged. Click Load more menu matches to retry.`,
        );
      }
    } finally {
      busyRef.current = false;
      setIsLoading(false);
    }
  }

  async function loadMoreLocations(chain: string) {
    const session = sessionRef.current;
    const center = session?.location;
    const key = chain.toLowerCase();
    const previous = session?.locations.get(key);

    if (!session || !center || !previous?.nextPageToken || busyRef.current) {
      return;
    }

    busyRef.current = true;
    setIsLoading(true);
    setLoadingChain(key);
    setError("");
    setMessage(`Loading more ${chain} locations…`);

    try {
      const params = new URLSearchParams({
        chain,
        lat: String(center.lat),
        lng: String(center.lng),
        pageToken: previous.nextPageToken,
      });

      const result = await fetchJson<LocationResults>(
        `/api/restaurants?${params}`,
      );

      if (
        !Array.isArray(result.restaurants) ||
        !(
          result.nextPageToken === null ||
          typeof result.nextPageToken === "string"
        )
      ) {
        throw new Error("Unexpected restaurant response.");
      }

      // Google may return a location we've already seen.
      const unique = new Map(
        previous.restaurants.map((restaurant) => [restaurant.id, restaurant]),
      );

      for (const restaurant of result.restaurants) {
        unique.set(restaurant.id, restaurant);
      }

      const merged: LocationResults = {
        restaurants: Array.from(unique.values()).sort(
          (a, b) => a.distanceMiles - b.distanceMiles,
        ),
        nextPageToken: result.nextPageToken || null,
        hasMore: Boolean(result.nextPageToken),
      };

      // Update both the session cache and the rendered results.
      session.locations.set(key, merged);

      setGroups((current) =>
        current.map((group) =>
          group.chain.toLowerCase() === key ? { ...group, ...merged } : group,
        ),
      );

      const added = merged.restaurants.length - previous.restaurants.length;

      setMessage(
        `${chain}: added ${added} new nearby locations. ` +
          (merged.hasMore
            ? "More location pages are available."
            : "All location pages returned by Google have been checked."),
      );
    } catch (error) {
      // Keep the previous results and token so the user can retry.
      setMessage("");
      setError(
        `${
          error instanceof Error ? error.message : "The location search failed."
        } Existing locations are unchanged. Try Load more locations again.`,
      );
    } finally {
      busyRef.current = false;
      setIsLoading(false);
      setLoadingChain(null);
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busyRef.current || quotaExhausted) return;
    clearSearch();

    const data = new FormData(event.currentTarget);
    const keyword = String(data.get("keyword") ?? "").trim();
    if (!keyword) {
      setError("Enter a food keyword, such as burger or salad.");
      return;
    }
    const zip = String(data.get("zip") ?? "").trim();

    if (!/^\d{5}$/.test(zip)) {
      setError("Enter a five-digit US ZIP code.");
      return;
    }

    for (const { key, label } of nutrients) {
      const minText = String(data.get(`${key}Min`) ?? "");
      const maxText = String(data.get(`${key}Max`) ?? "");
      // Empty inputs mean no limit; zero is a valid, explicit limit.
      const min = minText === "" ? undefined : Number(minText);
      const max = maxText === "" ? undefined : Number(maxText);
      if (
        [min, max].some(
          (value) =>
            value !== undefined && (!Number.isFinite(value) || value < 0),
        )
      ) {
        setError(`${label} limits must be nonnegative numbers.`);
        return;
      }
      if (min !== undefined && max !== undefined && min > max) {
        setError(
          `${label}: the minimum must be less than or equal to the maximum.`,
        );
        return;
      }
    }

    const params = new URLSearchParams({ keyword });

    // Form names such as proteinMin become API names such as minProtein.
    for (const { key, label } of nutrients) {
      for (const bound of ["Min", "Max"] as const) {
        const value = String(data.get(`${key}${bound}`) ?? "").trim();

        if (value !== "") {
          params.set(`${bound.toLowerCase()}${label}`, value);
        }
      }
    }

    sessionRef.current = {
      query: params.toString(),
      zip,
      offset: 0,
      items: new Map(),
      locations: new Map(),
    };

    setHasMoreMenu(true);
    await loadNextPage();
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20";

  return (
    <main className="min-h-screen bg-stone-50 px-5 py-12 text-stone-900 sm:py-20">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-800">
          Nutrition Finder
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          Find food that fits your goals.
        </h1>
        <p className="mt-5 text-lg leading-8 text-stone-600">
          Choose your nutrition limits and a ZIP code to find restaurant options
          within five miles.
        </p>

        <form
          onSubmit={handleSubmit}
          onChange={clearSearch}
          onReset={clearSearch}
          className="mt-9 space-y-7 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8"
        >
          <fieldset
            disabled={isLoading}
            aria-busy={isLoading}
            className="min-w-0 space-y-7 disabled:opacity-70"
          >
            <div>
              <label htmlFor="keyword" className="font-semibold">
                Food keyword{" "}
                <span className="text-sm font-normal text-stone-500">
                  (required)
                </span>
              </label>
              <input
                id="keyword"
                name="keyword"
                type="text"
                required
                placeholder="e.g. burger, salad, chicken"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="zip" className="font-semibold">
                US ZIP code{" "}
                <span className="text-sm font-normal text-stone-500">
                  (required)
                </span>
              </label>
              <input
                id="zip"
                name="zip"
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                pattern="[0-9]{5}"
                maxLength={5}
                required
                placeholder="e.g. 60601"
                className={inputClass}
              />
            </div>

            <div>
              <h2 className="text-lg font-semibold">Nutrition per menu item</h2>
              <p id="limits-help" className="mt-1 text-sm text-stone-600">
                All limits are optional. Leave a field blank for no limit.
              </p>
            </div>

            {nutrients.map(({ key, label, unit }) => (
              <fieldset key={key} aria-describedby="limits-help">
                <legend className="font-semibold">
                  {label}{" "}
                  <span className="font-normal text-stone-500">({unit})</span>
                </legend>
                <div className="mt-2 grid grid-cols-2 gap-4">
                  {(["Min", "Max"] as const).map((bound) => (
                    <div key={bound}>
                      <label
                        htmlFor={`${key}${bound}`}
                        className="text-sm text-stone-600"
                      >
                        {bound === "Min" ? "Minimum" : "Maximum"}
                        <span className="sr-only">
                          {" "}
                          {label} ({unit})
                        </span>
                      </label>
                      <input
                        id={`${key}${bound}`}
                        name={`${key}${bound}`}
                        type="number"
                        min="0"
                        step="any"
                        placeholder="No limit"
                        className={inputClass}
                      />
                    </div>
                  ))}
                </div>
              </fieldset>
            ))}

            {error && (
              <p
                role="alert"
                className="rounded-xl bg-red-50 p-4 text-sm text-red-800"
              >
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="reset"
                className="rounded-xl border border-stone-300 px-5 py-3.5 font-semibold text-stone-700 hover:bg-stone-100"
              >
                Reset
              </button>

              <button
                type="submit"
                disabled={isLoading || quotaExhausted}
                className="flex-1 rounded-xl bg-emerald-800 px-5 py-3.5 font-semibold text-white transition hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? "Searching…" : "Find nearby restaurants"}
              </button>
            </div>
            <p className="text-center text-sm text-stone-500">
              Distances are measured from the ZIP-code center, not your exact
              location.
            </p>
            <p role="status" className="text-sm leading-6 text-emerald-800">
              {message}
            </p>
          </fieldset>
        </form>
        {quotaExhausted && (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
          >
            <p className="font-semibold">Menu search quota reached</p>
            <p className="mt-1">
              New menu searches are temporarily unavailable. Any loaded results
              remain available. Wait for the quota to reset, then reload this
              page to try again.
            </p>
          </div>
        )}
        {hasMoreMenu && (
          <button
            type="button"
            onClick={() => void loadNextPage()}
            disabled={isLoading || quotaExhausted}
            className="mt-6 w-full rounded-xl border border-emerald-800 px-5 py-3 font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Loading…" : "Load more menu matches"}
          </button>
        )}
        {pendingGroups.length > 0 && (
          <details className="mt-6 rounded-xl border border-stone-200 p-4">
            <summary className="cursor-pointer text-sm font-medium text-stone-700">
              Check remaining location pages ({pendingGroups.length} chains)
            </summary>

            <p className="mt-2 text-sm text-stone-600">
              No nearby locations have been found for these chains yet.
              Additional pages may contain matches.
            </p>

            <ul className="mt-3 space-y-2">
              {pendingGroups.map((group) => (
                <li key={group.chain}>
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => void loadMoreLocations(group.chain)}
                    className="text-sm font-medium text-emerald-800 underline disabled:opacity-50"
                  >
                    {loadingChain === group.chain.toLowerCase()
                      ? `Checking ${group.chain}…`
                      : `Check more ${group.chain} locations`}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {nearbyGroups.length > 0 && (
          <section aria-labelledby="results-heading" className="mt-10">
            <h2 id="results-heading" className="text-2xl font-semibold">
              Nearby restaurant candidates
            </h2>

            <p className="mt-2 text-sm leading-6 text-stone-600">
              Locations are within five miles of the ZIP-code search center.
              Check the business name: text searches can return similar names.
              Menu availability at individual branches is not confirmed.
            </p>
            <RestaurantMap restaurants={mapRestaurants} />
            <div className="mt-5 space-y-6">
              {nearbyGroups.map((group) => (
                <article
                  key={group.chain}
                  className="rounded-2xl border border-stone-200 bg-white p-6"
                >
                  <h3 className="text-xl font-semibold">{group.chain}</h3>

                  <h4 className="mt-4 font-medium">
                    Menu matches from Spoonacular
                  </h4>
                  <p className="mt-1 text-xs text-stone-500">
                    Nutrition as reported by Spoonacular. Serving sizes vary by
                    item.
                  </p>

                  <ul className="mt-3 space-y-3">
                    {group.items.map((item) => (
                      <li key={item.id} className="rounded-xl bg-stone-50 p-4">
                        <h5 className="text-sm font-semibold text-stone-900">
                          {item.title}
                        </h5>

                        <dl className="mt-3 grid grid-cols-3 gap-3">
                          {["Protein", "Fat", "Calories"].map((name) => (
                            <div key={name}>
                              <dt className="text-xs text-stone-500">{name}</dt>
                              <dd className="mt-1 text-sm font-medium text-stone-900">
                                {formatNutrient(item, name)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-5 border-t border-stone-200 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-medium">
                        Nearby location candidates
                      </h4>
                      <span
                        translate="no"
                        className="ml-3 whitespace-nowrap font-sans text-xs font-normal text-[#5e5e5e]"
                      >
                        Google Maps
                      </span>
                    </div>

                    {group.restaurants.length === 0 && (
                      <p className="mt-3 text-sm text-stone-600">
                        No matching locations within five miles were found on
                        the pages checked.
                      </p>
                    )}

                    <ul className="mt-3 space-y-4">
                      {group.restaurants.map((restaurant) => (
                        <li key={restaurant.id}>
                          <p className="font-medium">{restaurant.name}</p>
                          <p className="text-sm text-stone-600">
                            {restaurant.address}
                          </p>
                          <p className="mt-1 text-sm text-emerald-800">
                            {restaurant.distanceMiles.toFixed(1)} miles from the
                            ZIP-code center
                          </p>
                          <RestaurantLinks restaurant={restaurant} />
                        </li>
                      ))}
                    </ul>

                    {group.nextPageToken && (
                      <button
                        type="button"
                        onClick={() => void loadMoreLocations(group.chain)}
                        disabled={isLoading}
                        aria-label={`Load more locations for ${group.chain}`}
                        className="mt-4 rounded-xl border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-50"
                      >
                        {loadingChain === group.chain.toLowerCase()
                          ? "Loading locations…"
                          : "Load more locations"}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
