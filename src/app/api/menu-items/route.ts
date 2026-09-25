export async function GET(request: Request) {
  const apiKey = process.env.SPOONACULAR_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "SPOONACULAR_API_KEY is missing." },
      { status: 500 },
    );
  }

  const url = new URL(
    "https://api.spoonacular.com/food/menuItems/search",
  );

  const incoming = new URL(request.url).searchParams;

  const offset = Number(incoming.get("offset") ?? "0");

  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 990 ||
    offset % 10 !== 0
  ) {
    return Response.json(
      { error: "Offset must be a multiple of 10 between 0 and 990." },
      { status: 400 },
    );
  }

  url.searchParams.set("offset", String(offset));

  const keyword = incoming.get("keyword")?.trim() ?? "";

  if (!keyword) {
    return Response.json(
        { error: "A food keyword is required." },
        { status: 400 },
    );
  }

  url.searchParams.set("query", keyword);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("number", "10");
  url.searchParams.set("addMenuItemInformation", "true");

  for (const nutrient of ["Protein", "Fat", "Calories"] as const) {
    const minName = `min${nutrient}`;
    const maxName = `max${nutrient}`;

    const minText = incoming.get(minName)?.trim() ?? "";
    const maxText = incoming.get(maxName)?.trim() ?? "";

    const min = minText === "" ? undefined : Number(minText);
    const max = maxText === "" ? undefined : Number(maxText);

    // Validate again on the server: requests can bypass the form.
    if (
        [min, max].some(
        (value) =>
            value !== undefined &&
            (!Number.isFinite(value) || value < 0),
        )
    ) {
        return Response.json(
        { error: `${nutrient} limits must be nonnegative numbers.` },
        { status: 400 },
        );
    }

    if (min !== undefined && max !== undefined && min > max) {
        return Response.json(
        {
            error: `${nutrient}: the minimum must not exceed the maximum.`,
        },
        { status: 400 },
        );
    }

    if (min !== undefined) {
        url.searchParams.set(minName, String(min));
    }

    if (max !== undefined) {
        url.searchParams.set(maxName, String(max));
    }
  }

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return Response.json(
        {
          error: "Spoonacular could not complete the request.",
          upstreamStatus: response.status,
        },
        { status: 502 },
      );
    }

    const data = await response.json();
    return Response.json(data);
  } catch {
    return Response.json(
      { error: "Unable to reach Spoonacular or read its response." },
      { status: 502 },
    );
  }
}