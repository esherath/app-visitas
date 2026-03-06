import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  type AppStateStatus,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View
} from "react-native";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import Constants from "expo-constants";
import MapView, { Marker } from "react-native-maps";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  addClientToQueue,
  addVisitToQueue,
  countUnsyncedVisits,
  getCachedClients,
  getSetting,
  initDb,
  listRecentLocalVisits,
  replaceClientsCache,
  setSetting,
  upsertClientCache
} from "./db/database";
import { getCurrentLocation } from "./services/location";
import { retryVisitSync, syncPendingVisits } from "./services/sync";
import { API_BASE_URL } from "./services/config";
import {
  createOrganization,
  createClient,
  fetchAdminSellers,
  fetchAdminVisits,
  fetchClients,
  fetchOrganizations,
  fetchVisits,
  syncGhlContacts,
  updateAdminSellerGhlUserId,
  updateOrganization,
  type AdminVisitItem,
  type OrganizationItem,
  type SellerItem
} from "./services/api";
import {
  clearAuthToken,
  getAuthToken,
  login,
  me,
  saveAuthToken,
  type AuthUser
} from "./services/auth";
import type { ClientItem, PendingVisit } from "./types";

type ActiveTab = "VISITA" | "HISTORICO" | "MAPA" | "GERENCIA" | "CONFIG";
type AuthAccessMode = "COMPANY" | "MASTER";
type HistoryPreset = "TODAY" | "7D" | "15D" | "30D" | "CUSTOM";
type HistorySource = "LOCAL" | "SERVER";
type VisitItem = PendingVisit & {
  client?: { id: string; name: string };
  seller?: { id: string; name: string; email: string };
};
type VisitCoordinate = {
  latitude: number;
  longitude: number;
};
type OrganizationEditorState = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string;
  ghlApiBaseUrl: string;
  ghlLocationId: string;
  ghlAccessToken: string;
  ghlContactSyncMaxPages: string;
  ghlVisitsObjectKey: string;
  ghlVisitsFieldClientNameKey: string;
  ghlVisitsFieldOwnerKey: string;
  ghlVisitsFieldVisitDateKey: string;
  ghlVisitsFieldNotesKey: string;
  ghlVisitsFieldTitleKey: string;
};
const MAX_MAP_MARKERS = 300;
const CONTACT_SILENT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

function makeLocalVisitId() {
  return `local-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function makeLocalClientId() {
  return `local-client-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function createEmptyOrganizationEditor(): OrganizationEditorState {
  return {
    id: "",
    name: "",
    slug: "",
    logoUrl: "",
    ghlApiBaseUrl: "",
    ghlLocationId: "",
    ghlAccessToken: "",
    ghlContactSyncMaxPages: "",
    ghlVisitsObjectKey: "",
    ghlVisitsFieldClientNameKey: "",
    ghlVisitsFieldOwnerKey: "",
    ghlVisitsFieldVisitDateKey: "",
    ghlVisitsFieldNotesKey: "",
    ghlVisitsFieldTitleKey: ""
  };
}

function contactSyncSettingKey(userId: string) {
  return `contacts_last_sync_at:${userId}`;
}

function statusColor(status: PendingVisit["syncStatus"]) {
  if (status === "SYNCED") {
    return "#0e7490";
  }
  if (status === "FAILED") {
    return "#b91c1c";
  }
  return "#c28012";
}

function statusLabel(status: PendingVisit["syncStatus"]) {
  if (status === "SYNCED") {
    return "TRANSMITIDO";
  }
  if (status === "FAILED") {
    return "FALHA";
  }
  return "PENDENTE";
}

function startOfDay(date = new Date()) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date = new Date()) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function toIsoDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toValidCoordinate(input: { latitude: unknown; longitude: unknown }): VisitCoordinate | null {
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }

  return { latitude, longitude };
}

function tabLabel(tab: ActiveTab) {
  if (tab === "VISITA") {
    return "Check";
  }
  if (tab === "HISTORICO") {
    return "Timeline";
  }
  if (tab === "MAPA") {
    return "Mapa";
  }
  if (tab === "GERENCIA") {
    return "Gestão";
  }
  return "Config";
}

function renderTabIcon(tab: ActiveTab, color: string, size: number) {
  if (tab === "VISITA") {
    return <MaterialCommunityIcons name="flag-variant" size={size} color={color} />;
  }
  if (tab === "HISTORICO") {
    return <Ionicons name="time-outline" size={size} color={color} />;
  }
  if (tab === "MAPA") {
    return <Ionicons name="location-outline" size={size} color={color} />;
  }
  if (tab === "GERENCIA") {
    return <MaterialCommunityIcons name="chart-bar" size={size} color={color} />;
  }
  return <Ionicons name="settings-outline" size={size} color={color} />;
}

function LoginRouteAnimation({ isTablet }: { isTablet: boolean }) {
  const travel = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const travelLoop = Animated.loop(
      Animated.timing(travel, {
        toValue: 1,
        duration: 3600,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true
      })
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true
        })
      ])
    );
    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 1700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 1700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true
        })
      ])
    );

    travelLoop.start();
    pulseLoop.start();
    shimmerLoop.start();

    return () => {
      travelLoop.stop();
      pulseLoop.stop();
      shimmerLoop.stop();
    };
  }, [pulse, shimmer, travel]);

  const markerTranslateX = travel.interpolate({
    inputRange: [0, 0.32, 0.68, 1],
    outputRange: [-96, -18, 42, 104]
  });
  const markerTranslateY = travel.interpolate({
    inputRange: [0, 0.32, 0.68, 1],
    outputRange: [20, -18, 8, -18]
  });
  const markerScale = travel.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [0.92, 1.08, 0.96]
  });
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1.8]
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.38, 0]
  });
  const shimmerOpacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 0.65]
  });

  return (
    <View style={[styles.loginRouteHero, isTablet && styles.loginRouteHeroTablet]}>
      <LinearGradient
        colors={["#fbfeff", "#edf9fe"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.loginRouteShell}
      >
        <Animated.View style={[styles.loginRouteGlow, { opacity: shimmerOpacity }]} />
        <View style={styles.loginRouteGrid}>
          <View style={styles.loginRouteGridDot} />
          <View style={styles.loginRouteGridDot} />
          <View style={styles.loginRouteGridDot} />
          <View style={styles.loginRouteGridDot} />
          <View style={styles.loginRouteGridDot} />
          <View style={styles.loginRouteGridDot} />
        </View>

        <View style={[styles.routeConnector, styles.routeConnectorLeft]} />
        <View style={[styles.routeConnector, styles.routeConnectorMiddle]} />
        <View style={[styles.routeConnector, styles.routeConnectorRight]} />

        <View style={[styles.routeNode, styles.routeNodeOrigin]}>
          <View style={styles.routeNodeIconWrap}>
            <MaterialCommunityIcons name="office-building-outline" size={16} color="#0b84b7" />
          </View>
          <Text style={styles.routeNodeLabel}>empresa</Text>
        </View>

        <View style={[styles.routeNode, styles.routeNodeMid]}>
          <View style={styles.routeNodeIconWrap}>
            <Ionicons name="navigate-outline" size={16} color="#0b84b7" />
          </View>
          <Text style={styles.routeNodeLabel}>rota</Text>
        </View>

        <View style={[styles.routeNode, styles.routeNodeDestination]}>
          <Animated.View
            style={[
              styles.routePulse,
              {
                opacity: pulseOpacity,
                transform: [{ scale: pulseScale }]
              }
            ]}
          />
          <View style={[styles.routeNodeIconWrap, styles.routeNodeIconWrapDestination]}>
            <MaterialCommunityIcons name="flag-checkered" size={16} color="#ffffff" />
          </View>
          <Text style={styles.routeNodeLabel}>check-in</Text>
        </View>

        <Animated.View
          style={[
            styles.routeMarker,
            {
              transform: [
                { translateX: markerTranslateX },
                { translateY: markerTranslateY },
                { scale: markerScale }
              ]
            }
          ]}
        >
          <Ionicons name="location-sharp" size={18} color="#ffffff" />
        </Animated.View>
      </LinearGradient>
    </View>
  );
}

export default function App() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [activeTab, setActiveTab] = useState<ActiveTab>("VISITA");
  const [apiBaseUrl, setApiBaseUrl] = useState(API_BASE_URL);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authAccessMode, setAuthAccessMode] = useState<AuthAccessMode>("COMPANY");
  const [authLoading, setAuthLoading] = useState(false);

  const [authLogin, setAuthLogin] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [authOrganizationSlug, setAuthOrganizationSlug] = useState("");

  const [clients, setClients] = useState<ClientItem[]>([]);
  const [contactQuery, setContactQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [visitModalVisible, setVisitModalVisible] = useState(false);
  const [createClientModalVisible, setCreateClientModalVisible] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [localHistory, setLocalHistory] = useState<PendingVisit[]>([]);
  const [serverHistory, setServerHistory] = useState<VisitItem[]>([]);
  const [managerHistory, setManagerHistory] = useState<AdminVisitItem[]>([]);
  const [managerSellers, setManagerSellers] = useState<SellerItem[]>([]);
  const [managerSellerGhlInputs, setManagerSellerGhlInputs] = useState<Record<string, string>>({});
  const [savingSellerId, setSavingSellerId] = useState<string | null>(null);
  const [managerSellerId, setManagerSellerId] = useState("");
  const [managerLoading, setManagerLoading] = useState(false);
  const [organizations, setOrganizations] = useState<OrganizationItem[]>([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [organizationNameInput, setOrganizationNameInput] = useState("");
  const [organizationSlugInput, setOrganizationSlugInput] = useState("");
  const [organizationLogoUrlInput, setOrganizationLogoUrlInput] = useState("");
  const [organizationAdminNameInput, setOrganizationAdminNameInput] = useState("");
  const [organizationAdminEmailInput, setOrganizationAdminEmailInput] = useState("");
  const [organizationAdminPasswordInput, setOrganizationAdminPasswordInput] = useState("");
  const [organizationEditorVisible, setOrganizationEditorVisible] = useState(false);
  const [organizationEditorSaving, setOrganizationEditorSaving] = useState(false);
  const [organizationEditor, setOrganizationEditor] = useState<OrganizationEditorState>(
    createEmptyOrganizationEditor()
  );
  const [historyPreset, setHistoryPreset] = useState<HistoryPreset>("7D");
  const [historySource, setHistorySource] = useState<HistorySource>("LOCAL");
  const [historyDetail, setHistoryDetail] = useState<VisitItem | null>(null);
  const [customFromDate, setCustomFromDate] = useState<Date>(startOfDay(new Date()));
  const [customToDate, setCustomToDate] = useState<Date>(endOfDay(new Date()));
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [visitNotes, setVisitNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingGhl, setSyncingGhl] = useState(false);
  const [testingApi, setTestingApi] = useState(false);
  const [loadingClients, setLoadingClients] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastLocation, setLastLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [lastSyncText, setLastSyncText] = useState("Sem sincronização recente");
  const [logoFailed, setLogoFailed] = useState(false);
  const googleMapsEnabled = Boolean(
    (Constants.expoConfig?.extra as { googleMapsEnabled?: boolean } | undefined)?.googleMapsEnabled
  );
  const isExpoGo = Constants.appOwnership === "expo";
  const canRenderMap = googleMapsEnabled || isExpoGo;
  const organizationLogoUrl = user?.organizationLogoUrl?.trim() || "";
  const silentContactSyncRef = useRef(false);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId),
    [clients, selectedClientId]
  );
  const upsertClientInState = useCallback((nextClient: ClientItem) => {
    setClients((previous) => {
      const filtered = previous.filter((item) => item.id !== nextClient.id);
      const merged = [nextClient, ...filtered];
      return merged.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    });
  }, []);

  const contactNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients) {
      map.set(client.id, client.name);
    }
    for (const visit of serverHistory) {
      const name = visit.clientName || visit.client?.name;
      if (visit.clientId && name) {
        map.set(visit.clientId, name);
      }
    }
    return map;
  }, [clients, serverHistory]);

  const getVisitDisplayName = useCallback(
    (visit: PendingVisit & { client?: { id: string; name: string } }) =>
      visit.clientName || visit.client?.name || contactNameById.get(visit.clientId) || "Contato sem nome",
    [contactNameById]
  );

  const canSubmit = useMemo(
    () => Boolean(token && user && selectedClientId.trim() && visitNotes.trim()) && !loading,
    [token, user, selectedClientId, visitNotes, loading]
  );
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const isMaster = user?.role === "MASTER" || user?.role === "SUPER_ADMIN";
  const canManageOrganizations = user?.role === "SUPER_ADMIN";
  const availableTabs = useMemo(
    () =>
      isSuperAdmin
        ? (["CONFIG"] as ActiveTab[])
        : isMaster
          ? (["HISTORICO", "MAPA", "VISITA", "GERENCIA", "CONFIG"] as ActiveTab[])
        : (["HISTORICO", "VISITA", "MAPA", "CONFIG"] as ActiveTab[]),
    [isMaster, isSuperAdmin]
  );

  const { historyFrom, historyTo } = useMemo(() => {
    if (historyPreset === "CUSTOM") {
      return {
        historyFrom: startOfDay(customFromDate),
        historyTo: endOfDay(customToDate)
      };
    }

    const now = new Date();
    if (historyPreset === "TODAY") {
      return { historyFrom: startOfDay(now), historyTo: endOfDay(now) };
    }

    const days = historyPreset === "7D" ? 7 : historyPreset === "15D" ? 15 : 30;
    const start = startOfDay(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
    return { historyFrom: start, historyTo: endOfDay(now) };
  }, [customFromDate, customToDate, historyPreset]);

  const filteredLocalHistory = useMemo(
    () =>
      localHistory.filter((visit) => {
        const date = new Date(visit.checkInAt);
        if (historyFrom && date < historyFrom) {
          return false;
        }
        if (historyTo && date > historyTo) {
          return false;
        }
        return true;
      }),
    [historyFrom, historyTo, localHistory]
  );

  const filteredServerHistory = useMemo(
    () =>
      serverHistory.filter((visit) => {
        const date = new Date(visit.checkInAt);
        if (historyFrom && date < historyFrom) {
          return false;
        }
        if (historyTo && date > historyTo) {
          return false;
        }
        return true;
      }),
    [historyFrom, historyTo, serverHistory]
  );

  const mapPoints = useMemo(() => {
    const merged = [...filteredServerHistory, ...filteredLocalHistory];
    const byId = new Map<string, PendingVisit>();
    for (const visit of merged) {
      byId.set(visit.localVisitId, visit);
    }
    return Array.from(byId.values());
  }, [filteredLocalHistory, filteredServerHistory]);
  const mapMarkers = useMemo(
    () =>
      mapPoints
        .map((visit) => {
          const coordinate = toValidCoordinate(visit);
          if (!coordinate) {
            return null;
          }
          return { visit, coordinate };
        })
        .filter((item): item is { visit: PendingVisit; coordinate: VisitCoordinate } => item !== null)
        .sort((a, b) => new Date(b.visit.checkInAt).getTime() - new Date(a.visit.checkInAt).getTime())
        .slice(0, MAX_MAP_MARKERS),
    [mapPoints]
  );
  const historyDetailCoordinate = useMemo(
    () => (historyDetail ? toValidCoordinate(historyDetail) : null),
    [historyDetail]
  );

  const displayedHistory = historySource === "LOCAL" ? filteredLocalHistory : filteredServerHistory;
  const filteredManagerHistory = useMemo(
    () =>
      managerHistory.filter((visit) => {
        if (managerSellerId && visit.sellerId !== managerSellerId) {
          return false;
        }
        const date = new Date(visit.checkInAt);
        if (historyFrom && date < historyFrom) {
          return false;
        }
        if (historyTo && date > historyTo) {
          return false;
        }
        return true;
      }),
    [historyFrom, historyTo, managerHistory, managerSellerId]
  );

  const refreshLocalData = useCallback(async () => {
    const [total, recent] = await Promise.all([countUnsyncedVisits(), listRecentLocalVisits(20)]);
    setPendingCount(total);
    setLocalHistory(recent);
    if (!lastLocation && recent[0]) {
      setLastLocation({
        latitude: recent[0].latitude,
        longitude: recent[0].longitude
      });
    }
  }, [lastLocation]);

  const refreshClients = useCallback(async (query?: string, options?: { silent?: boolean }) => {
    if (!token || !user) {
      return;
    }
    if (!options?.silent) {
      setLoadingClients(true);
    }
    try {
      const data = await fetchClients({ apiBaseUrl, token }, query);
      setClients(data);
      if (!selectedClientId && data[0]) {
        setSelectedClientId(data[0].id);
      }
      if (!query || query.trim().length === 0) {
        await replaceClientsCache(user.id, data);
      }
    } catch (error) {
      if (!query || query.trim().length === 0) {
        const cached = await getCachedClients(user.id);
        setClients(cached);
        if (!selectedClientId && cached[0]) {
          setSelectedClientId(cached[0].id);
        }
        if (!cached.length && !options?.silent) {
          Alert.alert("Clientes", error instanceof Error ? error.message : "Falha ao carregar clientes");
        }
      } else if (!options?.silent) {
        Alert.alert("Busca", error instanceof Error ? error.message : "Falha ao buscar contatos");
      }
    } finally {
      setLoadingClients(false);
    }
  }, [apiBaseUrl, selectedClientId, token, user]);

  const warmClientsCache = useCallback(async () => {
    if (!token || !user) {
      return;
    }

    try {
      const data = await fetchClients({ apiBaseUrl, token });
      await replaceClientsCache(user.id, data);
    } catch {
      // Silent background warmup should not interrupt the seller flow.
    }
  }, [apiBaseUrl, token, user]);

  const refreshServerHistory = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const visits = await fetchVisits({ apiBaseUrl, token }, 30);
      setServerHistory(visits);
    } catch {
      setServerHistory([]);
    }
  }, [apiBaseUrl, token]);

  const refreshManagerData = useCallback(async () => {
    if (!token || !isMaster || isSuperAdmin) {
      return;
    }
    setManagerLoading(true);
    try {
      const [sellers, visits] = await Promise.all([
        fetchAdminSellers({ apiBaseUrl, token }),
        fetchAdminVisits({ apiBaseUrl, token }, { limit: 1000 })
      ]);
      setManagerSellers(sellers);
      setManagerSellerGhlInputs(
        sellers.reduce<Record<string, string>>((accumulator, seller) => {
          accumulator[seller.id] = seller.ghlUserId ?? "";
          return accumulator;
        }, {})
      );
      setManagerHistory(visits);
    } catch (error) {
      Alert.alert("Gerencia", error instanceof Error ? error.message : "Falha ao carregar dados");
    } finally {
      setManagerLoading(false);
    }
  }, [apiBaseUrl, isMaster, isSuperAdmin, token]);

  const refreshOrganizations = useCallback(async () => {
    if (!token || !canManageOrganizations) {
      setOrganizations([]);
      return;
    }

    setOrganizationsLoading(true);
    try {
      const list = await fetchOrganizations({ apiBaseUrl, token });
      setOrganizations(list);
    } catch (error) {
      Alert.alert("Empresas", error instanceof Error ? error.message : "Falha ao carregar empresas");
    } finally {
      setOrganizationsLoading(false);
    }
  }, [apiBaseUrl, canManageOrganizations, token]);

  const runSync = useCallback(async (options?: { silent?: boolean }) => {
    if (!token) {
      return;
    }
    setSyncing(true);
    try {
      const result = await syncPendingVisits(apiBaseUrl, token);
      await refreshLocalData();
      await refreshServerHistory();
      if (contactQuery.trim().length >= 2) {
        await refreshClients(contactQuery.trim());
      }
      if (!result.skipped && !options?.silent) {
        Alert.alert("Sincronização", `Sincronizadas: ${result.synced} | Falhas: ${result.failed}`);
      }
      if (!result.skipped) {
        const now = new Date();
        setLastSyncText(
          `${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} | ${result.synced} ok / ${result.failed} falhas`
        );
      }
    } catch (error) {
      if (!options?.silent) {
        Alert.alert("Erro de sync", error instanceof Error ? error.message : "Erro inesperado");
      }
      setLastSyncText("Sincronização com erro");
    } finally {
      setSyncing(false);
    }
  }, [apiBaseUrl, contactQuery, refreshClients, refreshLocalData, refreshServerHistory, token]);

  const runSilentContactSync = useCallback(async () => {
    if (!token || !user || isSuperAdmin || online === false || syncingGhl) {
      return;
    }
    if (silentContactSyncRef.current) {
      return;
    }

    const syncKey = contactSyncSettingKey(user.id);
    const lastSyncAt = await getSetting(syncKey);
    const lastSyncMs = lastSyncAt ? new Date(lastSyncAt).getTime() : NaN;
    const syncIsFresh =
      Number.isFinite(lastSyncMs) && Date.now() - lastSyncMs < CONTACT_SILENT_SYNC_INTERVAL_MS;

    if (syncIsFresh) {
      return;
    }

    silentContactSyncRef.current = true;
    try {
      await syncGhlContacts({ apiBaseUrl, token }, { fullSync: false });
      await setSetting(syncKey, new Date().toISOString());

      const query = contactQuery.trim();
      if (query.length >= 2) {
        await refreshClients(query, { silent: true });
      } else {
        await warmClientsCache();
      }
    } catch {
      // Silent sync failures stay quiet; the manual action remains available in CONFIG.
    } finally {
      silentContactSyncRef.current = false;
    }
  }, [apiBaseUrl, contactQuery, isSuperAdmin, online, refreshClients, syncingGhl, token, user, warmClientsCache]);

  const bootstrap = useCallback(async () => {
    await initDb();
    const [savedApiBase, savedToken] = await Promise.all([
      getSetting("api_base_url"),
      getAuthToken()
    ]);

    const normalizedApi = savedApiBase?.trim() || API_BASE_URL;
    setApiBaseUrl(normalizedApi);

    if (savedToken) {
      try {
        const currentUser = await me(normalizedApi, savedToken);
        setToken(savedToken);
        setUser(currentUser);
      } catch {
        await clearAuthToken();
      }
    }

    await refreshLocalData();
  }, [refreshLocalData]);

  useEffect(() => {
    bootstrap().catch((error) => {
      Alert.alert("Erro ao inicializar", error instanceof Error ? error.message : "Erro inesperado");
    });
  }, [bootstrap]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setOnline(Boolean(state.isConnected));
      if (state.isConnected && token) {
        runSync({ silent: true }).catch(() => undefined);
        runSilentContactSync().catch(() => undefined);
      }
    });

    return () => unsubscribe();
  }, [runSilentContactSync, runSync, token]);

  useEffect(() => {
    if (!token || !user || isSuperAdmin || online === false) {
      return;
    }

    runSilentContactSync().catch(() => undefined);
  }, [isSuperAdmin, online, runSilentContactSync, token, user]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active") {
        runSilentContactSync().catch(() => undefined);
      }
    });

    return () => subscription.remove();
  }, [runSilentContactSync]);

  useEffect(() => {
    refreshServerHistory().catch(() => undefined);
  }, [refreshServerHistory]);

  useEffect(() => {
    refreshManagerData().catch(() => undefined);
  }, [refreshManagerData]);

  useEffect(() => {
    refreshOrganizations().catch(() => undefined);
  }, [refreshOrganizations]);

  useEffect(() => {
    setLogoFailed(false);
  }, [organizationLogoUrl]);

  useEffect(() => {
    if ((!isMaster || isSuperAdmin) && activeTab === "GERENCIA") {
      setActiveTab("VISITA");
    }
    if (isSuperAdmin && activeTab !== "CONFIG") {
      setActiveTab("CONFIG");
    }
  }, [activeTab, isMaster, isSuperAdmin]);

  const handleSearchContacts = useCallback(async () => {
    const query = contactQuery.trim();
    if (query.length < 2) {
      setClients([]);
      setSelectedClientId("");
      return;
    }
    await refreshClients(query);
  }, [contactQuery, refreshClients]);

  const handleCreateClient = useCallback(async () => {
    if (!token || !user) {
      return;
    }

    const name = newClientName.trim();
    const email = newClientEmail.trim();
    const phone = newClientPhone.trim();

    if (!name) {
      Alert.alert("Novo contato", "Informe o nome do cliente.");
      return;
    }

    setCreatingClient(true);
    try {
      const netInfo = await NetInfo.fetch();
      let client: ClientItem;

      if (!netInfo.isConnected) {
        const localClientId = makeLocalClientId();
        await addClientToQueue({
          localClientId,
          sellerId: user.id,
          name,
          email: email || null,
          phone: phone || null
        });
        client = {
          id: localClientId,
          name,
          email: email || null,
          phone: phone || null,
          isPending: true
        };
        Alert.alert("Novo contato", "Contato salvo offline. Vamos transmitir ao Vynor App quando voltar a internet.");
      } else {
        client = await createClient(
          { apiBaseUrl, token },
          {
            name,
            email: email || undefined,
            phone: phone || undefined
          }
        );
        Alert.alert("Novo contato", "Contato criado e transmitido para o Vynor App.");
      }

      await upsertClientCache(user.id, client).catch(() => undefined);
      upsertClientInState(client);
      setSelectedClientId(client.id);
      setCreateClientModalVisible(false);
      setVisitModalVisible(true);
      setNewClientName("");
      setNewClientEmail("");
      setNewClientPhone("");
    } catch (error) {
      Alert.alert("Novo contato", error instanceof Error ? error.message : "Falha ao criar contato.");
    } finally {
      setCreatingClient(false);
    }
  }, [
    apiBaseUrl,
    newClientEmail,
    newClientName,
    newClientPhone,
    token,
    upsertClientInState,
    user
  ]);

  const handleFromDateChange = useCallback((event: DateTimePickerEvent, date?: Date) => {
    setShowFromPicker(false);
    if (event.type !== "set" || !date) {
      return;
    }
    setCustomFromDate(startOfDay(date));
    if (date > customToDate) {
      setCustomToDate(endOfDay(date));
    }
  }, [customToDate]);

  const handleToDateChange = useCallback((event: DateTimePickerEvent, date?: Date) => {
    setShowToPicker(false);
    if (event.type !== "set" || !date) {
      return;
    }
    setCustomToDate(endOfDay(date));
    if (date < customFromDate) {
      setCustomFromDate(startOfDay(date));
    }
  }, [customFromDate]);

  const handleAuth = useCallback(async () => {
    const normalizedApi = apiBaseUrl.trim().replace(/\/+$/, "");
    if (!normalizedApi || !authLogin.trim() || !authPassword.trim()) {
      Alert.alert("Dados obrigatórios", "Informe login e senha.");
      return;
    }
    if (authAccessMode === "COMPANY" && !authOrganizationSlug.trim()) {
      Alert.alert("Dados obrigatórios", "Informe o slug da empresa.");
      return;
    }

    setAuthLoading(true);
    try {
      const authResponse = await login(normalizedApi, {
        accessMode: authAccessMode,
        organizationSlug:
          authAccessMode === "COMPANY" ? authOrganizationSlug.trim().toLowerCase() : undefined,
        login: authLogin.trim(),
        password: authPassword
      });

      await setSetting("api_base_url", normalizedApi);
      await saveAuthToken(authResponse.token);
      setApiBaseUrl(normalizedApi);
      setToken(authResponse.token);
      setUser(authResponse.user);
      setAuthPassword("");
      if (authAccessMode === "MASTER") {
        setAuthOrganizationSlug("");
      }
      Alert.alert("Autenticado", `Bem-vindo, ${authResponse.user.name}.`);
    } catch (error) {
      Alert.alert("Falha de autenticacao", error instanceof Error ? error.message : "Erro inesperado");
    } finally {
      setAuthLoading(false);
    }
  }, [apiBaseUrl, authAccessMode, authLogin, authOrganizationSlug, authPassword]);

  const handleLogout = useCallback(async () => {
    await clearAuthToken();
    setToken(null);
    setUser(null);
    setClients([]);
    setSelectedClientId("");
    setServerHistory([]);
    setManagerHistory([]);
    setManagerSellers([]);
    setManagerSellerGhlInputs({});
    setSavingSellerId(null);
    setManagerSellerId("");
    setOrganizations([]);
    setOrganizationEditorVisible(false);
    setOrganizationEditor(createEmptyOrganizationEditor());
  }, []);

  const handleRegisterVisit = useCallback(async () => {
    if (!canSubmit || !user) {
      return;
    }

    setLoading(true);
    try {
      const location = await getCurrentLocation();
      const checkInAt = new Date().toISOString();

      await addVisitToQueue({
        localVisitId: makeLocalVisitId(),
        sellerId: user.id,
        clientId: selectedClientId.trim(),
        clientName: selectedClient?.name ?? selectedClientId.trim(),
        clientEmail: selectedClient?.email ?? null,
        clientPhone: selectedClient?.phone ?? null,
        notes: visitNotes.trim(),
        checkInAt,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracyMeters
      });

      setLastLocation({ latitude: location.latitude, longitude: location.longitude });
      setVisitNotes("");
      setVisitModalVisible(false);
      await refreshLocalData();
      Alert.alert("Visita salva", "Visita registrada offline e pronta para sincronizar.");
    } catch (error) {
      Alert.alert("Erro ao salvar visita", error instanceof Error ? error.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }, [canSubmit, visitNotes, refreshLocalData, selectedClient, selectedClientId, user]);

  const handleSyncGhl = useCallback(
    async (fullSync: boolean) => {
      if (!token) {
        return;
      }

      setSyncingGhl(true);
      try {
        const result = await syncGhlContacts({ apiBaseUrl, token }, { fullSync });
        if (user) {
          await setSetting(contactSyncSettingKey(user.id), new Date().toISOString());
        }
        if (contactQuery.trim().length >= 2) {
          await refreshClients(contactQuery.trim());
        } else {
          await warmClientsCache();
        }
        Alert.alert(
          fullSync ? "Sincronizacao completa concluida" : "Sincronizacao concluida",
          `Contatos sincronizados: ${result.contactsSynced}`
        );
      } catch (error) {
        Alert.alert(
          fullSync ? "Erro na sincronizacao completa" : "Erro na sincronizacao",
          error instanceof Error ? error.message : "Erro inesperado"
        );
      } finally {
        setSyncingGhl(false);
      }
    },
    [apiBaseUrl, contactQuery, refreshClients, token, user, warmClientsCache]
  );

  const handleSaveConfig = useCallback(async () => {
    const normalizedApi = apiBaseUrl.trim().replace(/\/+$/, "");
    if (!normalizedApi) {
      Alert.alert("Dados obrigatorios", "API Base URL e obrigatoria.");
      return;
    }
    await setSetting("api_base_url", normalizedApi);
    setApiBaseUrl(normalizedApi);
    Alert.alert("Configuracao salva", "A URL da API foi atualizada.");
  }, [apiBaseUrl]);

  const handleTestApiConnection = useCallback(async () => {
    const normalizedApi = apiBaseUrl.trim().replace(/\/+$/, "");
    if (!normalizedApi) {
      Alert.alert("Conexao", "Defina o endpoint antes de testar.");
      return;
    }

    setTestingApi(true);
    try {
      const response = await fetch(normalizedApi);
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Endpoint respondeu ${response.status}`);
      }
      Alert.alert("Conexao", text || "API respondeu com sucesso.");
    } catch (error) {
      Alert.alert("Conexao", error instanceof Error ? error.message : "Falha ao testar endpoint.");
    } finally {
      setTestingApi(false);
    }
  }, [apiBaseUrl]);

  const handleSaveSellerGhlUserId = useCallback(
    async (sellerId: string) => {
      if (!token) {
        return;
      }

      setSavingSellerId(sellerId);
      try {
        await updateAdminSellerGhlUserId(
          { apiBaseUrl, token },
          {
            sellerId,
            ghlUserId: managerSellerGhlInputs[sellerId]?.trim() || null
          }
        );

        setManagerSellers((current) =>
          current.map((seller) =>
            seller.id === sellerId
              ? { ...seller, ghlUserId: managerSellerGhlInputs[sellerId]?.trim() || null }
              : seller
          )
        );
        Alert.alert("Equipe", "ID do vendedor no Vynor App atualizado.");
      } catch (error) {
        Alert.alert("Equipe", error instanceof Error ? error.message : "Falha ao salvar vinculo");
      } finally {
        setSavingSellerId(null);
      }
    },
    [apiBaseUrl, managerSellerGhlInputs, token]
  );

  const handleCreateOrganization = useCallback(async () => {
    if (!token || !canManageOrganizations) {
      return;
    }

    const name = organizationNameInput.trim();
    const slug = organizationSlugInput.trim().toLowerCase();
    const logoUrl = organizationLogoUrlInput.trim();
    const adminName = organizationAdminNameInput.trim();
    const adminEmail = organizationAdminEmailInput.trim().toLowerCase();
    const adminPassword = organizationAdminPasswordInput;

    if (!name || !slug) {
      Alert.alert("Empresas", "Informe nome e slug da empresa.");
      return;
    }

    setCreatingOrganization(true);
    try {
      await createOrganization(
        { apiBaseUrl, token },
        {
          name,
          slug,
          logoUrl: logoUrl || undefined,
          adminUser:
            adminName && adminEmail && adminPassword
              ? {
                  name: adminName,
                  email: adminEmail,
                  password: adminPassword
                }
              : undefined
        }
      );
      Alert.alert("Empresas", "Empresa criada com sucesso.");
      setOrganizationNameInput("");
      setOrganizationSlugInput("");
      setOrganizationLogoUrlInput("");
      setOrganizationAdminNameInput("");
      setOrganizationAdminEmailInput("");
      setOrganizationAdminPasswordInput("");
      await refreshOrganizations();
    } catch (error) {
      Alert.alert("Empresas", error instanceof Error ? error.message : "Falha ao criar empresa");
    } finally {
      setCreatingOrganization(false);
    }
  }, [
    apiBaseUrl,
    canManageOrganizations,
    organizationAdminEmailInput,
    organizationAdminNameInput,
    organizationAdminPasswordInput,
    organizationLogoUrlInput,
    organizationNameInput,
    organizationSlugInput,
    refreshOrganizations,
    token
  ]);

  const openOrganizationEditor = useCallback((organization: OrganizationItem) => {
    setOrganizationEditor({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logoUrl: organization.logoUrl ?? "",
      ghlApiBaseUrl: organization.ghlApiBaseUrl ?? "",
      ghlLocationId: organization.ghlLocationId ?? "",
      ghlAccessToken: "",
      ghlContactSyncMaxPages: organization.ghlContactSyncMaxPages
        ? String(organization.ghlContactSyncMaxPages)
        : "",
      ghlVisitsObjectKey: organization.ghlVisitsObjectKey ?? "",
      ghlVisitsFieldClientNameKey: organization.ghlVisitsFieldClientNameKey ?? "",
      ghlVisitsFieldOwnerKey: organization.ghlVisitsFieldOwnerKey ?? "",
      ghlVisitsFieldVisitDateKey: organization.ghlVisitsFieldVisitDateKey ?? "",
      ghlVisitsFieldNotesKey: organization.ghlVisitsFieldNotesKey ?? "",
      ghlVisitsFieldTitleKey: organization.ghlVisitsFieldTitleKey ?? ""
    });
    setOrganizationEditorVisible(true);
  }, []);

  const closeOrganizationEditor = useCallback(() => {
    setOrganizationEditorVisible(false);
    setOrganizationEditor(createEmptyOrganizationEditor());
  }, []);

  const handleSaveOrganization = useCallback(async () => {
    if (!token || !organizationEditor.id) {
      return;
    }

    const name = organizationEditor.name.trim();
    const slug = organizationEditor.slug.trim().toLowerCase();
    if (!name || !slug) {
      Alert.alert("Empresas", "Nome e slug sao obrigatorios.");
      return;
    }

    const maxPagesInput = organizationEditor.ghlContactSyncMaxPages.trim();
    const parsedMaxPages =
      maxPagesInput.length > 0 ? Number.parseInt(maxPagesInput, 10) : undefined;
    if (
      maxPagesInput.length > 0 &&
      (parsedMaxPages === undefined || !Number.isFinite(parsedMaxPages) || parsedMaxPages <= 0)
    ) {
      Alert.alert("Empresas", "Maximo de paginas deve ser um numero inteiro positivo.");
      return;
    }

    setOrganizationEditorSaving(true);
    try {
      const response = await updateOrganization(
        { apiBaseUrl, token },
        {
          organizationId: organizationEditor.id,
          name,
          slug,
          logoUrl: organizationEditor.logoUrl.trim() || null,
          ghlApiBaseUrl: organizationEditor.ghlApiBaseUrl.trim() || null,
          ghlLocationId: organizationEditor.ghlLocationId.trim() || null,
          ghlAccessToken: organizationEditor.ghlAccessToken.trim() || undefined,
          ghlContactSyncMaxPages: parsedMaxPages ?? null,
          ghlVisitsObjectKey: organizationEditor.ghlVisitsObjectKey.trim() || null,
          ghlVisitsFieldClientNameKey:
            organizationEditor.ghlVisitsFieldClientNameKey.trim() || null,
          ghlVisitsFieldOwnerKey: organizationEditor.ghlVisitsFieldOwnerKey.trim() || null,
          ghlVisitsFieldVisitDateKey:
            organizationEditor.ghlVisitsFieldVisitDateKey.trim() || null,
          ghlVisitsFieldNotesKey: organizationEditor.ghlVisitsFieldNotesKey.trim() || null,
          ghlVisitsFieldTitleKey: organizationEditor.ghlVisitsFieldTitleKey.trim() || null
        }
      );

      setOrganizations((current) =>
        current.map((organization) =>
          organization.id === response.organization.id ? response.organization : organization
        )
      );
      if (user?.organizationId === response.organization.id) {
        setUser((current) =>
          current
            ? {
                ...current,
                organizationName: response.organization.name,
                organizationSlug: response.organization.slug,
                organizationLogoUrl: response.organization.logoUrl ?? null
              }
            : current
        );
      }
      closeOrganizationEditor();
      Alert.alert("Empresas", "Configuracoes da empresa atualizadas.");
    } catch (error) {
      Alert.alert("Empresas", error instanceof Error ? error.message : "Falha ao salvar empresa");
    } finally {
      setOrganizationEditorSaving(false);
    }
  }, [apiBaseUrl, closeOrganizationEditor, organizationEditor, token, user?.organizationId]);

  const handleRetryVisit = useCallback(
    async (localVisitId: string) => {
      if (!token) {
        Alert.alert("Sessao", "Faca login novamente.");
        return;
      }

      const result = await retryVisitSync(localVisitId, apiBaseUrl, token);
      await refreshLocalData();
      await refreshServerHistory();

      if (result.success) {
        Alert.alert("Sync", "Visita sincronizada com sucesso.");
      } else {
        Alert.alert("Sync", result.error ?? "Nao foi possivel sincronizar.");
      }
    },
    [apiBaseUrl, refreshLocalData, refreshServerHistory, token]
  );

  if (!token || !user) {
    return (
      <SafeAreaView style={[styles.container, isTablet && styles.containerTablet]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 20}
          style={styles.authKeyboard}
        >
          <ScrollView
            style={styles.authScroll}
            contentContainerStyle={[
              styles.authScrollContent,
              isTablet && styles.authScrollContentTablet
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
          >
            <LinearGradient
              colors={["#f8fdff", "#edf7fb"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.header, isTablet && styles.headerTablet]}
            >
              <View style={styles.headerBadgeRow}>
                <View style={styles.headerModeBadge}>
                  <Feather name="shield" size={14} color="#0b84b7" />
                  <Text style={styles.headerModeBadgeText}>VField secure login</Text>
                </View>
              </View>
              <LoginRouteAnimation isTablet={isTablet} />
              <Text style={[styles.logoFallback, styles.loginBrandWordmark, isTablet && styles.logoFallbackTablet]}>
                VFIELD
              </Text>
              <Text style={[styles.brandPill, isTablet && styles.brandPillTablet]}>VField</Text>
              <Text style={[styles.title, isTablet && styles.titleTablet]}>Acesso ao aplicativo</Text>
              <Text style={[styles.subtitle, isTablet && styles.subtitleTablet]}>
                Escolha o tipo de acesso e entre com suas credenciais.
              </Text>
            </LinearGradient>
            <View style={[styles.contentWrap, isTablet && styles.contentWrapTablet]}>
              <View style={[styles.form, isTablet && styles.formTablet]}>
                <View style={styles.authModeRow}>
                  <TouchableOpacity
                    style={[
                      styles.authModeChip,
                      authAccessMode === "COMPANY" && styles.authModeChipActive
                    ]}
                    onPress={() => setAuthAccessMode("COMPANY")}
                  >
                    <Text
                      style={[
                        styles.authModeChipText,
                        authAccessMode === "COMPANY" && styles.authModeChipTextActive
                      ]}
                    >
                      Empresa
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.authModeChip,
                      authAccessMode === "MASTER" && styles.authModeChipActive
                    ]}
                    onPress={() => setAuthAccessMode("MASTER")}
                  >
                    <Text
                      style={[
                        styles.authModeChipText,
                        authAccessMode === "MASTER" && styles.authModeChipTextActive
                      ]}
                    >
                      Master
                    </Text>
                  </TouchableOpacity>
                </View>

                {authAccessMode === "COMPANY" ? (
                  <>
                    <Text style={styles.fieldLabel}>Empresa</Text>
                    <TextInput
                      style={[styles.input, isTablet && styles.inputTablet]}
                      value={authOrganizationSlug}
                      onChangeText={setAuthOrganizationSlug}
                      placeholder="Slug da empresa (ex: trinit)"
                      autoCapitalize="none"
                    />
                  </>
                ) : null}

                <Text style={styles.fieldLabel}>Login</Text>
                <TextInput
                  style={[styles.input, isTablet && styles.inputTablet]}
                  value={authLogin}
                  onChangeText={setAuthLogin}
                  placeholder="Login do usuario"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={styles.fieldLabel}>Senha</Text>
                <View style={styles.passwordField}>
                  <TextInput
                    style={[styles.input, styles.passwordInput, isTablet && styles.inputTablet]}
                    value={authPassword}
                    onChangeText={setAuthPassword}
                    placeholder="Senha"
                    secureTextEntry={!showAuthPassword}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={styles.passwordToggle}
                    onPress={() => setShowAuthPassword((current) => !current)}
                  >
                    <Ionicons
                      name={showAuthPassword ? "eye-off-outline" : "eye-outline"}
                      size={20}
                      color="#5c7285"
                    />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[styles.button, isTablet && styles.buttonTablet]}
                  onPress={handleAuth}
                  disabled={authLoading}
                >
                  {authLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <View style={styles.inlineButtonContent}>
                      <Ionicons name="log-in-outline" size={18} color="#ffffff" />
                      <Text style={styles.buttonText}>
                        {authAccessMode === "MASTER" ? "Entrar no painel master" : "Entrar na empresa"}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, isTablet && styles.containerTablet]}>
      <LinearGradient
        colors={["#f8fdff", "#edf7fb"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, isTablet && styles.headerTablet]}
      >
        <View style={styles.headerBadgeRow}>
          <View style={styles.headerModeBadge}>
            <Feather
              name={online === false ? "wifi-off" : "wifi"}
              size={14}
              color={online === false ? "#c2410c" : "#0b84b7"}
            />
            <Text style={styles.headerModeBadgeText}>
              {online === false ? "Trabalhando offline" : "Operacao online"}
            </Text>
          </View>
          <View style={styles.headerModeBadge}>
            <Ionicons name="sparkles-outline" size={14} color="#0b84b7" />
            <Text style={styles.headerModeBadgeText}>VField</Text>
          </View>
        </View>
        {organizationLogoUrl && !logoFailed ? (
          <Image
            source={{ uri: organizationLogoUrl }}
            style={[styles.logo, isTablet && styles.logoTablet]}
            resizeMode="contain"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <Text style={[styles.logoFallback, styles.loginBrandWordmark, isTablet && styles.logoFallbackTablet]}>
            VFIELD
          </Text>
        )}
        <Text style={[styles.title, isTablet && styles.titleTablet]}>
          {isSuperAdmin ? "Painel Administrativo" : "Gerenciador de Visitas"}
        </Text>
        <Text style={[styles.subtitle, isTablet && styles.subtitleTablet]}>
          {isSuperAdmin
            ? `Conta master | ${user.name}`
            : `${user.organizationName || "Empresa"} | ${user.name}`}
        </Text>
        <Text style={[styles.syncText, isTablet && styles.syncTextTablet]}>{lastSyncText}</Text>
        <View style={[styles.metricsRow, isTablet && styles.metricsRowTablet]}>
          <View style={[styles.metricChip, isTablet && styles.metricChipTablet]}>
            <Text style={[styles.metricLabel, isTablet && styles.metricLabelTablet]}>
              {isSuperAdmin ? "Perfil" : "Pendentes"}
            </Text>
            <Text style={[styles.metricValue, isTablet && styles.metricValueTablet]}>
              {isSuperAdmin ? "Master" : pendingCount}
            </Text>
          </View>
          <View style={[styles.metricChip, isTablet && styles.metricChipTablet]}>
            <Text style={[styles.metricLabel, isTablet && styles.metricLabelTablet]}>Rede</Text>
            <Text style={[styles.metricValue, isTablet && styles.metricValueTablet]}>
              {online === null ? "..." : online ? "Online" : "Offline"}
            </Text>
          </View>
          <View style={[styles.metricChip, isTablet && styles.metricChipTablet]}>
            <Text style={[styles.metricLabel, isTablet && styles.metricLabelTablet]}>
              {isSuperAdmin ? "Empresas" : "Em tela"}
            </Text>
            <Text style={[styles.metricValue, isTablet && styles.metricValueTablet]}>
              {isSuperAdmin ? organizations.length : clients.length}
            </Text>
          </View>
        </View>
      </LinearGradient>
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.contentWrap, isTablet && styles.contentWrapTablet]}>
        {activeTab === "VISITA" && (
          <View style={[styles.form, isTablet && styles.formTablet]}>
            <View style={[styles.visitBody, isTablet && styles.visitBodyTablet]}>
              <View style={[styles.visitPrimaryColumn, isTablet && styles.visitPrimaryColumnTablet]}>
                <View style={[styles.panel, isTablet && styles.panelTablet]}>
                  <View style={styles.panelHeaderRow}>
                  <View style={styles.panelHeaderTitleRow}>
                    <View style={styles.panelHeaderIcon}>
                      <Feather name="search" size={16} color="#0b84b7" />
                    </View>
                    <View style={styles.panelHeaderCopy}>
                      <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>
                        Novo check
                      </Text>
                        <Text style={styles.caption}>
                          Pesquise o contato e abra o card para registrar a visita.
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.searchRow}>
                    <TextInput
                      style={[styles.input, styles.searchInput, isTablet && styles.inputTablet]}
                      value={contactQuery}
                      onChangeText={setContactQuery}
                      placeholder="Nome, email ou telefone"
                    />
                    <TouchableOpacity
                      style={[styles.button, styles.searchButton, isTablet && styles.buttonTablet]}
                      onPress={handleSearchContacts}
                      disabled={loadingClients}
                    >
                      {loadingClients ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.buttonText}>Buscar</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={[styles.button, styles.secondaryButton, styles.newClientButton, isTablet && styles.buttonTablet]}
                    onPress={() => setCreateClientModalVisible(true)}
                  >
                    <View style={styles.inlineButtonContent}>
                      <Ionicons name="person-add-outline" size={16} color="#175569" />
                      <Text style={styles.secondaryText}>Criar cliente</Text>
                    </View>
                  </TouchableOpacity>
                  <View style={styles.inlineHintRow}>
                    <Feather name="info" size={14} color="#0b84b7" />
                    <Text style={styles.caption}>Digite ao menos 2 caracteres.</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.button, styles.syncActionButton, syncing && styles.buttonDisabled, isTablet && styles.buttonTablet]}
                  onPress={() => {
                    runSync().catch(() => undefined);
                  }}
                  disabled={syncing}
                >
                  {syncing ? (
                    <ActivityIndicator color="#111" />
                  ) : (
                    <View style={styles.inlineButtonContent}>
                      <Ionicons name="cloud-upload-outline" size={18} color="#0b84b7" />
                      <Text style={styles.secondaryText}>Transmitir pendencias</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>

              <View style={[styles.clientList, isTablet && styles.visitListTablet]}>
                {clients.map((client) => (
                  <TouchableOpacity
                    key={client.id}
                    style={[
                      styles.clientItem,
                      isTablet && styles.clientItemTablet,
                      selectedClientId === client.id && styles.clientItemSelected
                    ]}
                    onPress={() => {
                      setSelectedClientId(client.id);
                      setVisitModalVisible(true);
                    }}
                  >
                    <View style={styles.clientRowTop}>
                      <View style={styles.clientTitleWrap}>
                        <View style={styles.clientAvatar}>
                          <Text style={styles.clientAvatarText}>
                            {client.name.slice(0, 2).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={[styles.clientName, isTablet && styles.clientNameTablet]}>
                          {client.name}
                        </Text>
                      </View>
                      <View style={styles.ctaBadge}>
                        <Text style={styles.ctaBadgeText}>Registrar</Text>
                      </View>
                    </View>
                    <Text style={[styles.clientMeta, isTablet && styles.clientMetaTablet]}>
                      {client.phone || client.email || client.id}
                    </Text>
                    {client.isPending ? <Text style={styles.pendingTag}>Pendente de envio ao Vynor App</Text> : null}
                  </TouchableOpacity>
                ))}
                {!clients.length && !loadingClients ? (
                  <Text style={styles.caption}>Nenhum contato em tela. Use a busca.</Text>
                ) : null}
              </View>
            </View>

            <Modal
              visible={visitModalVisible}
              transparent
              animationType="slide"
              onRequestClose={() => setVisitModalVisible(false)}
            >
              <View style={[styles.modalBackdrop, isTablet && styles.modalBackdropTablet]}>
                <KeyboardAvoidingView
                  behavior={Platform.OS === "ios" ? "padding" : undefined}
                  style={styles.modalKeyboard}
                >
                  <View style={[styles.modalCard, isTablet && styles.modalCardTablet]}>
                    <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>Registrar visita</Text>
                    <Text style={[styles.label, isTablet && styles.labelTablet]}>
                      Contato: {selectedClient ? selectedClient.name : "Nenhum selecionado"}
                    </Text>
                    <Text style={[styles.clientMeta, isTablet && styles.clientMetaTablet]}>
                      {selectedClient?.phone || selectedClient?.email || selectedClient?.id || ""}
                    </Text>

                    <TextInput
                      style={[styles.input, styles.textArea, isTablet && styles.inputTablet]}
                      value={visitNotes}
                      onChangeText={setVisitNotes}
                      placeholder="Observacoes da visita"
                      multiline
                      numberOfLines={4}
                    />

                    <TouchableOpacity
                      style={[styles.button, isTablet && styles.buttonTablet, !canSubmit && styles.buttonDisabled]}
                      onPress={handleRegisterVisit}
                      disabled={!canSubmit}
                    >
                      {loading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.buttonText}>Confirmar visita</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, styles.secondaryButton, isTablet && styles.buttonTablet]}
                      onPress={() => setVisitModalVisible(false)}
                    >
                      <Text style={styles.secondaryText}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                </KeyboardAvoidingView>
              </View>
            </Modal>

            <Modal
              visible={createClientModalVisible}
              transparent
              animationType="slide"
              onRequestClose={() => setCreateClientModalVisible(false)}
            >
              <View style={[styles.modalBackdrop, isTablet && styles.modalBackdropTablet]}>
                <KeyboardAvoidingView
                  behavior={Platform.OS === "ios" ? "padding" : undefined}
                  style={styles.modalKeyboard}
                >
                  <View style={[styles.modalCard, isTablet && styles.modalCardTablet]}>
                    <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>Novo cliente</Text>
                    <TextInput
                      style={[styles.input, isTablet && styles.inputTablet]}
                      value={newClientName}
                      onChangeText={setNewClientName}
                      placeholder="Nome do cliente"
                    />
                    <TextInput
                      style={[styles.input, isTablet && styles.inputTablet]}
                      value={newClientPhone}
                      onChangeText={setNewClientPhone}
                      placeholder="Telefone (opcional)"
                      keyboardType="phone-pad"
                    />
                    <TextInput
                      style={[styles.input, isTablet && styles.inputTablet]}
                      value={newClientEmail}
                      onChangeText={setNewClientEmail}
                      placeholder="Email (opcional)"
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={[styles.button, isTablet && styles.buttonTablet, creatingClient && styles.buttonDisabled]}
                      onPress={handleCreateClient}
                      disabled={creatingClient}
                    >
                      {creatingClient ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.buttonText}>Salvar cliente</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, styles.secondaryButton, isTablet && styles.buttonTablet]}
                      onPress={() => setCreateClientModalVisible(false)}
                    >
                      <Text style={styles.secondaryText}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                </KeyboardAvoidingView>
              </View>
            </Modal>
          </View>
        )}

        {activeTab === "HISTORICO" && (
          <View style={[styles.form, isTablet && styles.formTablet]}>
            <View style={[styles.panel, isTablet && styles.panelTablet]}>
              <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>Filtro de periodo</Text>
              <View style={styles.filterRow}>
                {(["TODAY", "7D", "15D", "30D", "CUSTOM"] as HistoryPreset[]).map((preset) => (
                  <TouchableOpacity
                    key={preset}
                    style={[styles.filterChip, isTablet && styles.filterChipTablet, historyPreset === preset && styles.filterChipActive]}
                    onPress={() => setHistoryPreset(preset)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        isTablet && styles.filterChipTextTablet,
                        historyPreset === preset && styles.filterChipTextActive
                      ]}
                    >
                      {preset === "TODAY" ? "Hoje" : preset === "CUSTOM" ? "Personalizado" : preset}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {historyPreset === "CUSTOM" ? (
                <View style={styles.filterCustomRow}>
                  <TouchableOpacity
                    style={[styles.input, styles.filterInput, isTablet && styles.inputTablet]}
                    onPress={() => setShowFromPicker(true)}
                  >
                    <Text style={styles.dateButtonLabel}>De: {toIsoDateInput(customFromDate)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.input, styles.filterInput, isTablet && styles.inputTablet]}
                    onPress={() => setShowToPicker(true)}
                  >
                    <Text style={styles.dateButtonLabel}>Ate: {toIsoDateInput(customToDate)}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {showFromPicker ? (
                <DateTimePicker
                  value={customFromDate}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={handleFromDateChange}
                  maximumDate={customToDate}
                />
              ) : null}
              {showToPicker ? (
                <DateTimePicker
                  value={customToDate}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={handleToDateChange}
                  minimumDate={customFromDate}
                />
              ) : null}
            </View>

            <View style={styles.filterRow}>
              <TouchableOpacity
                style={[styles.filterChip, isTablet && styles.filterChipTablet, historySource === "LOCAL" && styles.filterChipActive]}
                onPress={() => setHistorySource("LOCAL")}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isTablet && styles.filterChipTextTablet,
                    historySource === "LOCAL" && styles.filterChipTextActive
                  ]}
                >
                  No aparelho
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterChip, isTablet && styles.filterChipTablet, historySource === "SERVER" && styles.filterChipActive]}
                onPress={() => setHistorySource("SERVER")}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isTablet && styles.filterChipTextTablet,
                    historySource === "SERVER" && styles.filterChipTextActive
                  ]}
                >
                  No servidor
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.historyList, isTablet && styles.historyListTablet]}>
              {displayedHistory.map((visit) => (
                <TouchableOpacity
                  key={`${historySource}-${visit.localVisitId}`}
                  style={[styles.historyItem, isTablet && styles.historyItemTablet]}
                  onPress={() => setHistoryDetail(visit)}
                >
                  <View style={styles.clientRowTop}>
                    <Text style={[styles.historyMain, isTablet && styles.historyMainTablet]}>{getVisitDisplayName(visit)}</Text>
                    <Text style={[styles.historyStatus, isTablet && styles.historyStatusTablet, { color: statusColor(visit.syncStatus) }]}>
                      {statusLabel(visit.syncStatus)}
                    </Text>
                  </View>
                  <Text style={[styles.historySub, isTablet && styles.historySubTablet]}>
                    {new Date(visit.checkInAt).toLocaleString()}
                  </Text>
                  <Text style={[styles.historySub, isTablet && styles.historySubTablet]} numberOfLines={2}>
                    {visit.notes}
                  </Text>
                  {visit.syncStatus === "FAILED" ? (
                    <Text style={styles.errorMessage} numberOfLines={2}>
                      {visit.lastError || "Erro desconhecido"}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
            {!displayedHistory.length ? (
              <Text style={styles.caption}>
                {historySource === "LOCAL"
                  ? "Sem visitas locais no periodo."
                  : "Sem visitas no servidor no periodo."}
              </Text>
            ) : null}

          </View>
        )}

        {activeTab === "MAPA" && (
          <View style={[styles.form, isTablet && styles.formTablet]}>
            <Text style={[styles.label, isTablet && styles.labelTablet]}>Pontos de visitas realizadas no periodo filtrado</Text>
            {!canRenderMap ? (
              <View style={styles.mapFallback}>
                <Text style={styles.caption}>Mapa indisponivel neste build.</Text>
                <Text style={styles.caption}>Defina `GOOGLE_MAPS_API_KEY` antes de gerar o APK/AAB.</Text>
              </View>
            ) : mapMarkers.length ? (
              <MapView
                style={[styles.map, isTablet && styles.mapTablet]}
                liteMode={Platform.OS === "android"}
                initialRegion={{
                  latitude: mapMarkers[0].coordinate.latitude,
                  longitude: mapMarkers[0].coordinate.longitude,
                  latitudeDelta: 0.02,
                  longitudeDelta: 0.02
                }}
              >
                {mapMarkers.map(({ visit, coordinate }) => (
                  <Marker
                    key={visit.localVisitId}
                    coordinate={coordinate}
                    title={getVisitDisplayName(visit)}
                    description={new Date(visit.checkInAt).toLocaleString()}
                  />
                ))}
              </MapView>
            ) : (
              <Text style={styles.caption}>Nenhuma coordenada registrada ainda.</Text>
            )}
            <Text style={styles.caption}>
              Offline: a captura GPS continua funcionando sem rede. O mapa usa cache local quando disponivel.
            </Text>
            {mapMarkers.length >= MAX_MAP_MARKERS ? (
              <Text style={styles.caption}>Mostrando os 300 pontos mais recentes para manter estabilidade.</Text>
            ) : null}
          </View>
        )}

        {activeTab === "GERENCIA" && isMaster && (
          <View style={[styles.form, isTablet && styles.formTablet]}>
            <View style={[styles.panel, isTablet && styles.panelTablet]}>
              <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>Gestao de visitas</Text>
              <Text style={styles.caption}>Visao consolidada do time de vendas.</Text>
              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>Filtro de periodo</Text>
                <View style={styles.filterRow}>
                  {(["TODAY", "7D", "15D", "30D", "CUSTOM"] as HistoryPreset[]).map((preset) => (
                    <TouchableOpacity
                      key={`manager-${preset}`}
                      style={[styles.filterChip, isTablet && styles.filterChipTablet, historyPreset === preset && styles.filterChipActive]}
                      onPress={() => setHistoryPreset(preset)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          isTablet && styles.filterChipTextTablet,
                          historyPreset === preset && styles.filterChipTextActive
                        ]}
                      >
                        {preset === "TODAY" ? "Hoje" : preset === "CUSTOM" ? "Personalizado" : preset}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {historyPreset === "CUSTOM" ? (
                  <View style={styles.filterCustomRow}>
                    <TouchableOpacity
                      style={[styles.input, styles.filterInput, isTablet && styles.inputTablet]}
                      onPress={() => setShowFromPicker(true)}
                    >
                      <Text style={styles.dateButtonLabel}>De: {toIsoDateInput(customFromDate)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.input, styles.filterInput, isTablet && styles.inputTablet]}
                      onPress={() => setShowToPicker(true)}
                    >
                      <Text style={styles.dateButtonLabel}>Ate: {toIsoDateInput(customToDate)}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                {showFromPicker ? (
                  <DateTimePicker
                    value={customFromDate}
                    mode="date"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    onChange={handleFromDateChange}
                    maximumDate={customToDate}
                  />
                ) : null}
                {showToPicker ? (
                  <DateTimePicker
                    value={customToDate}
                    mode="date"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    onChange={handleToDateChange}
                    minimumDate={customFromDate}
                  />
                ) : null}
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>Filtro de vendedor</Text>
                <View style={styles.filterRow}>
                  <TouchableOpacity
                    style={[styles.filterChip, isTablet && styles.filterChipTablet, managerSellerId === "" && styles.filterChipActive]}
                    onPress={() => setManagerSellerId("")}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        isTablet && styles.filterChipTextTablet,
                        managerSellerId === "" && styles.filterChipTextActive
                      ]}
                    >
                      Todos
                    </Text>
                  </TouchableOpacity>
                  {managerSellers.map((seller) => (
                    <TouchableOpacity
                      key={seller.id}
                      style={[
                        styles.filterChip,
                        isTablet && styles.filterChipTablet,
                        managerSellerId === seller.id && styles.filterChipActive
                      ]}
                      onPress={() => setManagerSellerId(seller.id)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          isTablet && styles.filterChipTextTablet,
                          managerSellerId === seller.id && styles.filterChipTextActive
                        ]}
                      >
                        {seller.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton, styles.managerRefreshButton, managerLoading && styles.buttonDisabled]}
                onPress={() => refreshManagerData().catch(() => undefined)}
                disabled={managerLoading}
              >
                {managerLoading ? (
                  <ActivityIndicator color="#111" />
                ) : (
                  <Text style={styles.secondaryText}>Atualizar painel</Text>
                )}
              </TouchableOpacity>
            </View>

            {user?.role === "MASTER" ? (
              <View style={[styles.panel, isTablet && styles.panelTablet]}>
                <View style={styles.panelHeaderRow}>
                  <View style={styles.panelHeaderTitleRow}>
                    <View style={styles.panelHeaderIcon}>
                      <Feather name="users" size={16} color="#0b84b7" />
                    </View>
                    <View style={styles.panelHeaderCopy}>
                      <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>
                        Equipe e vinculo Vynor App
                      </Text>
                      <Text style={styles.caption}>
                        Defina o ID do vendedor no Vynor App para cada usuario da empresa.
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.managerSellerList}>
                  {managerSellers.map((seller) => (
                    <View key={`seller-link-${seller.id}`} style={styles.managerSellerCard}>
                      <Text style={styles.organizationName}>{seller.name}</Text>
                      <Text style={styles.organizationMeta}>{seller.email}</Text>
                      <TextInput
                        style={[styles.input, isTablet && styles.inputTablet]}
                        value={managerSellerGhlInputs[seller.id] ?? ""}
                        onChangeText={(value) =>
                          setManagerSellerGhlInputs((current) => ({
                            ...current,
                            [seller.id]: value
                          }))
                        }
                        placeholder="ID do vendedor no Vynor App"
                        autoCapitalize="none"
                      />
                      <TouchableOpacity
                        style={[
                          styles.button,
                          styles.configSoftButton,
                          isTablet && styles.buttonTablet,
                          savingSellerId === seller.id && styles.buttonDisabled
                        ]}
                        onPress={() => handleSaveSellerGhlUserId(seller.id)}
                        disabled={savingSellerId === seller.id}
                      >
                        {savingSellerId === seller.id ? (
                          <ActivityIndicator color="#175569" />
                        ) : (
                          <View style={styles.inlineButtonContent}>
                            <Feather name="save" size={16} color="#175569" />
                            <Text style={styles.secondaryText}>Salvar vinculo</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    </View>
                  ))}
                  {!managerSellers.length ? (
                    <Text style={styles.caption}>Nenhum vendedor encontrado.</Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            <View style={[styles.historyList, isTablet && styles.historyListTablet]}>
              {filteredManagerHistory.map((visit) => (
                <TouchableOpacity
                  key={`manager-${visit.localVisitId}`}
                  style={[styles.historyItem, isTablet && styles.historyItemTablet]}
                  onPress={() => setHistoryDetail(visit)}
                >
                  <View style={styles.clientRowTop}>
                    <Text style={[styles.historyMain, isTablet && styles.historyMainTablet]}>
                      {visit.seller?.name || visit.sellerId}
                    </Text>
                    <Text style={[styles.historyStatus, isTablet && styles.historyStatusTablet, { color: statusColor(visit.syncStatus) }]}>
                      {statusLabel(visit.syncStatus)}
                    </Text>
                  </View>
                  <Text style={[styles.historySub, isTablet && styles.historySubTablet]}>{getVisitDisplayName(visit)}</Text>
                  <Text style={[styles.historySub, isTablet && styles.historySubTablet]}>{new Date(visit.checkInAt).toLocaleString()}</Text>
                  <Text style={[styles.historySub, isTablet && styles.historySubTablet]} numberOfLines={1}>
                    {visit.notes}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {!filteredManagerHistory.length ? (
              <Text style={styles.caption}>Sem visitas para os filtros selecionados.</Text>
            ) : null}
          </View>
        )}

        {activeTab === "CONFIG" && (
          <View style={[styles.form, isTablet && styles.formTablet]}>
            {isSuperAdmin ? (
              <>
                <View style={[styles.configGrid, isTablet && styles.configGridTablet]}>
                  <View
                    style={[styles.panel, isTablet && styles.panelTablet, isTablet && styles.configPanelTablet]}
                  >
                    <View style={styles.panelHeaderRow}>
                      <View style={styles.panelHeaderTitleRow}>
                        <View style={styles.panelHeaderIcon}>
                          <Feather name="link-2" size={16} color="#0b84b7" />
                        </View>
                        <View style={styles.panelHeaderCopy}>
                          <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>
                            Ambiente da API
                          </Text>
                          <Text style={styles.caption}>
                            Endpoint oculto para clientes e acessivel apenas no master.
                          </Text>
                        </View>
                      </View>
                    </View>
                    <TextInput
                      style={[styles.input, isTablet && styles.inputTablet]}
                      value={apiBaseUrl}
                      onChangeText={setApiBaseUrl}
                      placeholder="URL da API"
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={[styles.button, styles.configPrimaryButton, isTablet && styles.buttonTablet]}
                      onPress={handleSaveConfig}
                    >
                      <View style={styles.inlineButtonContent}>
                        <Ionicons name="save-outline" size={18} color="#ffffff" />
                        <Text style={styles.buttonText}>Salvar endpoint</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.button,
                        styles.configSoftButton,
                        isTablet && styles.buttonTablet,
                        testingApi && styles.buttonDisabled
                      ]}
                      onPress={handleTestApiConnection}
                      disabled={testingApi}
                    >
                      {testingApi ? (
                        <ActivityIndicator color="#175569" />
                      ) : (
                        <View style={styles.inlineButtonContent}>
                          <Ionicons name="pulse-outline" size={16} color="#175569" />
                          <Text style={styles.secondaryText}>Testar conexao</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>

                  <View
                    style={[styles.panel, isTablet && styles.panelTablet, isTablet && styles.configPanelTablet]}
                  >
                    <View style={styles.panelHeaderRow}>
                      <View style={styles.panelHeaderTitleRow}>
                        <View style={styles.panelHeaderIcon}>
                          <MaterialCommunityIcons name="view-dashboard-outline" size={16} color="#0b84b7" />
                        </View>
                        <View style={styles.panelHeaderCopy}>
                          <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>
                            Painel master
                          </Text>
                          <Text style={styles.caption}>
                            Resumo rapido do ambiente administrativo.
                          </Text>
                        </View>
                      </View>
                    </View>
                    <Text style={styles.organizationMeta}>Empresas carregadas: {organizations.length}</Text>
                    <Text style={styles.organizationMeta}>Conexao: {online === false ? "offline" : "online"}</Text>
                    <Text style={styles.organizationMeta}>Endpoint atual:{"\n"}{apiBaseUrl}</Text>
                    <Text style={styles.organizationMeta}>
                      Ultimo status: {lastSyncText}
                    </Text>
                  </View>
                </View>

                {canManageOrganizations ? (
                  <View style={[styles.panel, isTablet && styles.panelTablet]}>
                    <View style={styles.panelHeaderRow}>
                      <View style={styles.panelHeaderTitleRow}>
                        <View style={styles.panelHeaderIcon}>
                          <MaterialCommunityIcons name="office-building-outline" size={16} color="#0b84b7" />
                        </View>
                        <View style={styles.panelHeaderCopy}>
                          <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>
                            Empresas atendidas
                          </Text>
                          <Text style={styles.caption}>
                            Cadastre uma nova operacao e depois configure os dados do Vynor App.
                          </Text>
                        </View>
                      </View>
                    </View>
                    <Text style={styles.fieldLabel}>Nome da empresa</Text>
                    <TextInput
                      style={[styles.input, isTablet && styles.inputTablet]}
                      value={organizationNameInput}
                      onChangeText={setOrganizationNameInput}
                      placeholder="Nome da empresa"
                    />
                    <Text style={styles.fieldLabel}>Slug da empresa</Text>
                    <TextInput
                      style={[styles.input, isTablet && styles.inputTablet]}
                      value={organizationSlugInput}
                      onChangeText={setOrganizationSlugInput}
                      placeholder="Slug da empresa (ex: trinit)"
                      autoCapitalize="none"
                    />
                    <Text style={styles.fieldLabel}>Logo da empresa (opcional)</Text>
                    <TextInput
                      style={[styles.input, isTablet && styles.inputTablet]}
                      value={organizationLogoUrlInput}
                      onChangeText={setOrganizationLogoUrlInput}
                      placeholder="https://empresa.com/logo.png"
                      autoCapitalize="none"
                    />
                    <Text style={styles.fieldLabel}>Gerente inicial (opcional)</Text>
                    <TextInput
                      style={[styles.input, isTablet && styles.inputTablet]}
                      value={organizationAdminNameInput}
                      onChangeText={setOrganizationAdminNameInput}
                      placeholder="Nome do gerente inicial (opcional)"
                    />
                    <TextInput
                      style={[styles.input, isTablet && styles.inputTablet]}
                      value={organizationAdminEmailInput}
                      onChangeText={setOrganizationAdminEmailInput}
                      placeholder="Email do gerente inicial (opcional)"
                      autoCapitalize="none"
                      keyboardType="email-address"
                    />
                    <TextInput
                      style={[styles.input, isTablet && styles.inputTablet]}
                      value={organizationAdminPasswordInput}
                      onChangeText={setOrganizationAdminPasswordInput}
                      placeholder="Senha do gerente inicial (opcional)"
                      autoCapitalize="none"
                      secureTextEntry
                    />
                    <TouchableOpacity
                      style={[
                        styles.button,
                        styles.configPrimaryButton,
                        isTablet && styles.buttonTablet,
                        creatingOrganization && styles.buttonDisabled
                      ]}
                      onPress={handleCreateOrganization}
                      disabled={creatingOrganization}
                    >
                      {creatingOrganization ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <View style={styles.inlineButtonContent}>
                          <Ionicons name="add-circle-outline" size={18} color="#ffffff" />
                          <Text style={styles.buttonText}>Criar empresa</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.button,
                        styles.configSoftButton,
                        isTablet && styles.buttonTablet,
                        organizationsLoading && styles.buttonDisabled
                      ]}
                      onPress={() => refreshOrganizations().catch(() => undefined)}
                      disabled={organizationsLoading}
                    >
                      <View style={styles.inlineButtonContent}>
                        <Ionicons name="refresh-outline" size={16} color="#175569" />
                        <Text style={styles.secondaryText}>Atualizar lista de empresas</Text>
                      </View>
                    </TouchableOpacity>

                    <View style={styles.organizationList}>
                      {organizations.map((organization) => (
                        <View key={organization.id} style={styles.organizationItem}>
                          <View style={styles.organizationHeader}>
                            <View style={styles.organizationHeaderCopy}>
                              <Text style={styles.organizationName}>{organization.name}</Text>
                              <Text style={styles.organizationMeta}>slug: {organization.slug}</Text>
                            </View>
                            <View style={styles.organizationBadge}>
                              <Text style={styles.organizationBadgeText}>
                                {organization.usersCount ?? 0} usuarios
                              </Text>
                            </View>
                          </View>
                          <View style={styles.organizationSignals}>
                            <View
                              style={[
                                styles.signalChip,
                                organization.hasGhlAccessToken
                                  ? styles.signalChipActive
                                  : styles.signalChipInactive
                              ]}
                            >
                              <Text
                                style={[
                                  styles.signalChipText,
                                  organization.hasGhlAccessToken
                                    ? styles.signalChipTextActive
                                    : styles.signalChipTextInactive
                                ]}
                              >
                                {organization.hasGhlAccessToken
                                  ? "Token Vynor App ok"
                                  : "Falta token Vynor App"}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.signalChip,
                                organization.ghlLocationId
                                  ? styles.signalChipActive
                                  : styles.signalChipInactive
                              ]}
                            >
                              <Text
                                style={[
                                  styles.signalChipText,
                                  organization.ghlLocationId
                                    ? styles.signalChipTextActive
                                    : styles.signalChipTextInactive
                                ]}
                              >
                                {organization.ghlLocationId
                                  ? "Location configurada"
                                  : "Location pendente"}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.organizationMeta}>
                            Logo:{"\n"}{organization.logoUrl || "nao configurada"}
                          </Text>
                          <Text style={styles.organizationMeta}>
                            API Vynor App:{"\n"}{organization.ghlApiBaseUrl || "usar fallback global"}
                          </Text>
                          <Text style={styles.organizationMeta}>
                            Objeto de visitas:{"\n"}{organization.ghlVisitsObjectKey || "nao configurado"}
                          </Text>
                          <TouchableOpacity
                            style={[
                              styles.button,
                              styles.organizationActionButton,
                              isTablet && styles.buttonTablet
                            ]}
                            onPress={() => openOrganizationEditor(organization)}
                          >
                            <View style={styles.inlineButtonContent}>
                              <MaterialCommunityIcons
                                name="tune-variant"
                                size={16}
                                color="#ffffff"
                              />
                              <Text style={styles.buttonText}>Editar empresa</Text>
                            </View>
                          </TouchableOpacity>
                        </View>
                      ))}
                      {!organizations.length ? (
                        <Text style={styles.caption}>Nenhuma empresa cadastrada.</Text>
                      ) : null}
                    </View>
                  </View>
                ) : null}
              </>
            ) : (
              <View style={[styles.panel, isTablet && styles.panelTablet]}>
                <View style={styles.panelHeaderRow}>
                  <View style={styles.panelHeaderTitleRow}>
                    <View style={styles.panelHeaderIcon}>
                      <Ionicons name="cloud-outline" size={16} color="#0b84b7" />
                    </View>
                    <View style={styles.panelHeaderCopy}>
                      <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>
                        Integracao comercial
                      </Text>
                      <Text style={styles.caption}>
                        Atualize seu vinculo e puxe os contatos mais recentes do Vynor App.
                      </Text>
                    </View>
                  </View>
                </View>
                <Text style={styles.organizationMeta}>
                  Empresa atual: {user.organizationName || "nao identificada"}
                </Text>
                <Text style={styles.organizationMeta}>
                  Slug: {user.organizationSlug || "nao informado"}
                </Text>
                <TouchableOpacity
                  style={[styles.button, styles.configSoftButton, isTablet && styles.buttonTablet]}
                  onPress={() => refreshClients(contactQuery.trim() || undefined)}
                >
                  <View style={styles.inlineButtonContent}>
                    <Ionicons name="refresh-outline" size={16} color="#175569" />
                    <Text style={styles.secondaryText}>Atualizar contatos locais</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.configPrimaryButton,
                    syncingGhl && styles.buttonDisabled,
                    isTablet && styles.buttonTablet
                  ]}
                  onPress={() => handleSyncGhl(false)}
                  disabled={syncingGhl}
                >
                  <View style={styles.inlineButtonContent}>
                    <Ionicons name="cloud-download-outline" size={18} color="#ffffff" />
                    <Text style={styles.buttonText}>Sincronizar contatos</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.configSoftButton,
                    syncingGhl && styles.buttonDisabled,
                    isTablet && styles.buttonTablet
                  ]}
                  onPress={() => handleSyncGhl(true)}
                  disabled={syncingGhl}
                >
                  <View style={styles.inlineButtonContent}>
                    <MaterialCommunityIcons
                      name="database-sync-outline"
                      size={16}
                      color="#175569"
                    />
                    <Text style={styles.secondaryText}>Sincronizacao completa</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity style={[styles.button, styles.configDangerButton, isTablet && styles.buttonTablet]} onPress={handleLogout}>
              <View style={styles.inlineButtonContent}>
                <Ionicons name="exit-outline" size={18} color="#ffffff" />
                <Text style={styles.buttonText}>Encerrar sessao</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        <Modal
          visible={organizationEditorVisible}
          transparent
          animationType="slide"
          onRequestClose={closeOrganizationEditor}
        >
          <View style={[styles.modalBackdrop, isTablet && styles.modalBackdropTablet]}>
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              style={styles.modalKeyboard}
            >
              <View style={[styles.modalCard, styles.organizationModalCard, isTablet && styles.modalCardTablet]}>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={styles.organizationEditorHeader}>
                    <View style={styles.panelHeaderCopy}>
                      <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>
                        Configurar empresa
                      </Text>
                      <Text style={styles.caption}>
                        Ajuste slug, credenciais do Vynor App e campos do objeto de visitas.
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.fieldLabel}>Nome da empresa</Text>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    value={organizationEditor.name}
                    onChangeText={(value) =>
                      setOrganizationEditor((current) => ({ ...current, name: value }))
                    }
                    placeholder="Nome da empresa"
                  />

                  <Text style={styles.fieldLabel}>Slug</Text>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    value={organizationEditor.slug}
                    onChangeText={(value) =>
                      setOrganizationEditor((current) => ({ ...current, slug: value }))
                    }
                    placeholder="slug-da-empresa"
                    autoCapitalize="none"
                  />

                  <Text style={styles.fieldLabel}>Logo da empresa</Text>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    value={organizationEditor.logoUrl}
                    onChangeText={(value) =>
                      setOrganizationEditor((current) => ({ ...current, logoUrl: value }))
                    }
                    placeholder="https://empresa.com/logo.png"
                    autoCapitalize="none"
                  />

                  <Text style={styles.fieldLabel}>API base do Vynor App</Text>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    value={organizationEditor.ghlApiBaseUrl}
                    onChangeText={(value) =>
                      setOrganizationEditor((current) => ({ ...current, ghlApiBaseUrl: value }))
                    }
                    placeholder="https://services.leadconnectorhq.com"
                    autoCapitalize="none"
                  />

                  <Text style={styles.fieldLabel}>Location ID</Text>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    value={organizationEditor.ghlLocationId}
                    onChangeText={(value) =>
                      setOrganizationEditor((current) => ({ ...current, ghlLocationId: value }))
                    }
                    placeholder="Location ID"
                    autoCapitalize="none"
                  />

                  <Text style={styles.fieldLabel}>Novo access token do Vynor App</Text>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    value={organizationEditor.ghlAccessToken}
                    onChangeText={(value) =>
                      setOrganizationEditor((current) => ({ ...current, ghlAccessToken: value }))
                    }
                    placeholder="Preencha apenas para trocar o token"
                    autoCapitalize="none"
                    secureTextEntry
                  />
                  <Text style={styles.caption}>
                    Campo sensivel: deixe em branco para manter o token atual.
                  </Text>

                  <Text style={styles.fieldLabel}>Maximo de paginas para sync</Text>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    value={organizationEditor.ghlContactSyncMaxPages}
                    onChangeText={(value) =>
                      setOrganizationEditor((current) => ({
                        ...current,
                        ghlContactSyncMaxPages: value
                      }))
                    }
                    placeholder="200"
                    keyboardType="number-pad"
                  />

                  <Text style={styles.fieldLabel}>Objeto Visitas</Text>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    value={organizationEditor.ghlVisitsObjectKey}
                    onChangeText={(value) =>
                      setOrganizationEditor((current) => ({
                        ...current,
                        ghlVisitsObjectKey: value
                      }))
                    }
                    placeholder="{{ custom_objects.visitas.visitas }}"
                    autoCapitalize="none"
                  />

                  <Text style={styles.fieldLabel}>Campo Cliente</Text>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    value={organizationEditor.ghlVisitsFieldClientNameKey}
                    onChangeText={(value) =>
                      setOrganizationEditor((current) => ({
                        ...current,
                        ghlVisitsFieldClientNameKey: value
                      }))
                    }
                    placeholder="{{ custom_objects.visitas.cliente }}"
                    autoCapitalize="none"
                  />

                  <Text style={styles.fieldLabel}>Campo Proprietario</Text>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    value={organizationEditor.ghlVisitsFieldOwnerKey}
                    onChangeText={(value) =>
                      setOrganizationEditor((current) => ({
                        ...current,
                        ghlVisitsFieldOwnerKey: value
                      }))
                    }
                    placeholder="Campo do proprietario"
                    autoCapitalize="none"
                  />

                  <Text style={styles.fieldLabel}>Campo Data da visita</Text>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    value={organizationEditor.ghlVisitsFieldVisitDateKey}
                    onChangeText={(value) =>
                      setOrganizationEditor((current) => ({
                        ...current,
                        ghlVisitsFieldVisitDateKey: value
                      }))
                    }
                    placeholder="{{ custom_objects.visitas.data_da_visita }}"
                    autoCapitalize="none"
                  />

                  <Text style={styles.fieldLabel}>Campo Observacoes</Text>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    value={organizationEditor.ghlVisitsFieldNotesKey}
                    onChangeText={(value) =>
                      setOrganizationEditor((current) => ({
                        ...current,
                        ghlVisitsFieldNotesKey: value
                      }))
                    }
                    placeholder="{{ custom_objects.visitas.observaes_da_visita }}"
                    autoCapitalize="none"
                  />

                  <Text style={styles.fieldLabel}>Campo Titulo</Text>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    value={organizationEditor.ghlVisitsFieldTitleKey}
                    onChangeText={(value) =>
                      setOrganizationEditor((current) => ({
                        ...current,
                        ghlVisitsFieldTitleKey: value
                      }))
                    }
                    placeholder="Campo de titulo do registro"
                    autoCapitalize="none"
                  />
                </ScrollView>

                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.organizationActionButton,
                    isTablet && styles.buttonTablet,
                    organizationEditorSaving && styles.buttonDisabled
                  ]}
                  onPress={handleSaveOrganization}
                  disabled={organizationEditorSaving}
                >
                  {organizationEditorSaving ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <View style={styles.inlineButtonContent}>
                      <Ionicons name="save-outline" size={18} color="#ffffff" />
                      <Text style={styles.buttonText}>Salvar configuracoes</Text>
                    </View>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.secondaryButton, isTablet && styles.buttonTablet]}
                  onPress={closeOrganizationEditor}
                >
                  <Text style={styles.secondaryText}>Fechar</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>

        <Modal
          visible={Boolean(historyDetail)}
          transparent
          animationType="slide"
          hardwareAccelerated
          onRequestClose={() => setHistoryDetail(null)}
        >
          <View style={[styles.modalBackdrop, isTablet && styles.modalBackdropTablet]}>
            <View style={[styles.modalCard, isTablet && styles.modalCardTablet]}>
              <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>
                {historyDetail ? getVisitDisplayName(historyDetail) : ""}
              </Text>
              <Text style={[styles.historySub, isTablet && styles.historySubTablet]}>
                {historyDetail ? new Date(historyDetail.checkInAt).toLocaleString() : ""}
              </Text>
              <Text
                style={[
                  styles.historyStatus,
                  isTablet && styles.historyStatusTablet,
                  { color: statusColor(historyDetail?.syncStatus || "PENDING") }
                ]}
              >
                Status: {historyDetail ? statusLabel(historyDetail.syncStatus) : ""}
              </Text>
              {historyDetail?.seller ? (
                <Text style={[styles.historySub, isTablet && styles.historySubTablet]}>
                  Vendedor: {historyDetail.seller.name}
                </Text>
              ) : null}
              <Text style={[styles.historySub, isTablet && styles.historySubTablet]}>{historyDetail?.notes}</Text>
              {historyDetail && historyDetailCoordinate && canRenderMap ? (
                <MapView
                  style={[styles.detailMap, isTablet && styles.detailMapTablet]}
                  liteMode={Platform.OS === "android"}
                  initialRegion={{
                    latitude: historyDetailCoordinate.latitude,
                    longitude: historyDetailCoordinate.longitude,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01
                  }}
                >
                  <Marker
                    coordinate={historyDetailCoordinate}
                    title={getVisitDisplayName(historyDetail)}
                  />
                </MapView>
              ) : historyDetail && historyDetailCoordinate ? (
                <Text style={styles.caption}>Mapa indisponivel neste build. Configure `GOOGLE_MAPS_API_KEY`.</Text>
              ) : historyDetail ? (
                <Text style={styles.caption}>Coordenada invalida para exibir no mapa.</Text>
              ) : null}

              {activeTab === "HISTORICO" && historySource === "LOCAL" && historyDetail?.syncStatus === "FAILED" ? (
                <TouchableOpacity
                  style={[styles.button, styles.retryButton, isTablet && styles.buttonTablet]}
                  onPress={async () => {
                    await handleRetryVisit(historyDetail.localVisitId);
                    setHistoryDetail(null);
                  }}
                >
                  <Text style={styles.buttonText}>Tentar novamente</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton, isTablet && styles.buttonTablet]}
                onPress={() => setHistoryDetail(null)}
              >
                <Text style={styles.secondaryText}>Fechar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        </View>
      </ScrollView>
      {!isSuperAdmin ? (
        <View
          style={[
            styles.tabs,
            styles.tabDock,
            isTablet && styles.tabsTablet,
            isTablet && styles.tabDockTablet
          ]}
        >
          {availableTabs.map((tab) => {
            const isActive = activeTab === tab;
            const isPrimaryAction = tab === "VISITA";
            const iconColor = isPrimaryAction || isActive ? "#ffffff" : "#1184b5";

            return (
              <Pressable
                key={tab}
                style={[
                  styles.tabButton,
                  styles.tabDockButton,
                  isTablet && styles.tabButtonTablet,
                  isTablet && styles.tabDockButtonTablet,
                  isPrimaryAction && styles.tabCenterButton,
                  isTablet && isPrimaryAction && styles.tabCenterButtonTablet,
                  isActive && !isPrimaryAction && styles.tabButtonActive
                ]}
                onPress={() => setActiveTab(tab)}
              >
                <View
                  style={[
                    styles.tabIconWrap,
                    isPrimaryAction && styles.tabIconWrapPrimary,
                    isActive && !isPrimaryAction && styles.tabIconWrapActive
                  ]}
                >
                  {renderTabIcon(tab, iconColor, isPrimaryAction ? 24 : 20)}
                </View>
                <Text
                  style={[
                    styles.tabText,
                    isTablet && styles.tabTextTablet,
                    isActive && styles.tabTextActive,
                    isPrimaryAction && styles.tabTextPrimary
                  ]}
                >
                  {tabLabel(tab)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#f3f8fb"
  },
  header: {
    marginTop: 16,
    marginBottom: 12,
    borderRadius: 30,
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderWidth: 1,
    borderColor: "#d9edf7",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    alignItems: "center"
  },
  headerBadgeRow: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10
  },
  headerModeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbeaf2",
    flexShrink: 1,
    maxWidth: "100%"
  },
  headerModeBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#175569",
    flexShrink: 1
  },
  loginRouteHero: {
    width: "100%",
    marginBottom: 14
  },
  loginRouteHeroTablet: {
    maxWidth: 620
  },
  loginRouteShell: {
    height: 136,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#d7edf8",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center"
  },
  loginRouteGlow: {
    position: "absolute",
    top: -24,
    right: -18,
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: "#d7f4ff"
  },
  loginRouteGrid: {
    position: "absolute",
    inset: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 16,
    opacity: 0.55
  },
  loginRouteGridDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#b9dfee"
  },
  routeConnector: {
    position: "absolute",
    height: 5,
    borderRadius: 999,
    backgroundColor: "#bfe8f7"
  },
  routeConnectorLeft: {
    width: 88,
    left: 54,
    top: 78,
    transform: [{ rotate: "-18deg" }]
  },
  routeConnectorMiddle: {
    width: 78,
    left: 126,
    top: 50,
    transform: [{ rotate: "22deg" }]
  },
  routeConnectorRight: {
    width: 86,
    left: 194,
    top: 72,
    transform: [{ rotate: "-18deg" }]
  },
  routeNode: {
    position: "absolute",
    alignItems: "center",
    gap: 6
  },
  routeNodeOrigin: {
    left: 26,
    top: 56
  },
  routeNodeMid: {
    left: 128,
    top: 26
  },
  routeNodeDestination: {
    right: 26,
    top: 52
  },
  routeNodeIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8ecf5",
    alignItems: "center",
    justifyContent: "center"
  },
  routeNodeIconWrapDestination: {
    backgroundColor: "#0b84b7",
    borderColor: "#0b84b7"
  },
  routeNodeLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4f7388",
    textTransform: "uppercase",
    letterSpacing: 0.7
  },
  routeMarker: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -12,
    marginTop: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#ff7a45",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#ff7a45",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6
  },
  routePulse: {
    position: "absolute",
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#91dfff"
  },
  logo: {
    width: 136,
    height: 40,
    marginBottom: 8
  },
  logoFallback: {
    marginBottom: 8,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 1.8,
    color: "#0f172a"
  },
  loginBrandWordmark: {
    color: "#0b84b7"
  },
  brandPill: {
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#0b84b7",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: "#0f172a",
    textAlign: "center"
  },
  subtitle: {
    marginTop: 8,
    fontSize: 16,
    color: "#46657a",
    textAlign: "center"
  },
  syncText: {
    marginTop: 8,
    fontSize: 13,
    color: "#0b84b7",
    textAlign: "center"
  },
  metricsRow: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center"
  },
  metricChip: {
    backgroundColor: "#ffffff",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 96,
    flex: 1,
    maxWidth: 132,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#dbeaf2"
  },
  metricLabel: {
    fontSize: 12,
    color: "#5b7385"
  },
  metricValue: {
    marginTop: 3,
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a"
  },
  caption: {
    marginTop: 4,
    fontSize: 12,
    color: "#648198",
    lineHeight: 18,
    flexShrink: 1
  },
  form: {
    gap: 14
  },
  panel: {
    backgroundColor: "#fcfeff",
    borderColor: "#d9ebf5",
    borderWidth: 1,
    borderRadius: 26,
    padding: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  panelHeaderRow: {
    marginBottom: 10
  },
  panelHeaderTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10
  },
  panelHeaderCopy: {
    flex: 1,
    minWidth: 0
  },
  panelHeaderIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#e6f6fb",
    alignItems: "center",
    justifyContent: "center"
  },
  searchRow: {
    flexDirection: "row",
    gap: 8
  },
  searchInput: {
    flex: 1
  },
  searchButton: {
    width: 96
  },
  newClientButton: {
    marginTop: 10
  },
  syncActionButton: {
    backgroundColor: "#eefaff",
    borderWidth: 1,
    borderColor: "#d4eef8"
  },
  managerRefreshButton: {
    marginTop: 8
  },
  managerSellerList: {
    gap: 10,
    marginTop: 6
  },
  managerSellerCard: {
    backgroundColor: "#f8fcff",
    borderWidth: 1,
    borderColor: "#d7edf7",
    borderRadius: 20,
    padding: 14,
    gap: 8
  },
  tabs: {
    flexDirection: "row"
  },
  tabDock: {
    marginTop: 10,
    marginBottom: 18,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 14,
    borderRadius: 28,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9ebf5",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 8,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6
  },
  tabDockButton: {
    flex: 1,
    height: 62,
    backgroundColor: "transparent",
    borderRadius: 24,
    justifyContent: "flex-end",
    paddingBottom: 4
  },
  tabCenterButton: {
    height: 84,
    marginTop: -28,
    backgroundColor: "#0b84b7",
    borderWidth: 1,
    borderColor: "#0b84b7",
    shadowColor: "#0b84b7",
    shadowOpacity: 0.26,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10
  },
  tabIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e9f7fc",
    marginBottom: 4
  },
  tabIconWrapPrimary: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(255,255,255,0.18)"
  },
  tabIconWrapActive: {
    backgroundColor: "#0b84b7"
  },
  tabButton: {
    alignItems: "center",
    justifyContent: "center"
  },
  tabButtonActive: {
    backgroundColor: "#eaf8ff"
  },
  tabText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#516c80",
    textAlign: "center"
  },
  tabTextActive: {
    color: "#0b84b7"
  },
  tabTextPrimary: {
    color: "#ffffff"
  },
  content: {
    marginTop: 6,
    flex: 1
  },
  authKeyboard: {
    flex: 1
  },
  authScroll: {
    flex: 1
  },
  authScrollContent: {
    flexGrow: 1,
    paddingBottom: 36
  },
  contentWrap: {
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    paddingBottom: 24
  },
  input: {
    backgroundColor: "#f8fbfd",
    borderColor: "#d6e8f2",
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#0f172a"
  },
  passwordField: {
    position: "relative",
    justifyContent: "center"
  },
  passwordInput: {
    paddingRight: 48
  },
  passwordToggle: {
    position: "absolute",
    right: 14,
    height: "100%",
    justifyContent: "center"
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: "top"
  },
  button: {
    minHeight: 46,
    backgroundColor: "#0b84b7",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  secondaryButton: {
    backgroundColor: "#f1f8fc",
    borderWidth: 1,
    borderColor: "#d8ecf5"
  },
  dangerButton: {
    backgroundColor: "#b91c1c"
  },
  configPrimaryButton: {
    marginTop: 8,
    backgroundColor: "#0b84b7"
  },
  configSoftButton: {
    marginTop: 8,
    backgroundColor: "#f3fbfe",
    borderWidth: 1,
    borderColor: "#d4eef8"
  },
  configDangerButton: {
    backgroundColor: "#9f1239"
  },
  buttonDisabled: {
    opacity: 0.6
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1
  },
  secondaryText: {
    color: "#175569",
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1
  },
  inlineButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    flexWrap: "wrap"
  },
  inlineHintRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  label: {
    fontSize: 14,
    color: "#1f2937"
  },
  fieldLabel: {
    marginTop: 10,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: "700",
    color: "#5c7285",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  authModeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 4
  },
  authModeChip: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d8ecf5",
    backgroundColor: "#f4fbfe",
    paddingVertical: 10,
    alignItems: "center"
  },
  authModeChipActive: {
    backgroundColor: "#0b84b7",
    borderColor: "#0b84b7"
  },
  authModeChipText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#175569"
  },
  authModeChipTextActive: {
    color: "#ffffff"
  },
  clientList: {
    gap: 10
  },
  organizationList: {
    marginTop: 14,
    gap: 12
  },
  organizationItem: {
    backgroundColor: "#f8fcff",
    borderWidth: 1,
    borderColor: "#d7edf7",
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 14
  },
  organizationHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 8
  },
  organizationHeaderCopy: {
    flex: 1,
    minWidth: 0
  },
  organizationBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#e8f7fc"
  },
  organizationBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0b84b7"
  },
  organizationSignals: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
    marginBottom: 4
  },
  signalChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999
  },
  signalChipActive: {
    backgroundColor: "#dcf8e6"
  },
  signalChipInactive: {
    backgroundColor: "#fef2f2"
  },
  signalChipText: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    flexShrink: 1
  },
  signalChipTextActive: {
    color: "#0f766e"
  },
  signalChipTextInactive: {
    color: "#b91c1c"
  },
  organizationActionButton: {
    marginTop: 12,
    backgroundColor: "#0b84b7"
  },
  organizationName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    flexShrink: 1
  },
  organizationMeta: {
    marginTop: 4,
    fontSize: 12,
    color: "#648198",
    lineHeight: 18,
    width: "100%"
  },
  clientItem: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8ecf5",
    padding: 14,
    borderRadius: 22,
    shadowColor: "#0f172a",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2
  },
  clientRowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 8
  },
  clientTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    paddingRight: 10
  },
  clientAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#e9f7fc",
    alignItems: "center",
    justifyContent: "center"
  },
  clientAvatarText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#0b84b7"
  },
  clientItemSelected: {
    borderColor: "#0b84b7",
    borderWidth: 2
  },
  ctaBadge: {
    backgroundColor: "#e9f7fc",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  ctaBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#0b84b7"
  },
  clientName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
    flexShrink: 1
  },
  clientMeta: {
    marginTop: 2,
    fontSize: 12,
    color: "#64748b",
    lineHeight: 18
  },
  pendingTag: {
    marginTop: 4,
    fontSize: 11,
    color: "#c28012",
    fontWeight: "700"
  },
  sectionTitle: {
    marginTop: 2,
    marginBottom: 2,
    fontSize: 18,
    fontWeight: "700",
    color: "#111827"
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  filterSection: {
    marginTop: 12,
    gap: 8
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#334155"
  },
  filterChip: {
    borderWidth: 1,
    borderColor: "#d5e7f1",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#ffffff"
  },
  filterChipActive: {
    backgroundColor: "#0b84b7",
    borderColor: "#0b84b7"
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155"
  },
  filterChipTextActive: {
    color: "#fff"
  },
  filterCustomRow: {
    flexDirection: "row",
    gap: 8
  },
  filterInput: {
    flex: 1
  },
  dateButtonLabel: {
    fontSize: 14,
    color: "#0f172a",
    fontWeight: "500"
  },
  historyItem: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8ecf5",
    borderRadius: 22,
    padding: 14
  },
  historyMain: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
    flex: 1,
    minWidth: 0
  },
  historySub: {
    marginTop: 2,
    fontSize: 12,
    color: "#475569",
    lineHeight: 18
  },
  historyStatus: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "700",
    flexShrink: 1
  },
  errorTitle: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "700",
    color: "#7f1d1d"
  },
  errorMessage: {
    marginTop: 3,
    fontSize: 12,
    color: "#991b1b"
  },
  retryButton: {
    marginTop: 8,
    height: 40,
    backgroundColor: "#b91c1c"
  },
  map: {
    width: "100%",
    height: 320,
    borderRadius: 24
  },
  mapFallback: {
    width: "100%",
    minHeight: 120,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#d8ecf5",
    backgroundColor: "#ffffff",
    padding: 16,
    justifyContent: "center"
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.24)",
    justifyContent: "flex-end",
    padding: 12
  },
  modalKeyboard: {
    width: "100%"
  },
  modalCard: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 16,
    gap: 10
  },
  organizationModalCard: {
    maxHeight: "88%"
  },
  organizationEditorHeader: {
    marginBottom: 8
  },
  detailMap: {
    width: "100%",
    height: 220,
    borderRadius: 20
  },
  containerTablet: {
    paddingHorizontal: 28,
    paddingTop: 8
  },
  headerTablet: {
    marginTop: 12,
    borderRadius: 34,
    paddingHorizontal: 36,
    paddingVertical: 30
  },
  logoTablet: {
    width: 172,
    height: 48
  },
  logoFallbackTablet: {
    fontSize: 24
  },
  brandPillTablet: {
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 6
  },
  titleTablet: {
    fontSize: 42
  },
  subtitleTablet: {
    fontSize: 20,
    marginTop: 10
  },
  syncTextTablet: {
    fontSize: 16
  },
  metricsRowTablet: {
    gap: 18
  },
  metricChipTablet: {
    minWidth: 140,
    maxWidth: 200,
    paddingHorizontal: 22,
    paddingVertical: 14
  },
  metricLabelTablet: {
    fontSize: 14
  },
  metricValueTablet: {
    fontSize: 20
  },
  formTablet: {
    gap: 16
  },
  panelTablet: {
    padding: 20,
    borderRadius: 28
  },
  tabsTablet: {
    justifyContent: "center",
    gap: 12
  },
  tabButtonTablet: {
    flex: 0,
    minWidth: 128,
    height: 48
  },
  tabDockTablet: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12
  },
  tabDockButtonTablet: {
    minWidth: 132,
    height: 78
  },
  tabCenterButtonTablet: {
    height: 98,
    minWidth: 142
  },
  tabTextTablet: {
    fontSize: 14,
    letterSpacing: 0.4
  },
  contentWrapTablet: {
    maxWidth: 1180,
    paddingBottom: 36
  },
  authScrollContentTablet: {
    paddingBottom: 48
  },
  inputTablet: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16
  },
  buttonTablet: {
    minHeight: 52
  },
  labelTablet: {
    fontSize: 16
  },
  sectionTitleTablet: {
    fontSize: 20
  },
  visitBody: {
    gap: 12
  },
  visitBodyTablet: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16
  },
  visitPrimaryColumn: {
    gap: 12
  },
  visitPrimaryColumnTablet: {
    width: 420
  },
  visitListTablet: {
    flex: 1,
    gap: 12
  },
  clientItemTablet: {
    padding: 16
  },
  clientNameTablet: {
    fontSize: 16
  },
  clientMetaTablet: {
    fontSize: 13
  },
  filterChipTablet: {
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  filterChipTextTablet: {
    fontSize: 14
  },
  historyList: {
    gap: 8
  },
  historyListTablet: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "stretch",
    gap: 12
  },
  historyItemTablet: {
    width: "48%",
    minHeight: 120,
    padding: 14
  },
  historyMainTablet: {
    fontSize: 16
  },
  historySubTablet: {
    fontSize: 13
  },
  historyStatusTablet: {
    fontSize: 13
  },
  mapTablet: {
    height: 460,
    borderRadius: 16
  },
  configGrid: {
    gap: 12
  },
  configGridTablet: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16
  },
  configPanelTablet: {
    flex: 1
  },
  modalBackdropTablet: {
    justifyContent: "center",
    alignItems: "center",
    padding: 24
  },
  modalCardTablet: {
    width: "100%",
    maxWidth: 760,
    borderRadius: 28,
    padding: 22
  },
  detailMapTablet: {
    height: 320
  }
});


