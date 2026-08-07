import { ClientLocationInfo } from '../types.js';

interface FastlyServiceStatus {
  client: {
    ip: string;
    city: string;
    country_code: string;
    continent: string;
    region: string;
    proxy_type: string;
    proxy_description: string;
    as_name: string;
    conn_speed: string;
    conn_type: string;
    pop: string;
  };
}

interface FargateServiceStatus {
  region: string;
}

let cachedLocationInfo: ClientLocationInfo | null = null;

// Both probes are optional and describe *where the benchmark runs from*, which is
// only used to tag results. Point them at your own endpoints, or leave them unset:
// the benchmark then reports "unknown" for every geo field and runs normally.
const CLIENT_GEO_URL = process.env.CLIENT_GEO_URL?.trim();
const POP_REGION_URL = process.env.POP_REGION_URL?.trim();

const UNKNOWN_LOCATION: ClientLocationInfo = {
  country_code: 'unknown',
  continent: 'unknown',
  city: 'unknown',
  region: 'unknown',
  proxy_type: 'unknown',
  proxy_description: 'unknown',
  as_name: 'unknown',
  conn_speed: 'unknown',
  conn_type: 'unknown',
};

export async function getClientLocationInfo(): Promise<ClientLocationInfo> {
  // Return cached info if available
  if (cachedLocationInfo) {
    return cachedLocationInfo;
  }

  if (!CLIENT_GEO_URL) {
    return { ...UNKNOWN_LOCATION };
  }

  try {
    const geoResponse = await fetch(CLIENT_GEO_URL);
    if (!geoResponse.ok) {
      throw new Error(`Client geo endpoint returned ${geoResponse.status}`);
    }

    const data = (await geoResponse.json()) as FastlyServiceStatus;

    cachedLocationInfo = {
      country_code: data.client.country_code || 'unknown',
      continent: data.client.continent || 'unknown',
      city: data.client.city || 'unknown',
      proxy_type: data.client.proxy_type || 'unknown',
      proxy_description: data.client.proxy_description || 'unknown',
      as_name: data.client.as_name || 'unknown',
      conn_speed: data.client.conn_speed || 'unknown',
      conn_type: data.client.conn_type || 'unknown',
      region: data.client.region,
      ip: data.client.ip,
    };

    if (POP_REGION_URL) {
      const popResponse = await fetch(POP_REGION_URL);
      if (!popResponse.ok) {
        throw new Error(`PoP region endpoint returned ${popResponse.status}`);
      }

      const popData = (await popResponse.json()) as FargateServiceStatus;
      cachedLocationInfo.fargate_pop_region = popData.region;
    }

    return cachedLocationInfo;
  } catch (error) {
    console.warn('Failed to fetch client location info:', error);

    // Return default values if fetch fails
    return { ...UNKNOWN_LOCATION };
  }
}
