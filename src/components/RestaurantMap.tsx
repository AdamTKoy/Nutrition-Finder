// Integrating Google Map to visually plot restaurant search results

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  useMap,
} from "@vis.gl/react-google-maps";

type MapRestaurant = {
  id: string;
  name: string;
  address: string;
  location: {
    lat: number;
    lng: number;
  };
  distanceMiles: number;
};

type Props = {
  restaurants: MapRestaurant[];
};

// Adjust the viewport whenever the results change.
function FitResults({ restaurants }: Props) {
  const map = useMap();

  useEffect(() => {
    if (!map || restaurants.length === 0) return;

    if (restaurants.length === 1) {
      map.setCenter(restaurants[0].location);
      map.setZoom(14);
      return;
    }

    const bounds = new google.maps.LatLngBounds();

    for (const restaurant of restaurants) {
      bounds.extend(restaurant.location);
    }

    map.fitBounds(bounds, 60);
  }, [map, restaurants]);

  return null;
}

export default function RestaurantMap({ restaurants }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // A location may appear under multiple chain searches.
  // Google place IDs let us display each location only once.
  const locations = useMemo(
    () =>
      Array.from(
        new Map(
          restaurants.map((restaurant) => [restaurant.id, restaurant]),
        ).values(),
      ),
    [restaurants],
  );

  const selected = locations.find((restaurant) => restaurant.id === selectedId);

  if (locations.length === 0) return null;

  if (!apiKey) {
    return (
      <p role="alert" className="mt-5 text-sm text-red-800">
        Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to .env.local and restart the
        development server.
      </p>
    );
  }

  if (loadError) {
    return (
      <p role="alert" className="mt-5 text-sm text-red-800">
        The map could not load. Your restaurant results are still available
        below. Check the browser console for details.
      </p>
    );
  }

  return (
    <APIProvider apiKey={apiKey} onError={() => setLoadError(true)}>
      <div
        role="region"
        aria-label="Map of nearby restaurant candidates"
        className="mt-5 h-[420px] overflow-hidden rounded-2xl border border-stone-200"
      >
        <GoogleMap
          style={{ width: "100%", height: "100%" }}
          defaultCenter={locations[0].location}
          defaultZoom={12}
          maxZoom={17}
          mapId="DEMO_MAP_ID"
          gestureHandling="cooperative"
          onClick={() => setSelectedId(null)}
        >
          <FitResults restaurants={locations} />

          {locations.map((restaurant) => (
            <AdvancedMarker
              key={restaurant.id}
              position={restaurant.location}
              title={restaurant.name}
              onClick={() => setSelectedId(restaurant.id)}
            />
          ))}

          {selected && (
            <InfoWindow
              position={selected.location}
              onClose={() => setSelectedId(null)}
            >
              <div className="max-w-60 p-1 text-stone-900">
                <h3 className="font-semibold">{selected.name}</h3>
                <p className="mt-1 text-sm">{selected.address}</p>
                <p className="mt-2 text-sm">
                  {selected.distanceMiles.toFixed(1)} miles from the ZIP-code
                  center
                </p>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </div>
    </APIProvider>
  );
}
