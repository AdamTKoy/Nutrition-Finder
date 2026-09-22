"use client";

import { useState, type SubmitEvent } from "react";

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

const nutrients = [
  { key: "protein", label: "Protein", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
  { key: "calories", label: "Calories", unit: "kcal" },
] as const;

export default function Home() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isLoading) return;

    setError("");
    setMessage("");
    setItems([]);

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
      const response = await fetch(`/api/menu-items?${params.toString()}`);
      const result: MenuSearchResponse = await response.json();

      if (!response.ok) {
        const details = result.upstreamStatus
          ? ` (Spoonacular status: ${result.upstreamStatus})`
          : "";

        throw new Error(
          (result.error ?? "The search failed. Please try again.") + details,
        );
      }

      if (!Array.isArray(result.menuItems)) {
        throw new Error("The server returned an unexpected response.");
      }

      setItems(result.menuItems);
      setMessage(
        result.menuItems.length === 0
          ? "No menu items matched. Try another keyword or broader limits."
          : `Showing ${result.menuItems.length} matching menu items. Nearby locations have not been checked yet.`,
      );
    } catch (error) {
      setMessage("");
      setError(
        error instanceof Error
          ? error.message
          : "Unable to complete the search. Please try again.",
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
            setItems([]);
          }}
          onReset={() => {
            setError("");
            setMessage("");
            setItems([]);
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
                {isLoading ? "Searching…" : "Search menu items"}
              </button>
            </div>
            <p className="text-center text-sm text-stone-500">
              Menu matches only · Nearby locations and maps are coming next.
            </p>
            <p role="status" className="text-sm leading-6 text-emerald-800">
              {message}
            </p>
          </fieldset>
        </form>
        {items.length > 0 && (
          <section aria-labelledby="results-heading" className="mt-10">
            <h2 id="results-heading" className="text-2xl font-semibold">
              Matching menu items
            </h2>

            <ul className="mt-4 space-y-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-stone-200 bg-white p-5"
                >
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm text-stone-600">
                    {item.restaurantChain || "Restaurant not provided"}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
