const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const buildProfile = process.env.EAS_BUILD_PROFILE ?? "";
const isProductionBuild = buildProfile === "production";

export default ({ config }: { config: Record<string, any> }) => {
  const apiBaseUrl =
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    (!isProductionBuild ? config.extra?.apiBaseUrl ?? "http://10.0.2.2:4000" : undefined);

  if (!apiBaseUrl) {
    throw new Error("EXPO_PUBLIC_API_BASE_URL is required for production EAS builds.");
  }

  if (isProductionBuild && !mapsApiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is required for production EAS builds.");
  }

  return {
    ...config,
    android: {
      ...(config.android ?? {}),
      config: {
        ...(config.android?.config ?? {}),
        ...(mapsApiKey
          ? {
              googleMaps: {
                apiKey: mapsApiKey
              }
            }
          : {})
      }
    },
    extra: {
      ...(config.extra ?? {}),
      apiBaseUrl,
      googleMapsEnabled: Boolean(mapsApiKey)
    }
  };
};
