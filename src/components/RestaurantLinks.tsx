// Make each location on map clickable with "View on Google Maps" and "Get directions" links
// - origin intentionally omitted so user may enter their own starting point independent on provided zip code

type Props = {
  restaurant: {
    id: string;
    name: string;
    address: string;
  };
};

export default function RestaurantLinks({ restaurant }: Props) {
  const destination = `${restaurant.name}, ${restaurant.address}`;

  const mapsParams = new URLSearchParams({
    api: "1",
    query: destination,
    query_place_id: restaurant.id,
  });

  const directionsParams = new URLSearchParams({
    api: "1",
    destination,
    destination_place_id: restaurant.id,
  });

  const linkClass =
    "text-sm font-medium text-emerald-800 underline underline-offset-4 hover:text-emerald-950";

  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
      <a
        href={`https://www.google.com/maps/search/?${mapsParams}`}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        aria-label={`View ${destination} on Google Maps (opens a new tab)`}
      >
        View on Google Maps
      </a>

      <a
        href={`https://www.google.com/maps/dir/?${directionsParams}`}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        aria-label={`Get directions to ${destination} (opens a new tab)`}
      >
        Get directions
      </a>
    </div>
  );
}
