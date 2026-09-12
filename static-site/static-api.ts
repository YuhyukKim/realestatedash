import { createStaticApi } from "../lib/pages-api.mjs";
import { getNearbyStations, STATION_DISTANCE_NOTE } from "../app/stations";
// Public prefix only: API credentials never enter the browser bundle.
export const staticApi = createStaticApi({base:import.meta.env.BASE_URL,nearbyStations:getNearbyStations,stationNote:STATION_DISTANCE_NOTE});
