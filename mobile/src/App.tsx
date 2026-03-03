import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  View
} from "react-native";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import MapView, { Marker } from "react-native-maps";
import { LinearGradient } from "expo-linear-gradient";
import {
  addVisitToQueue,
  countUnsyncedVisits,
  getCachedClients,
  getSetting,
  initDb,
  listRecentLocalVisits,
  replaceClientsCache,
  setSetting
} from "./db/database";
import { getCurrentLocation } from "./services/location";
import { retryVisitSync, syncPendingVisits } from "./services/sync";
import { API_BASE_URL } from "./services/config";
import {
  fetchAdminSellers,
  fetchAdminVisits,
  fetchClients,
  fetchVisits,
  syncGhlContacts,
  type AdminVisitItem,
  type SellerItem
} from "./services/api";
import {
  clearAuthToken,
  getAuthToken,
  login,
  me,
  register,
  saveAuthToken,
  updateMyGhlUserId,
  type AuthUser
} from "./services/auth";
import type { ClientItem, PendingVisit } from "./types";

type ActiveTab = "VISITA" | "HISTORICO" | "MAPA" | "GERENCIA" | "CONFIG";
type AuthMode = "LOGIN" | "REGISTER";
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
const MAX_MAP_MARKERS = 300;

function makeLocalVisitId() {
  return `local-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

const TRINIT_LOGO_URL = "https://trinit.ind.br/wp-content/themes/trinit/assets/images/logo-trinit.svg";

function statusColor(status: PendingVisit["syncStatus"]) {
  if (status === "SYNCED") {
    return "#166534";
  }
  if (status === "FAILED") {
    return "#b91c1c";
  }
  return "#92400e";
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

function parseInputDate(value: string, end = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return end ? endOfDay(parsed) : startOfDay(parsed);
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

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("VISITA");
  const [apiBaseUrl, setApiBaseUrl] = useState(API_BASE_URL);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("LOGIN");
  const [authLoading, setAuthLoading] = useState(false);

  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [ghlUserIdInput, setGhlUserIdInput] = useState("");

  const [clients, setClients] = useState<ClientItem[]>([]);
  const [contactQuery, setContactQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [visitModalVisible, setVisitModalVisible] = useState(false);
  const [localHistory, setLocalHistory] = useState<PendingVisit[]>([]);
  const [serverHistory, setServerHistory] = useState<VisitItem[]>([]);
  const [managerHistory, setManagerHistory] = useState<AdminVisitItem[]>([]);
  const [managerSellers, setManagerSellers] = useState<SellerItem[]>([]);
  const [managerSellerId, setManagerSellerId] = useState("");
  const [managerLoading, setManagerLoading] = useState(false);
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
  const [loadingClients, setLoadingClients] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastLocation, setLastLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [lastSyncText, setLastSyncText] = useState("Sem sincronizacao recente");
  const [logoFailed, setLogoFailed] = useState(false);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId),
    [clients, selectedClientId]
  );

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
  const isMaster = user?.role === "MASTER";
  const availableTabs = useMemo(
    () => (isMaster ? (["VISITA", "HISTORICO", "MAPA", "GERENCIA", "CONFIG"] as ActiveTab[]) : (["VISITA", "HISTORICO", "MAPA", "CONFIG"] as ActiveTab[])),
    [isMaster]
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

  const refreshClients = useCallback(async (query?: string) => {
    if (!token || !user) {
      return;
    }
    setLoadingClients(true);
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
        if (!cached.length) {
          Alert.alert("Clientes", error instanceof Error ? error.message : "Falha ao carregar clientes");
        }
      } else {
        Alert.alert("Busca", error instanceof Error ? error.message : "Falha ao buscar contatos");
      }
    } finally {
      setLoadingClients(false);
    }
  }, [apiBaseUrl, selectedClientId, token, user]);

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
    if (!token || !isMaster) {
      return;
    }
    setManagerLoading(true);
    try {
      const [sellers, visits] = await Promise.all([
        fetchAdminSellers({ apiBaseUrl, token }),
        fetchAdminVisits({ apiBaseUrl, token }, { limit: 1000 })
      ]);
      setManagerSellers(sellers);
      setManagerHistory(visits);
    } catch (error) {
      Alert.alert("Gerencia", error instanceof Error ? error.message : "Falha ao carregar dados");
    } finally {
      setManagerLoading(false);
    }
  }, [apiBaseUrl, isMaster, token]);

  const runSync = useCallback(async (options?: { silent?: boolean }) => {
    if (!token) {
      return;
    }
    setSyncing(true);
    try {
      const result = await syncPendingVisits(apiBaseUrl, token);
      await refreshLocalData();
      await refreshServerHistory();
      if (!result.skipped && !options?.silent) {
        Alert.alert("Sincronizacao", `Sincronizadas: ${result.synced} | Falhas: ${result.failed}`);
      }
      if (!result.skipped) {
        const now = new Date();
        setLastSyncText(
          `${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${result.synced} ok / ${result.failed} falhas`
        );
      }
    } catch (error) {
      if (!options?.silent) {
        Alert.alert("Erro de sync", error instanceof Error ? error.message : "Erro inesperado");
      }
      setLastSyncText("Sincronizacao com erro");
    } finally {
      setSyncing(false);
    }
  }, [apiBaseUrl, refreshLocalData, refreshServerHistory, token]);

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
        setGhlUserIdInput(currentUser.ghlUserId ?? "");
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
      }
    });

    return () => unsubscribe();
  }, [runSync, token]);

  useEffect(() => {
    refreshServerHistory().catch(() => undefined);
  }, [refreshServerHistory]);

  useEffect(() => {
    refreshManagerData().catch(() => undefined);
  }, [refreshManagerData]);

  useEffect(() => {
    if (!isMaster && activeTab === "GERENCIA") {
      setActiveTab("VISITA");
    }
  }, [activeTab, isMaster]);

  const handleSearchContacts = useCallback(async () => {
    const query = contactQuery.trim();
    if (query.length < 2) {
      setClients([]);
      setSelectedClientId("");
      return;
    }
    await refreshClients(query);
  }, [contactQuery, refreshClients]);

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
    if (!normalizedApi || !authEmail.trim() || !authPassword.trim()) {
      Alert.alert("Dados obrigatorios", "Informe API URL, email e senha.");
      return;
    }

    setAuthLoading(true);
    try {
      const authResponse =
        authMode === "LOGIN"
          ? await login(normalizedApi, {
              email: authEmail.trim(),
              password: authPassword
            })
          : await register(normalizedApi, {
              name: authName.trim() || authEmail.split("@")[0],
              email: authEmail.trim(),
              password: authPassword
            });

      await setSetting("api_base_url", normalizedApi);
      await saveAuthToken(authResponse.token);
      setApiBaseUrl(normalizedApi);
      setToken(authResponse.token);
      setUser(authResponse.user);
      setGhlUserIdInput(authResponse.user.ghlUserId ?? "");
      setAuthPassword("");
      Alert.alert("Autenticado", `Bem-vindo, ${authResponse.user.name}.`);
    } catch (error) {
      Alert.alert("Falha de autenticacao", error instanceof Error ? error.message : "Erro inesperado");
    } finally {
      setAuthLoading(false);
    }
  }, [apiBaseUrl, authEmail, authMode, authName, authPassword]);

  const handleLogout = useCallback(async () => {
    await clearAuthToken();
    setToken(null);
    setUser(null);
    setClients([]);
    setSelectedClientId("");
    setServerHistory([]);
    setGhlUserIdInput("");
    setManagerHistory([]);
    setManagerSellers([]);
    setManagerSellerId("");
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
        if (contactQuery.trim().length >= 2) {
          await refreshClients(contactQuery.trim());
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
    [apiBaseUrl, contactQuery, refreshClients, token]
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

  const handleSaveGhlUserId = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const updated = await updateMyGhlUserId(apiBaseUrl, token, ghlUserIdInput);
      setUser(updated);
      setGhlUserIdInput(updated.ghlUserId ?? "");
      Alert.alert("Perfil", "Vinculo de usuario salvo.");
    } catch (error) {
      Alert.alert("Perfil", error instanceof Error ? error.message : "Falha ao salvar vinculo");
    }
  }, [apiBaseUrl, ghlUserIdInput, token]);

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
      <SafeAreaView style={styles.container}>
        <LinearGradient colors={["#0f3b2e", "#1f7a54"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
          {!logoFailed ? (
            <Image
              source={{ uri: TRINIT_LOGO_URL }}
              style={styles.logo}
              resizeMode="contain"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <Text style={styles.logoFallback}>TRINIT</Text>
          )}
          <Text style={styles.title}>Trinit Visitas</Text>
          <Text style={styles.subtitle}>Acesso protegido</Text>
        </LinearGradient>
        <View style={styles.contentWrap}>
          <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={apiBaseUrl}
            onChangeText={setApiBaseUrl}
            placeholder="API Base URL"
            autoCapitalize="none"
          />
          {authMode === "REGISTER" ? (
            <TextInput
              style={styles.input}
              value={authName}
              onChangeText={setAuthName}
              placeholder="Nome"
              autoCapitalize="words"
            />
          ) : null}
          <TextInput
            style={styles.input}
            value={authEmail}
            onChangeText={setAuthEmail}
            placeholder="Email"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            value={authPassword}
            onChangeText={setAuthPassword}
            placeholder="Senha"
            secureTextEntry
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.button} onPress={handleAuth} disabled={authLoading}>
            {authLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {authMode === "LOGIN" ? "Entrar" : "Criar conta"}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={() => setAuthMode((mode) => (mode === "LOGIN" ? "REGISTER" : "LOGIN"))}
          >
            <Text style={styles.secondaryText}>
              {authMode === "LOGIN" ? "Ir para cadastro" : "Ir para login"}
            </Text>
          </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient colors={["#0f3b2e", "#1f7a54"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
        {!logoFailed ? (
          <Image
            source={{ uri: TRINIT_LOGO_URL }}
            style={styles.logo}
            resizeMode="contain"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <Text style={styles.logoFallback}>TRINIT</Text>
        )}
        <Text style={styles.title}>Trinit Visitas</Text>
        <Text style={styles.subtitle}>Usuario: {user.name}</Text>
        <Text style={styles.syncText}>{lastSyncText}</Text>
        <View style={styles.metricsRow}>
          <View style={styles.metricChip}>
            <Text style={styles.metricLabel}>Pendentes</Text>
            <Text style={styles.metricValue}>{pendingCount}</Text>
          </View>
          <View style={styles.metricChip}>
            <Text style={styles.metricLabel}>Rede</Text>
            <Text style={styles.metricValue}>{online === null ? "..." : online ? "Online" : "Offline"}</Text>
          </View>
        </View>
      </LinearGradient>
      <View style={styles.tabs}>
        {availableTabs.map((tab) => (
          <Pressable
            key={tab}
            style={[styles.tabButton, activeTab === tab && styles.tabButtonActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === "GERENCIA" ? "GESTAO" : tab}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.contentWrap}>
        {activeTab === "VISITA" && (
          <View style={styles.form}>
            <View style={styles.panel}>
              <Text style={styles.label}>Pesquise o contato para registrar a visita.</Text>
              <View style={styles.searchRow}>
                <TextInput
                  style={[styles.input, styles.searchInput]}
                  value={contactQuery}
                  onChangeText={setContactQuery}
                  placeholder="Nome, email ou telefone"
                />
                <TouchableOpacity
                  style={[styles.button, styles.searchButton]}
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
              <Text style={styles.caption}>Dica: digite ao menos 2 caracteres.</Text>
            </View>

            <View style={styles.clientList}>
              {clients.map((client) => (
                <TouchableOpacity
                  key={client.id}
                  style={[
                    styles.clientItem,
                    selectedClientId === client.id && styles.clientItemSelected
                  ]}
                  onPress={() => {
                    setSelectedClientId(client.id);
                    setVisitModalVisible(true);
                  }}
                >
                  <View style={styles.clientRowTop}>
                    <Text style={styles.clientName}>{client.name}</Text>
                    <View style={styles.ctaBadge}>
                      <Text style={styles.ctaBadgeText}>Registrar</Text>
                    </View>
                  </View>
                  <Text style={styles.clientMeta}>{client.phone || client.email || client.id}</Text>
                </TouchableOpacity>
              ))}
              {!clients.length && !loadingClients ? (
                <Text style={styles.caption}>Nenhum contato em tela. Use a busca.</Text>
              ) : null}
            </View>

            <TouchableOpacity
              style={[styles.button, styles.secondaryButton, syncing && styles.buttonDisabled]}
              onPress={() => {
                runSync().catch(() => undefined);
              }}
              disabled={syncing}
            >
              {syncing ? (
                <ActivityIndicator color="#111" />
              ) : (
                <Text style={styles.secondaryText}>Sincronizar agora</Text>
              )}
            </TouchableOpacity>

            <Modal
              visible={visitModalVisible}
              transparent
              animationType="slide"
              onRequestClose={() => setVisitModalVisible(false)}
            >
              <View style={styles.modalBackdrop}>
                <KeyboardAvoidingView
                  behavior={Platform.OS === "ios" ? "padding" : undefined}
                  style={styles.modalKeyboard}
                >
                  <View style={styles.modalCard}>
                    <Text style={styles.sectionTitle}>Registrar visita</Text>
                    <Text style={styles.label}>
                      Contato: {selectedClient ? selectedClient.name : "Nenhum selecionado"}
                    </Text>
                    <Text style={styles.clientMeta}>
                      {selectedClient?.phone || selectedClient?.email || selectedClient?.id || ""}
                    </Text>

                    <TextInput
                      style={[styles.input, styles.textArea]}
                      value={visitNotes}
                      onChangeText={setVisitNotes}
                      placeholder="Observacoes da visita"
                      multiline
                      numberOfLines={4}
                    />

                    <TouchableOpacity
                      style={[styles.button, !canSubmit && styles.buttonDisabled]}
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
                      style={[styles.button, styles.secondaryButton]}
                      onPress={() => setVisitModalVisible(false)}
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
          <View style={styles.form}>
            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Filtro de periodo</Text>
              <View style={styles.filterRow}>
                {(["TODAY", "7D", "15D", "30D", "CUSTOM"] as HistoryPreset[]).map((preset) => (
                  <TouchableOpacity
                    key={preset}
                    style={[styles.filterChip, historyPreset === preset && styles.filterChipActive]}
                    onPress={() => setHistoryPreset(preset)}
                  >
                    <Text style={[styles.filterChipText, historyPreset === preset && styles.filterChipTextActive]}>
                      {preset === "TODAY" ? "Hoje" : preset === "CUSTOM" ? "Custom" : preset}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {historyPreset === "CUSTOM" ? (
                <View style={styles.filterCustomRow}>
                  <TouchableOpacity style={[styles.input, styles.filterInput]} onPress={() => setShowFromPicker(true)}>
                    <Text style={styles.dateButtonLabel}>De: {toIsoDateInput(customFromDate)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.input, styles.filterInput]} onPress={() => setShowToPicker(true)}>
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
                style={[styles.filterChip, historySource === "LOCAL" && styles.filterChipActive]}
                onPress={() => setHistorySource("LOCAL")}
              >
                <Text style={[styles.filterChipText, historySource === "LOCAL" && styles.filterChipTextActive]}>
                  No aparelho
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterChip, historySource === "SERVER" && styles.filterChipActive]}
                onPress={() => setHistorySource("SERVER")}
              >
                <Text style={[styles.filterChipText, historySource === "SERVER" && styles.filterChipTextActive]}>
                  No servidor
                </Text>
              </TouchableOpacity>
            </View>

            {displayedHistory.map((visit) => (
              <TouchableOpacity
                key={`${historySource}-${visit.localVisitId}`}
                style={styles.historyItem}
                onPress={() => setHistoryDetail(visit)}
              >
                <View style={styles.clientRowTop}>
                  <Text style={styles.historyMain}>{getVisitDisplayName(visit)}</Text>
                  <Text style={[styles.historyStatus, { color: statusColor(visit.syncStatus) }]}>
                    {statusLabel(visit.syncStatus)}
                  </Text>
                </View>
                <Text style={styles.historySub}>{new Date(visit.checkInAt).toLocaleString()}</Text>
                <Text style={styles.historySub} numberOfLines={2}>
                  {visit.notes}
                </Text>
                {visit.syncStatus === "FAILED" ? (
                  <Text style={styles.errorMessage} numberOfLines={2}>
                    {visit.lastError || "Erro desconhecido"}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))}
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
          <View style={styles.form}>
            <Text style={styles.label}>Pontos de visitas realizadas no periodo filtrado</Text>
            {mapMarkers.length ? (
              <MapView
                style={styles.map}
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
              Offline: a captura GPS continua funcionando sem rede. O mapa depende dos tiles disponiveis no aparelho.
            </Text>
            {mapMarkers.length >= MAX_MAP_MARKERS ? (
              <Text style={styles.caption}>Mostrando os 300 pontos mais recentes para manter estabilidade.</Text>
            ) : null}
          </View>
        )}

        {activeTab === "GERENCIA" && isMaster && (
          <View style={styles.form}>
            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Gestao de visitas</Text>
              <Text style={styles.caption}>Visao consolidada do time de vendas.</Text>
              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>Filtro de periodo</Text>
                <View style={styles.filterRow}>
                  {(["TODAY", "7D", "15D", "30D", "CUSTOM"] as HistoryPreset[]).map((preset) => (
                    <TouchableOpacity
                      key={`manager-${preset}`}
                      style={[styles.filterChip, historyPreset === preset && styles.filterChipActive]}
                      onPress={() => setHistoryPreset(preset)}
                    >
                      <Text style={[styles.filterChipText, historyPreset === preset && styles.filterChipTextActive]}>
                        {preset === "TODAY" ? "Hoje" : preset === "CUSTOM" ? "Custom" : preset}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {historyPreset === "CUSTOM" ? (
                  <View style={styles.filterCustomRow}>
                    <TouchableOpacity style={[styles.input, styles.filterInput]} onPress={() => setShowFromPicker(true)}>
                      <Text style={styles.dateButtonLabel}>De: {toIsoDateInput(customFromDate)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.input, styles.filterInput]} onPress={() => setShowToPicker(true)}>
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
                    style={[styles.filterChip, managerSellerId === "" && styles.filterChipActive]}
                    onPress={() => setManagerSellerId("")}
                  >
                    <Text style={[styles.filterChipText, managerSellerId === "" && styles.filterChipTextActive]}>
                      Todos
                    </Text>
                  </TouchableOpacity>
                  {managerSellers.map((seller) => (
                    <TouchableOpacity
                      key={seller.id}
                      style={[styles.filterChip, managerSellerId === seller.id && styles.filterChipActive]}
                      onPress={() => setManagerSellerId(seller.id)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
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

            {filteredManagerHistory.map((visit) => (
              <TouchableOpacity
                key={`manager-${visit.localVisitId}`}
                style={styles.historyItem}
                onPress={() => setHistoryDetail(visit)}
              >
                <View style={styles.clientRowTop}>
                  <Text style={styles.historyMain}>{visit.seller?.name || visit.sellerId}</Text>
                  <Text style={[styles.historyStatus, { color: statusColor(visit.syncStatus) }]}>
                    {statusLabel(visit.syncStatus)}
                  </Text>
                </View>
                <Text style={styles.historySub}>{getVisitDisplayName(visit)}</Text>
                <Text style={styles.historySub}>{new Date(visit.checkInAt).toLocaleString()}</Text>
                <Text style={styles.historySub} numberOfLines={1}>
                  {visit.notes}
                </Text>
              </TouchableOpacity>
            ))}
            {!filteredManagerHistory.length ? (
              <Text style={styles.caption}>Sem visitas para os filtros selecionados.</Text>
            ) : null}
          </View>
        )}

        {activeTab === "CONFIG" && (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={apiBaseUrl}
              onChangeText={setApiBaseUrl}
              placeholder="API Base URL"
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.button} onPress={handleSaveConfig}>
              <Text style={styles.buttonText}>Salvar configuracao</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              value={ghlUserIdInput}
              onChangeText={setGhlUserIdInput}
              placeholder="ID do usuario no GHL (opcional)"
              autoCapitalize="none"
            />
            <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={handleSaveGhlUserId}>
              <Text style={styles.secondaryText}>Salvar vinculo do usuario</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => refreshClients(contactQuery.trim() || undefined)}
            >
              <Text style={styles.secondaryText}>Atualizar clientes</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, syncingGhl && styles.buttonDisabled]}
              onPress={() => handleSyncGhl(false)}
              disabled={syncingGhl}
            >
              <Text style={styles.buttonText}>Sincronizar contatos</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton, syncingGhl && styles.buttonDisabled]}
              onPress={() => handleSyncGhl(true)}
              disabled={syncingGhl}
            >
              <Text style={styles.secondaryText}>Sincronizacao completa</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={handleLogout}>
              <Text style={styles.buttonText}>Sair</Text>
            </TouchableOpacity>
          </View>
        )}

        <Modal
          visible={Boolean(historyDetail)}
          transparent
          animationType="slide"
          hardwareAccelerated
          onRequestClose={() => setHistoryDetail(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.sectionTitle}>
                {historyDetail ? getVisitDisplayName(historyDetail) : ""}
              </Text>
              <Text style={styles.historySub}>
                {historyDetail ? new Date(historyDetail.checkInAt).toLocaleString() : ""}
              </Text>
              <Text style={[styles.historyStatus, { color: statusColor(historyDetail?.syncStatus || "PENDING") }]}>
                Status: {historyDetail ? statusLabel(historyDetail.syncStatus) : ""}
              </Text>
              {historyDetail?.seller ? (
                <Text style={styles.historySub}>Vendedor: {historyDetail.seller.name}</Text>
              ) : null}
              <Text style={styles.historySub}>{historyDetail?.notes}</Text>
              {historyDetail && historyDetailCoordinate ? (
                <MapView
                  style={styles.detailMap}
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
              ) : historyDetail ? (
                <Text style={styles.caption}>Coordenada invalida para exibir no mapa.</Text>
              ) : null}

              {activeTab === "HISTORICO" && historySource === "LOCAL" && historyDetail?.syncStatus === "FAILED" ? (
                <TouchableOpacity
                  style={[styles.button, styles.retryButton]}
                  onPress={async () => {
                    await handleRetryVisit(historyDetail.localVisitId);
                    setHistoryDetail(null);
                  }}
                >
                  <Text style={styles.buttonText}>Tentar novamente</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={() => setHistoryDetail(null)}
              >
                <Text style={styles.secondaryText}>Fechar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#edf2f7"
  },
  header: {
    marginTop: 24,
    marginBottom: 16,
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingVertical: 22,
    alignItems: "center"
  },
  logo: {
    width: 120,
    height: 34,
    marginBottom: 8
  },
  logoFallback: {
    marginBottom: 8,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 1,
    color: "#f8fafc"
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center"
  },
  subtitle: {
    marginTop: 8,
    fontSize: 16,
    color: "#dbeafe",
    textAlign: "center"
  },
  syncText: {
    marginTop: 8,
    fontSize: 13,
    color: "#bbf7d0",
    textAlign: "center"
  },
  metricsRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 12,
    justifyContent: "center"
  },
  metricChip: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 122,
    alignItems: "center"
  },
  metricLabel: {
    fontSize: 12,
    color: "#d1fae5"
  },
  metricValue: {
    marginTop: 3,
    fontSize: 15,
    fontWeight: "700",
    color: "#fff"
  },
  caption: {
    marginTop: 4,
    fontSize: 12,
    color: "#475569"
  },
  form: {
    gap: 12
  },
  panel: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe3ee",
    borderWidth: 1,
    borderRadius: 18,
    padding: 12
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
  managerRefreshButton: {
    marginTop: 8
  },
  tabs: {
    flexDirection: "row",
    gap: 8
  },
  tabButton: {
    flex: 1,
    backgroundColor: "#e5e7eb",
    borderRadius: 999,
    height: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  tabButtonActive: {
    backgroundColor: "#166534"
  },
  tabText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#334155"
  },
  tabTextActive: {
    color: "#fff"
  },
  content: {
    marginTop: 12
  },
  contentWrap: {
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    paddingBottom: 24
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#0f172a"
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: "top"
  },
  button: {
    height: 46,
    backgroundColor: "#166534",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryButton: {
    backgroundColor: "#eef2f7"
  },
  dangerButton: {
    backgroundColor: "#b91c1c"
  },
  buttonDisabled: {
    opacity: 0.6
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600"
  },
  secondaryText: {
    color: "#1f2937",
    fontWeight: "600"
  },
  label: {
    fontSize: 14,
    color: "#1f2937"
  },
  clientList: {
    gap: 8
  },
  clientItem: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbe3ee",
    padding: 10,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1
  },
  clientRowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  clientItemSelected: {
    borderColor: "#166534",
    borderWidth: 2
  },
  ctaBadge: {
    backgroundColor: "#fef3c7",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  ctaBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#92400e"
  },
  clientName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827"
  },
  clientMeta: {
    marginTop: 2,
    fontSize: 12,
    color: "#64748b"
  },
  sectionTitle: {
    marginTop: 6,
    marginBottom: 4,
    fontSize: 16,
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
    borderColor: "#cbd5e1",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#ffffff"
  },
  filterChipActive: {
    backgroundColor: "#166534",
    borderColor: "#166534"
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
    borderColor: "#dbe3ee",
    borderRadius: 14,
    padding: 10
  },
  historyMain: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827"
  },
  historySub: {
    marginTop: 2,
    fontSize: 12,
    color: "#475569"
  },
  historyStatus: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "700"
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
    borderRadius: 12
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
    padding: 12
  },
  modalKeyboard: {
    width: "100%"
  },
  modalCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 14,
    gap: 10
  },
  detailMap: {
    width: "100%",
    height: 220,
    borderRadius: 12
  }
});
