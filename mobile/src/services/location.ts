import * as Location from "expo-location";

export type DeviceLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
};

export async function getCurrentLocation(): Promise<DeviceLocation> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") {
    throw new Error("Permissao de localizacao negada");
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced
  });

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy ?? undefined
  };
}
