"use client";

import { useState, type SubmitEvent } from "react";
import RestaurantMap from "@/components/RestaurantMap";

const nutrients = [
  { key: "protein", label: "Protein", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
  { key: "calories", label: "Calories", unit: "kcal" },
] as const;

type MenuItem = {
  id: number;
  title: string;
  restaurantChain?: string;
};

type MenuSearchResponse = {
  menuItems?: MenuItem[];
  error?: string;
  upstreamStatus?: number;
};

type Coordinates = {
  lat: number;
  lng: number;
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
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    const details = data.upstreamStatus ? ` (${data.upstreamStatus})` : "";

    throw new Error((data.error ?? "The request failed.") + details);
  }

  return data as T;
}

export default function Home() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [groups, setGroups] = useState<RestaurantGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const mapRestaurants = groups.flatMap((group) => group.restaurants);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isLoading) return;

    setError("");
    setMessage("");
    setGroups([]);

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

    setIsLoading(true);
    setMessage("Searching menu items…");

    try {
      const menu = await fetchJson<MenuSearchResponse>(
        `/api/menu-items?${params.toString()}`,
      );

      if (!Array.isArray(menu.menuItems)) {
        throw new Error("The menu search returned an unexpected response.");
      }

      if (menu.menuItems.length === 0) {
        setMessage(
          "No menu items matched. Try broader limits or another keyword.",
        );
        return;
      }

      // Group items so we search each chain only once.
      const chains = new Map<string, { chain: string; items: MenuItem[] }>();
      let missingChainCount = 0;

      for (const item of menu.menuItems) {
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

      if (chains.size === 0) {
        setMessage(
          "Matching menu items were found, but none included restaurant names.",
        );
        return;
      }

      setMessage("Looking up your ZIP code…");

      const geo = await fetchJson<{ location: Coordinates }>(
        `/api/geocode?${new URLSearchParams({ zip })}`,
      );

      if (
        !geo.location ||
        !Number.isFinite(geo.location.lat) ||
        !Number.isFinite(geo.location.lng)
      ) {
        throw new Error("The ZIP lookup returned invalid coordinates.");
      }

      const found: RestaurantGroup[] = [];
      const failures: string[] = [];
      let checked = 0;
      let hasMore = false;

      // Search sequentially to avoid a burst of Google requests.
      for (const group of chains.values()) {
        checked++;
        setMessage(
          `Finding nearby locations: ${group.chain} (${checked}/${chains.size})…`,
        );

        const locationParams = new URLSearchParams({
          chain: group.chain,
          lat: String(geo.location.lat),
          lng: String(geo.location.lng),
        });

        try {
          const result = await fetchJson<{
            restaurants: Restaurant[];
            hasMore: boolean;
          }>(`/api/restaurants?${locationParams}`);

          if (!Array.isArray(result.restaurants)) {
            throw new Error("Unexpected restaurant response.");
          }

          hasMore ||= result.hasMore;

          if (result.restaurants.length > 0) {
            found.push({
              ...group,
              restaurants: result.restaurants,
              hasMore: result.hasMore,
            });
          }
        } catch (error) {
          failures.push(
            `${group.chain}: ${
              error instanceof Error ? error.message : "Lookup failed."
            }`,
          );
        }
      }

      setGroups(found);

      const summary =
        found.length > 0
          ? `Nearby location candidates found for ${found.length} restaurant chains.`
          : failures.length > 0
            ? "No nearby locations were returned by the completed lookups."
            : "No nearby locations were found among the menu matches checked.";

      setMessage(
        [
          summary,
          "Search covers the first 10 menu matches.",
          hasMore
            ? "Some chains have additional Google results not checked yet."
            : "",
          missingChainCount > 0
            ? `${missingChainCount} menu items had no restaurant name.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );

      if (failures.length > 0) {
        setError(`Some location lookups failed. ${failures.join("; ")}`);
      }
    } catch (error) {
      setMessage("");
      setError(
        error instanceof Error
          ? error.message
          : "Unable to complete the search.",
      );
    } finally {
      setIsLoading(false);
    }
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
          onChange={() => {
            setError("");
            setMessage("");
            setGroups([]);
          }}
          onReset={() => {
            setError("");
            setMessage("");
            setGroups([]);
          }}
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
                className="flex-1 rounded-xl bg-emerald-800 px-5 py-3.5 font-semibold text-white transition hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-800"
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
        {groups.length > 0 && (
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
              {groups.map((group) => (
                <article
                  key={group.chain}
                  className="rounded-2xl border border-stone-200 bg-white p-6"
                >
                  <h3 className="text-xl font-semibold">{group.chain}</h3>

                  <h4 className="mt-4 font-medium">
                    Menu matches from Spoonacular
                  </h4>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
                    {group.items.map((item) => (
                      <li key={item.id}>{item.title}</li>
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
                        </li>
                      ))}
                    </ul>

                    {group.hasMore && (
                      <p className="mt-3 text-sm text-stone-500">
                        Additional location results have not been checked.
                      </p>
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
