const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

export default ({ config }: { config: Record<string, any> }) => ({
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
    apiBaseUrl:
      process.env.EXPO_PUBLIC_API_BASE_URL ??
      config.extra?.apiBaseUrl ??
      "http://10.0.2.2:4000",
    googleMapsEnabled: Boolean(mapsApiKey)
  }
});
