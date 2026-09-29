# Nutrition Finder

This project is a continuation and enhancement from a group project I completed during my Stats+CS degree at UIUC. At that time in fall 2023, AI agents were not as common or robust as they are now, so we scrapped together a very primitive project that used homemade data and ineffective UI. With the help of ChatGPT, I set up a clean, simple front end using TypeScript and Tailwind CSS. We worked through everything step by step and I implemented all the changes myself (for learning + muscle memory). We also double-checked each step with automated and/or manual testing.

The final product is imperfect due to the strict limitation on free API calls to Spoonacular. But I believe these are the seeds for a great service that implements specific nutrition goals into eating out.

[![CI](https://github.com/AdamTKoy/Nutrition-Finder/actions/workflows/ci.yml/badge.svg)](https://github.com/AdamTKoy/Nutrition-Finder/actions/workflows/ci.yml)

Nutrition Finder helps users discover restaurant menu items that fit their protein, fat, and calorie preferences. Enter a food keyword and a US ZIP code to find matching restaurant locations within five miles of the ZIP-code center.

**[Try the live demo](https://nutrition-finder-eight.vercel.app/)**

This is a personal software development portfolio project. Live searches depend on third-party API quotas and may be temporarily unavailable when the daily allowance is exhausted. Automated tests use mocked responses and do not consume API quota.

<!-- TODO: Add desktop and mobile screenshots with descriptive alt text. -->

## Features

- Search by food keyword and five-digit US ZIP code.
- Set optional minimum and maximum protein, fat, and calorie limits. Blank fields mean no limit; zero is a valid value.
- View menu nutrition alongside matching nearby restaurant branches.
- Explore an interactive map with location details and Google Maps directions links.
- Load additional menu matches and restaurant locations without duplicate results.
- Retry temporary failures while preserving previously loaded results.
- Reset the form and results to start another search.
- Use a responsive form with accessible labels, keyboard controls, and status messages.

## How it works

```text
Food keyword + nutrition limits
  → Next.js menu-items route → Spoonacular menu matches

US ZIP code
  → Next.js geocode route → Google Geocoding → search center

Restaurant chains + search center
  → Next.js restaurants route → Google Places
  → chain-name matching + five-mile distance filtering
  → restaurant results + Google Maps markers
```

The browser calls three Next.js route handlers. Spoonacular and Google web-service credentials remain on the server. A separate, website-restricted browser key loads the Google Maps JavaScript API.

| Endpoint               | Purpose                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/menu-items`  | Validate keyword, nutrition limits, and pagination offset; request menu matches.             |
| `GET /api/geocode`     | Resolve a five-digit US ZIP code to a matching US location.                                  |
| `GET /api/restaurants` | Search for a chain near supplied coordinates and return matching branches within five miles. |

## Technical decisions

- **Explicit distance filtering:** Google Places receives a location bias, but the app independently calculates straight-line distances using the Haversine formula and excludes branches more than five miles away.
- **Conservative chain matching:** Names are normalized for capitalization, punctuation, and accents, with explicit aliases for known variations. Substring matches alone are not accepted, reducing unrelated business matches.
- **Separate pagination:** Menu items and restaurant branches have independent pagination. Items merge by Spoonacular ID; branches merge by Google place ID.
- **Search-session reuse:** Successful chain lookups, including empty pages, are kept in memory for the current search. Additional menu pages reuse those results. This is not a persistent or shared cache.
- **Recoverable failures:** A failed page does not replace existing results. Retrying requests the same menu offset or location token. Quota exhaustion has separate handling that stops further menu requests in the current page session.
- **Separate credentials:** Browser and server Google keys serve different APIs and use different restriction strategies. Only the browser key has a `NEXT_PUBLIC_` prefix.

## Technology stack

| Area                            | Tools                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| Application                     | Next.js App Router, React, TypeScript                                                    |
| Styling                         | Tailwind CSS                                                                             |
| Menu data                       | Spoonacular                                                                              |
| Location and maps               | Google Geocoding API, Places API (New), Maps JavaScript API, `@vis.gl/react-google-maps` |
| Unit and endpoint tests         | Vitest                                                                                   |
| Browser and accessibility tests | Playwright, axe-core                                                                     |
| Continuous integration          | GitHub Actions                                                                           |
| Hosting                         | Vercel                                                                                   |

## Local setup

### Prerequisites

- Node.js 24; `.nvmrc` records the development version.
- npm and, optionally, nvm to select the Node.js version.
- A Spoonacular API key for live menu searches.
- A Google Cloud project with billing configured and Geocoding API, Places API (New), and Maps JavaScript API enabled for live searches and maps.

### Install and configure

```bash
git clone https://github.com/AdamTKoy/Nutrition-Finder.git
cd Nutrition-Finder
nvm install
nvm use
npm ci
```

If you do not use nvm, install Node.js 24 before running `npm ci`.

Create `.env.local` in the project root:

```dotenv
SPOONACULAR_API_KEY=your_spoonacular_key
GOOGLE_MAPS_SERVER_API_KEY=your_google_server_key
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_browser_key
```

| Variable                          | API access and restrictions                                                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPOONACULAR_API_KEY`             | Spoonacular menu search; server-only.                                                                                                                                                           |
| `GOOGLE_MAPS_SERVER_API_KEY`      | Restrict API access to Geocoding API and Places API (New). For local development, use your public outbound IP as the IP application restriction.                                                |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Restrict API access to Maps JavaScript API and website access to `http://localhost:3000` and `http://localhost:3000/*`. Add the corresponding `127.0.0.1` entries only if you use that address. |

The browser key is intentionally public and must have website restrictions. Never prefix either server key with `NEXT_PUBLIC_`. `.env.local` is ignored by Git; do not commit real credentials.

Start the app:

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000). Restart the development server after changing environment variables.

## Testing

Run unit and endpoint tests:

```bash
npm test
```

For watch mode, use `npm run test:watch`.

Install Chromium once, then run browser tests:

```bash
npx playwright install chromium
npm run test:e2e
```

Stop the development server before browser tests: Playwright builds the app and starts a production server at `http://127.0.0.1:3100`, using the same `.next` build directory. On Linux, system dependencies may also be needed; CI uses `npx playwright install --with-deps chromium`.

The browser suite mocks API responses, blocks external browser requests, and starts the app with empty API keys. The live Google map is not exercised. Endpoint tests also mock upstream requests. No real API credentials are needed for the automated suite.

Other checks:

```bash
npm run lint
npx tsc --noEmit
```

Run the TypeScript check after the browser suite or `npm run build` so Next.js's generated types are available. To watch browser tests, use `npm run test:e2e:headed`.

### Coverage and CI

- Distance calculations and restaurant-chain name matching.
- Endpoint validation, upstream failures, malformed responses, and quota exhaustion.
- Search filters, reset behavior, pagination, and deduplication.
- Retries that preserve results and pagination state.
- Finding branches after an initially empty location page.
- Narrow-screen horizontal overflow and keyboard navigation.
- axe accessibility scans of the initial form and loaded results at desktop and mobile widths.

GitHub Actions runs lint, unit and endpoint tests, the production build through Playwright, browser and accessibility tests, and TypeScript checks on pushes and pull requests. Browser reports are retained as workflow artifacts for seven days. See the [CI workflow](.github/workflows/ci.yml).

## Deployment

The app is hosted on Vercel with Node.js 24. Configure the three environment variables above for Production and redeploy after changing them. The browser key is included at build time.

The production browser key permits `https://nutrition-finder-eight.vercel.app` and `https://nutrition-finder-eight.vercel.app/*`. Use the stable production domain to try the map; deployment-specific Vercel URLs are not included in those restrictions.

Production uses a separate Google server key restricted to Geocoding API and Places API (New). Vercel's default dynamic outbound IPs prevent reusing the local IP allowlist, so the current production server key has no IP application restriction. It remains server-only. This is a deployment tradeoff, not protection against requests to the app's public endpoints.

## Known limitations

- Distances are straight-line measurements from the ZIP-code center, not driving distances or distances from a user's exact position.
- Chain-level menu matches do not confirm availability at an individual branch.
- Nutrition data comes from Spoonacular and may be incomplete; serving sizes vary by item.
- Results depend on provider coverage and the pages retrieved. Menu pagination stops at 1,000 items, and additional location pages require user interaction.
- Conservative name matching can omit valid branches with unrecognized name variations.
- API quotas can temporarily prevent searches. UI quota handling does not provide server-side rate limiting or a spending cap.
- The map currently uses `DEMO_MAP_ID`; a project-specific production map ID is still planned.
- Automated accessibility checks cover selected states and do not replace manual assessment. Live integrations, including the Google map, require separate manual checks.

## Future improvements

These are proposed improvements, not currently implemented features:

- Add server-side quota protection and request limits.
- Provide a clearly labeled sample-data mode when live API access is unavailable.
- Configure a project-specific Google Maps map ID.
- Improve loading feedback during multi-chain lookups.
