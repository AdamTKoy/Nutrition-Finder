// Translates user-supplied US zip code into latitude and longitude

type GeocodingResponse = {
  status: string;
  results: {
    formatted_address: string;
    partial_match?: boolean;
    address_components: {
      long_name: string;
      short_name: string;
      types: string[];
    }[];
    geometry: {
      location: {
        lat: number;
        lng: number;
      };
    };
  }[];
};

export async function GET(request: Request) {
  const zip = new URL(request.url).searchParams.get("zip")?.trim() ?? "";

  if (!/^\d{5}$/.test(zip)) {
    return Response.json(
      { error: "Enter a five-digit US ZIP code." },
      { status: 400 },
    );
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "GOOGLE_MAPS_SERVER_API_KEY is missing." },
      { status: 500 },
    );
  }

  const url = new URL(
    "https://maps.googleapis.com/maps/api/geocode/json",
  );

  url.searchParams.set("components", `postal_code:${zip}|country:US`);
  url.searchParams.set("key", apiKey);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return Response.json(
        {
          error: "Google could not complete the ZIP lookup.",
          upstreamStatus: response.status,
        },
        { status: 502 },
      );
    }

    const data: GeocodingResponse = await response.json();

    if (data.status === "ZERO_RESULTS") {
      return Response.json(
        { error: "No location was found for that ZIP code." },
        { status: 404 },
      );
    }

    // Google can report an API error even when HTTP status is 200.
    if (data.status !== "OK") {
      return Response.json(
        {
          error: "Google could not complete the ZIP lookup.",
          upstreamStatus: data.status,
        },
        { status: 502 },
      );
    }

    const match = data.results.find(
      (result) =>
        !result.partial_match &&
        result.address_components.some(
          (part) =>
            part.types.includes("postal_code") &&
            part.long_name === zip,
        ) &&
        result.address_components.some(
          (part) =>
            part.types.includes("country") &&
            part.short_name === "US",
        ),
    );

    if (!match) {
      return Response.json(
        { error: "No exact US ZIP-code match was found." },
        { status: 404 },
      );
    }

    return Response.json({
      zip,
      formattedAddress: match.formatted_address,
      location: match.geometry.location,
    });
  } catch {
    return Response.json(
      { error: "Unable to reach Google or read its response." },
      { status: 502 },
    );
  }
}