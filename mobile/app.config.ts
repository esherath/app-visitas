export default ({ config }: { config: Record<string, any> }) => ({
  ...config,
  extra: {
    ...(config.extra ?? {}),
    apiBaseUrl:
      process.env.EXPO_PUBLIC_API_BASE_URL ??
      config.extra?.apiBaseUrl ??
      "http://10.0.2.2:4000"
  }
});
