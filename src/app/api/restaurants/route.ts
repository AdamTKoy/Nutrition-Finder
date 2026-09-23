type Place = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
};

type PlacesResponse = {
  places?: Place[];
  nextPageToken?: string;
};

// Calculate straight-line distance over the Earth's surface.
function distanceInMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;

  const deltaLat = radians(lat2 - lat1);
  const deltaLng = radians(lng2 - lng1);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(deltaLng / 2) ** 2;

  return 3958.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const chain = params.get("chain")?.trim() ?? "";
  const latText = params.get("lat")?.trim() ?? "";
  const lngText = params.get("lng")?.trim() ?? "";

  const lat = Number(latText);
  const lng = Number(lngText);

  if (!chain || chain.length > 150) {
    return Response.json(
      { error: "Provide a restaurant chain name of 1–150 characters." },
      { status: 400 },
    );
  }

  if (
    !latText ||
    !lngText ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return Response.json(
      { error: "Provide valid latitude and longitude coordinates." },
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

  try {
    const response = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": [
            "places.id",
            "places.displayName",
            "places.formattedAddress",
            "places.location",
            "nextPageToken",
          ].join(","),
        },
        body: JSON.stringify({
          textQuery: chain,
          pageSize: 20,
          locationBias: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: 8046.72,
            },
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      return Response.json(
        {
          error: "Google Places could not complete the search.",
          upstreamStatus: response.status,
        },
        { status: 502 },
      );
    }

    const data: PlacesResponse = await response.json();

    const restaurants = (data.places ?? [])
      .flatMap((place) => {
        if (!place.location) return [];

        const distanceMiles = distanceInMiles(
          lat,
          lng,
          place.location.latitude,
          place.location.longitude,
        );

        if (distanceMiles > 5) return [];

        return [{
          id: place.id,
          name: place.displayName?.text ?? "Unnamed location",
          address: place.formattedAddress ?? "",
          location: {
            lat: place.location.latitude,
            lng: place.location.longitude,
          },
          distanceMiles,
        }];
      })
      .sort((a, b) => a.distanceMiles - b.distanceMiles);

    return Response.json({
      chain,
      center: { lat, lng },
      restaurants,
      hasMore: Boolean(data.nextPageToken),
    });
  } catch {
    return Response.json(
      { error: "Unable to reach Google Places or read its response." },
      { status: 502 },
    );
  }
}