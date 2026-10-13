import type { DemoManifest } from "@/lib/kit/provenance";

/**
 * What the "Built with Unmap" panel and the header say about Trails. Lists only what the app really
 * calls; a service is added here in the same change that starts calling it.
 */
export const MANIFEST: DemoManifest = {
  slug: "trails",
  name: { en: "Trails · hiking explorer", fr: "Trails · explorateur de randonnées" },
  tagline: {
    en: "Day hikes around Banff and Lake Louise on a live Unmap outdoor map, with elevation profiles.",
    fr: "Randonnées d'un jour autour de Banff et de Lake Louise sur une carte plein air Unmap en direct, avec profils d'altitude.",
  },
  services: [
    {
      name: "Maps",
      role: {
        en: "The outdoor style under the trails: vector tiles with hillshade from the DEM, contour lines and trails, labels in the page's language.",
        fr: "Le style plein air sous les sentiers : tuiles vectorielles avec ombrage du relief, courbes de niveau et sentiers, étiquettes dans la langue de la page.",
      },
      calls: ['<Map apiKey={key} style="outdoor" lang={lang} />'],
      docs: "https://unmap.dev/docs/apis/maps",
    },
    {
      name: "Elevation",
      role: {
        en: "The elevation profile of the chosen trail (or your GPX file, when you ask): up to 500 points sampled along the line, gain, loss, lowest and highest, synced with the map.",
        fr: "Le profil d'altitude du sentier choisi (ou de votre fichier GPX, sur demande) : jusqu'à 500 points échantillonnés le long du tracé, dénivelés, point le plus bas et le plus haut, synchronisé avec la carte.",
      },
      calls: ["<ElevationProfile apiKey={key} line={trail} lang={lang} />  // GET /elevation?points=…"],
      docs: "https://unmap.dev/docs/apis/elevation",
    },
    {
      name: "Geocoding",
      role: {
        en: "Where you start from for directions: a city, address or place, as you type.",
        fr: "Votre point de départ pour l'itinéraire : une ville, une adresse ou un lieu, à la frappe.",
      },
      calls: ["<Geocoder apiKey={key} proximity={[-115.57, 51.18]} onSelect={…} />  // GET /geocode/autocomplete"],
      docs: "https://unmap.dev/docs/apis/geocoding",
    },
    {
      name: "Routing · Directions",
      role: {
        en: "The road route to the trailhead, with turn-by-turn steps in English or French and any warning the API attaches. Road routing only: not trail navigation.",
        fr: "L'itinéraire routier jusqu'au départ du sentier, étape par étape en français ou en anglais, avec les avertissements de l'API. Itinéraire routier seulement : pas de navigation en sentier.",
      },
      calls: ['unmap.router.route(origin, trailhead, { mode: "auto", steps: true, lang })'],
      docs: "https://unmap.dev/docs/apis/routing",
    },
  ],
  items: ["map", "geojson-layer", "route-line", "elevation-profile", "geocoder", "route-steps", "marker-popup", "map-controls"],
  provenance: [
    {
      kind: "dataset",
      label: {
        en: "Trail names, lines and published attributes, around Banff and Lake Louise",
        fr: "Noms, tracés et attributs publiés des sentiers, autour de Banff et de Lake Louise",
      },
      source: "Parks Canada, Trails APCA (open.canada.ca), fetched by scripts/fetch-trails.mjs",
      licence: "Open Government Licence - Canada",
      attribution: "Contains information licensed under the Open Government Licence - Canada. Source: Parks Canada, Trails APCA.",
      url: "https://open.canada.ca/data/en/dataset/64a90e8d-5bc0-4027-8645-b5881b4068d4",
    },
    {
      kind: "live",
      label: { en: "Elevation profiles, search results and road routes", fr: "Profils d'altitude, résultats de recherche et itinéraires routiers" },
      source: "Unmap",
      attribution: "Elevation: Mapterhorn and underlying suppliers. Routing © OpenStreetMap contributors",
    },
    {
      kind: "live",
      label: { en: "Basemap, hillshade and contours", fr: "Carte de base, ombrage et courbes de niveau" },
      source: "Unmap",
      attribution: "© unmap © OpenStreetMap contributors",
    },
  ],
  source: "https://github.com/unmap-dev/trail-explorer",
};
