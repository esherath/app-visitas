"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type AccessMode = "COMPANY" | "MASTER";

type AuthUser = {
  id: string;
  name: string;
  email: string;
  username?: string;
  role: string;
  ghlUserId?: string | null;
  organizationId: string;
  organizationName?: string | null;
  organizationSlug?: string | null;
  organizationLogoUrl?: string | null;
};

type OrganizationItem = {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  ghlApiBaseUrl?: string | null;
  ghlLocationId?: string | null;
  hasGhlAccessToken?: boolean;
  ghlContactSyncMaxPages?: number | null;
  ghlVisitsObjectKey?: string | null;
  ghlVisitsFieldClientNameKey?: string | null;
  ghlVisitsFieldOwnerKey?: string | null;
  ghlVisitsFieldVisitDateKey?: string | null;
  ghlVisitsFieldNotesKey?: string | null;
  ghlVisitsFieldTitleKey?: string | null;
  usersCount?: number;
  createdAt: string;
  updatedAt: string;
};

type SellerItem = {
  id: string;
  name: string;
  email: string;
  ghlUserId?: string | null;
};

type OrganizationFormState = {
  organizationId: string;
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

type CreateOrganizationState = {
  name: string;
  slug: string;
  logoUrl: string;
  adminName: string;
  adminEmail: string;
  adminUsername: string;
  adminPassword: string;
};

const TOKEN_KEY = "vfield_web_admin_token";

function emptyOrganizationForm(): OrganizationFormState {
  return {
    organizationId: "",
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

function emptyCreateState(): CreateOrganizationState {
  return {
    name: "",
    slug: "",
    logoUrl: "",
    adminName: "",
    adminEmail: "",
    adminUsername: "",
    adminPassword: ""
  };
}

function parseErrorMessage(text: string) {
  if (!text.trim()) {
    return "Falha ao processar a requisicao.";
  }

  try {
    const json = JSON.parse(text) as { message?: string; error?: string };
    return json.message ?? json.error ?? text;
  } catch {
    return text;
  }
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(parseErrorMessage(text));
  }
  return (await response.json()) as T;
}

function mapOrganizationToForm(organization: OrganizationItem): OrganizationFormState {
  return {
    organizationId: organization.id,
    name: organization.name,
    slug: organization.slug,
    logoUrl: organization.logoUrl ?? "",
    ghlApiBaseUrl: organization.ghlApiBaseUrl ?? "",
    ghlLocationId: organization.ghlLocationId ?? "",
    ghlAccessToken: "",
    ghlContactSyncMaxPages:
      organization.ghlContactSyncMaxPages && organization.ghlContactSyncMaxPages > 0
        ? String(organization.ghlContactSyncMaxPages)
        : "",
    ghlVisitsObjectKey: organization.ghlVisitsObjectKey ?? "",
    ghlVisitsFieldClientNameKey: organization.ghlVisitsFieldClientNameKey ?? "",
    ghlVisitsFieldOwnerKey: organization.ghlVisitsFieldOwnerKey ?? "",
    ghlVisitsFieldVisitDateKey: organization.ghlVisitsFieldVisitDateKey ?? "",
    ghlVisitsFieldNotesKey: organization.ghlVisitsFieldNotesKey ?? "",
    ghlVisitsFieldTitleKey: organization.ghlVisitsFieldTitleKey ?? ""
  };
}

export default function PainelPage() {
  const [accessMode, setAccessMode] = useState<AccessMode>("COMPANY");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationItem[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [form, setForm] = useState<OrganizationFormState>(emptyOrganizationForm());
  const [createState, setCreateState] = useState<CreateOrganizationState>(emptyCreateState());
  const [sellers, setSellers] = useState<SellerItem[]>([]);
  const [sellerInputs, setSellerInputs] = useState<Record<string, string>>({});
  const [loadingSession, setLoadingSession] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);
  const [savingSellerId, setSavingSellerId] = useState<string | null>(null);
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const canAccessPanel = user ? user.role === "MASTER" || user.role === "SUPER_ADMIN" : false;
  const selectedOrganization = useMemo(
    () => organizations.find((organization) => organization.id === selectedOrganizationId) ?? null,
    [organizations, selectedOrganizationId]
  );

  useEffect(() => {
    const savedToken = window.localStorage.getItem(TOKEN_KEY);
    if (!savedToken) {
      setLoadingSession(false);
      return;
    }

    requestJson<{ user: AuthUser }>("/api/auth/me", {
      headers: { Authorization: `Bearer ${savedToken}` }
    })
      .then((response) => {
        if (response.user.role !== "MASTER" && response.user.role !== "SUPER_ADMIN") {
          window.localStorage.removeItem(TOKEN_KEY);
          setErrorMessage("O painel web esta disponivel apenas para administradores.");
          return;
        }
        setToken(savedToken);
        setUser(response.user);
      })
      .catch(() => {
        window.localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        setLoadingSession(false);
      });
  }, []);

  useEffect(() => {
    if (!token || !canAccessPanel) {
      setOrganizations([]);
      setSelectedOrganizationId("");
      setForm(emptyOrganizationForm());
      return;
    }

    requestJson<{ organizations: OrganizationItem[] }>("/api/admin/organizations", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((response) => {
        setOrganizations(response.organizations);
        const firstOrganization = response.organizations[0];
        if (!firstOrganization) {
          setSelectedOrganizationId("");
          setForm(emptyOrganizationForm());
          return;
        }

        setSelectedOrganizationId((current) => {
          const existing = response.organizations.find((organization) => organization.id === current);
          const nextId = existing?.id ?? firstOrganization.id;
          const nextOrganization =
            response.organizations.find((organization) => organization.id === nextId) ?? firstOrganization;
          setForm(mapOrganizationToForm(nextOrganization));
          return nextId;
        });
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar empresas.");
      });
  }, [canAccessPanel, token]);

  useEffect(() => {
    if (!selectedOrganization) {
      return;
    }
    setForm(mapOrganizationToForm(selectedOrganization));
  }, [selectedOrganization]);

  useEffect(() => {
    if (!token || !user || user.role !== "MASTER") {
      setSellers([]);
      setSellerInputs({});
      return;
    }

    requestJson<{ sellers: SellerItem[] }>("/api/admin/sellers", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((response) => {
        setSellers(response.sellers);
        setSellerInputs(
          response.sellers.reduce<Record<string, string>>((accumulator, seller) => {
            accumulator[seller.id] = seller.ghlUserId ?? "";
            return accumulator;
          }, {})
        );
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar equipe.");
      });
  }, [token, user]);
  const handleLogin = async () => {
    if (!loginValue.trim() || !password.trim()) {
      setErrorMessage("Informe login e senha.");
      return;
    }
    if (accessMode === "COMPANY" && !organizationSlug.trim()) {
      setErrorMessage("Informe o slug da empresa.");
      return;
    }

    setLoginLoading(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const response = await requestJson<{ token: string; user: AuthUser }>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessMode,
          organizationSlug: accessMode === "COMPANY" ? organizationSlug.trim().toLowerCase() : undefined,
          login: loginValue.trim(),
          password
        })
      });

      if (response.user.role !== "MASTER" && response.user.role !== "SUPER_ADMIN") {
        throw new Error("O painel web esta disponivel apenas para administradores.");
      }

      window.localStorage.setItem(TOKEN_KEY, response.token);
      setToken(response.token);
      setUser(response.user);
      setPassword("");
      setStatusMessage(`Sessao iniciada para ${response.user.name}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao autenticar.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setOrganizations([]);
    setSelectedOrganizationId("");
    setForm(emptyOrganizationForm());
    setSellers([]);
    setSellerInputs({});
    setStatusMessage("Sessao encerrada.");
    setErrorMessage("");
  };

  const handleSaveOrganization = async () => {
    if (!token || !form.organizationId) {
      return;
    }

    setSavingOrg(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const response = await requestJson<{ organization: OrganizationItem }>("/api/admin/organizations", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          organizationId: form.organizationId,
          name: form.name.trim(),
          slug: form.slug.trim().toLowerCase(),
          logoUrl: form.logoUrl.trim() || null,
          ghlApiBaseUrl: form.ghlApiBaseUrl.trim() || null,
          ghlLocationId: form.ghlLocationId.trim() || null,
          ghlAccessToken: form.ghlAccessToken.trim() || undefined,
          ghlContactSyncMaxPages: form.ghlContactSyncMaxPages.trim()
            ? Number.parseInt(form.ghlContactSyncMaxPages.trim(), 10)
            : null,
          ghlVisitsObjectKey: form.ghlVisitsObjectKey.trim() || null,
          ghlVisitsFieldClientNameKey: form.ghlVisitsFieldClientNameKey.trim() || null,
          ghlVisitsFieldOwnerKey: form.ghlVisitsFieldOwnerKey.trim() || null,
          ghlVisitsFieldVisitDateKey: form.ghlVisitsFieldVisitDateKey.trim() || null,
          ghlVisitsFieldNotesKey: form.ghlVisitsFieldNotesKey.trim() || null,
          ghlVisitsFieldTitleKey: form.ghlVisitsFieldTitleKey.trim() || null
        })
      });

      setOrganizations((current) =>
        current.map((organization) =>
          organization.id === response.organization.id ? response.organization : organization
        )
      );
      setForm((current) => ({ ...mapOrganizationToForm(response.organization), ghlAccessToken: "" }));
      setStatusMessage("Configuracoes da empresa salvas.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar empresa.");
    } finally {
      setSavingOrg(false);
    }
  };

  const handleCreateOrganization = async () => {
    if (!token || !isSuperAdmin) {
      return;
    }
    if (!createState.name.trim() || !createState.slug.trim()) {
      setErrorMessage("Informe nome e slug da empresa.");
      return;
    }
    if (
      createState.adminName.trim() ||
      createState.adminEmail.trim() ||
      createState.adminPassword.trim() ||
      createState.adminUsername.trim()
    ) {
      if (
        !createState.adminName.trim() ||
        !createState.adminEmail.trim() ||
        !createState.adminPassword.trim()
      ) {
        setErrorMessage("Para criar o admin inicial, informe nome, email e senha.");
        return;
      }
    }

    setCreatingOrganization(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const response = await requestJson<{ organization: OrganizationItem }>("/api/admin/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: createState.name.trim(),
          slug: createState.slug.trim().toLowerCase(),
          logoUrl: createState.logoUrl.trim() || undefined,
          adminUser: createState.adminName.trim()
            ? {
                name: createState.adminName.trim(),
                email: createState.adminEmail.trim(),
                username: createState.adminUsername.trim() || undefined,
                password: createState.adminPassword
              }
            : undefined
        })
      });

      setOrganizations((current) => [...current, response.organization]);
      setSelectedOrganizationId(response.organization.id);
      setForm(mapOrganizationToForm(response.organization));
      setCreateState(emptyCreateState());
      setStatusMessage("Empresa criada com sucesso.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao criar empresa.");
    } finally {
      setCreatingOrganization(false);
    }
  };

  const handleSaveSeller = async (sellerId: string) => {
    if (!token) {
      return;
    }

    setSavingSellerId(sellerId);
    setStatusMessage("");
    setErrorMessage("");

    try {
      await requestJson<{ ok: boolean }>("/api/admin/sellers", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          sellerId,
          ghlUserId: sellerInputs[sellerId]?.trim() || null
        })
      });

      setSellers((current) =>
        current.map((seller) =>
          seller.id === sellerId ? { ...seller, ghlUserId: sellerInputs[sellerId]?.trim() || null } : seller
        )
      );
      setStatusMessage("ID do vendedor atualizado.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao atualizar vendedor.");
    } finally {
      setSavingSellerId(null);
    }
  };

  if (loadingSession) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <div className={styles.statusLine}>Validando sessao do painel...</div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.heroCard}>
            <span className={styles.badge}>VField Control</span>
            <h1 className={styles.title}>Painel web para configurar empresas e integracoes sem depender do celular.</h1>
            <p className={styles.subtitle}>
              Use este painel no PC para editar token, Location ID, objeto de visitas, logo da empresa e o ID dos
              vendedores no Vynor App. O fluxo reaproveita a API do sistema ja em producao.
            </p>
            <div className={styles.heroStats}>
              <div className={styles.stat}>
                <p className={styles.statLabel}>Acesso</p>
                <p className={styles.statValue}>{user ? user.role : "Nao autenticado"}</p>
              </div>
              <div className={styles.stat}>
                <p className={styles.statLabel}>Empresa</p>
                <p className={styles.statValue}>{user?.organizationName ?? "Painel central"}</p>
              </div>
              <div className={styles.stat}>
                <p className={styles.statLabel}>Empresas</p>
                <p className={styles.statValue}>{organizations.length}</p>
              </div>
            </div>
          </div>

          <div className={styles.loginCard}>
            <div className={styles.loginHeader}>
              <h2 className={styles.loginTitle}>{user ? "Sessao ativa" : "Entrar no painel"}</h2>
              <p className={styles.loginText}>
                {user
                  ? "O token fica salvo apenas neste navegador para facilitar manutencao."
                  : "Entre com uma conta MASTER da empresa ou SUPER_ADMIN para gerenciar configuracoes."}
              </p>
            </div>

            {!user ? (
              <div className={styles.fieldGridSingle}>
                <div className={styles.pillRow}>
                  <button
                    type="button"
                    className={accessMode === "COMPANY" ? styles.pillActive : styles.pill}
                    onClick={() => setAccessMode("COMPANY")}
                  >
                    Empresa
                  </button>
                  <button
                    type="button"
                    className={accessMode === "MASTER" ? styles.pillActive : styles.pill}
                    onClick={() => setAccessMode("MASTER")}
                  >
                    Master
                  </button>
                </div>

                {accessMode === "COMPANY" ? (
                  <label className={styles.field}>
                    <span className={styles.label}>Slug da empresa</span>
                    <input
                      className={styles.input}
                      value={organizationSlug}
                      onChange={(event) => setOrganizationSlug(event.target.value)}
                      placeholder="trinit"
                    />
                  </label>
                ) : null}

                <label className={styles.field}>
                  <span className={styles.label}>Login</span>
                  <input
                    className={styles.input}
                    value={loginValue}
                    onChange={(event) => setLoginValue(event.target.value)}
                    placeholder="jeanvynor"
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.label}>Senha</span>
                  <input
                    className={styles.input}
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Sua senha"
                  />
                </label>

                <div className={styles.buttonRow}>
                  <button type="button" className={styles.primaryButton} onClick={handleLogin} disabled={loginLoading}>
                    {loginLoading ? "Entrando..." : "Entrar"}
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.fieldGridSingle}>
                <div className={styles.statusLine}>
                  <strong>{user.name}</strong>
                  <br />
                  {user.username ?? user.email}
                </div>
                <div className={styles.buttonRow}>
                  <button type="button" className={styles.secondaryButton} onClick={handleLogout}>
                    Sair
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {statusMessage ? <div className={styles.successLine}>{statusMessage}</div> : null}
        {errorMessage ? <div className={styles.errorLine}>{errorMessage}</div> : null}

        {user && !canAccessPanel ? (
          <div className={styles.errorLine}>O painel web esta disponivel apenas para MASTER e SUPER_ADMIN.</div>
        ) : null}

        {user && canAccessPanel ? (
          <section className={styles.appShell}>
            <aside className={styles.panel}>
              <h2 className={styles.panelTitle}>Empresas</h2>
              <p className={styles.panelText}>
                {isSuperAdmin
                  ? "Selecione uma empresa para editar integracao e identidade."
                  : "Sua conta enxerga apenas a propria empresa."}
              </p>
              <div className={styles.orgList}>
                {organizations.map((organization) => (
                  <button
                    key={organization.id}
                    type="button"
                    className={
                      organization.id === selectedOrganizationId ? styles.orgButtonActive : styles.orgButton
                    }
                    onClick={() => {
                      setSelectedOrganizationId(organization.id);
                      setForm(mapOrganizationToForm(organization));
                      setStatusMessage("");
                      setErrorMessage("");
                    }}
                  >
                    <span className={styles.orgName}>{organization.name}</span>
                    <span className={styles.orgMeta}>
                      slug: {organization.slug}
                      <br />
                      usuarios: {organization.usersCount ?? 0}
                      <br />
                      token configurado: {organization.hasGhlAccessToken ? "sim" : "nao"}
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            <div className={styles.contentStack}>
              <section className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <h2 className={styles.cardTitle}>Configuracao da empresa</h2>
                    <p className={styles.cardText}>
                      Edite aqui os dados da integracao com o Vynor App sem precisar digitar token e Location ID no
                      celular.
                    </p>
                  </div>
                </div>

                {selectedOrganization ? (
                  <>
                    <div className={styles.fieldGrid}>
                      <label className={styles.field}>
                        <span className={styles.label}>Nome da empresa</span>
                        <input
                          className={styles.input}
                          value={form.name}
                          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                        />
                      </label>

                      <label className={styles.field}>
                        <span className={styles.label}>Slug</span>
                        <input
                          className={styles.input}
                          value={form.slug}
                          disabled={!isSuperAdmin}
                          onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
                        />
                      </label>

                      <label className={styles.fieldWide}>
                        <span className={styles.label}>Logo URL</span>
                        <input
                          className={styles.input}
                          value={form.logoUrl}
                          onChange={(event) => setForm((current) => ({ ...current, logoUrl: event.target.value }))}
                          placeholder="https://..."
                        />
                      </label>
                    </div>

                    <div className={styles.sectionDivider} />

                    <div className={styles.fieldGrid}>
                      <label className={styles.fieldWide}>
                        <span className={styles.label}>Base da API Vynor App</span>
                        <input
                          className={styles.input}
                          value={form.ghlApiBaseUrl}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, ghlApiBaseUrl: event.target.value }))
                          }
                          placeholder="https://services.leadconnectorhq.com"
                        />
                      </label>

                      <label className={styles.field}>
                        <span className={styles.label}>Location ID</span>
                        <textarea
                          className={styles.textarea}
                          value={form.ghlLocationId}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, ghlLocationId: event.target.value }))
                          }
                          placeholder="wqGU..."
                        />
                      </label>

                      <label className={styles.field}>
                        <span className={styles.label}>Private integration token</span>
                        <textarea
                          className={styles.textarea}
                          value={form.ghlAccessToken}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, ghlAccessToken: event.target.value }))
                          }
                          placeholder={
                            selectedOrganization.hasGhlAccessToken
                              ? "Preencha apenas se quiser substituir o token atual."
                              : "Cole o token da subconta aqui."
                          }
                        />
                        <span className={styles.tokenHint}>
                          Token atual salvo: {selectedOrganization.hasGhlAccessToken ? "sim" : "nao"}
                        </span>
                      </label>

                      <label className={styles.field}>
                        <span className={styles.label}>Max paginas de contatos</span>
                        <input
                          className={styles.input}
                          value={form.ghlContactSyncMaxPages}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, ghlContactSyncMaxPages: event.target.value }))
                          }
                          placeholder="200"
                        />
                      </label>
                    </div>

                    <div className={styles.sectionDivider} />
                    <div className={styles.fieldGrid}>
                      <label className={styles.fieldWide}>
                        <span className={styles.label}>Objeto de visitas</span>
                        <input
                          className={styles.input}
                          value={form.ghlVisitsObjectKey}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, ghlVisitsObjectKey: event.target.value }))
                          }
                          placeholder="{{ custom_objects.visitas.visitas }}"
                        />
                      </label>

                      <label className={styles.field}>
                        <span className={styles.label}>Campo cliente</span>
                        <input
                          className={styles.input}
                          value={form.ghlVisitsFieldClientNameKey}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, ghlVisitsFieldClientNameKey: event.target.value }))
                          }
                          placeholder="{{ custom_objects.visitas.cliente }}"
                        />
                      </label>

                      <label className={styles.field}>
                        <span className={styles.label}>Campo data</span>
                        <input
                          className={styles.input}
                          value={form.ghlVisitsFieldVisitDateKey}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, ghlVisitsFieldVisitDateKey: event.target.value }))
                          }
                          placeholder="{{ custom_objects.visitas.data_da_visita }}"
                        />
                      </label>

                      <label className={styles.field}>
                        <span className={styles.label}>Campo observacoes</span>
                        <input
                          className={styles.input}
                          value={form.ghlVisitsFieldNotesKey}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, ghlVisitsFieldNotesKey: event.target.value }))
                          }
                          placeholder="{{ custom_objects.visitas.observaes_da_visita }}"
                        />
                      </label>

                      <label className={styles.field}>
                        <span className={styles.label}>Campo titulo</span>
                        <input
                          className={styles.input}
                          value={form.ghlVisitsFieldTitleKey}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, ghlVisitsFieldTitleKey: event.target.value }))
                          }
                          placeholder="visitas"
                        />
                      </label>

                      <label className={styles.field}>
                        <span className={styles.label}>Campo proprietario</span>
                        <input
                          className={styles.input}
                          value={form.ghlVisitsFieldOwnerKey}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, ghlVisitsFieldOwnerKey: event.target.value }))
                          }
                          placeholder="owner"
                        />
                      </label>
                    </div>

                    <div className={styles.sectionDivider} />

                    <div className={styles.buttonRow}>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={handleSaveOrganization}
                        disabled={savingOrg}
                      >
                        {savingOrg ? "Salvando..." : "Salvar configuracoes"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className={styles.emptyState}>Nenhuma empresa disponivel para esta conta.</div>
                )}
              </section>

              {user?.role === "MASTER" ? (
                <section className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div>
                      <h2 className={styles.cardTitle}>Equipe e IDs do Vynor App</h2>
                      <p className={styles.cardText}>
                        Vincule cada vendedor ao respectivo ID do Vynor App para preencher o proprietario das visitas.
                      </p>
                    </div>
                  </div>

                  {sellers.length ? (
                    sellers.map((seller) => (
                      <div key={seller.id} className={styles.sellerRow}>
                        <div className={styles.sellerInfo}>
                          <span className={styles.sellerName}>{seller.name}</span>
                          <span className={styles.sellerEmail}>{seller.email}</span>
                        </div>
                        <label className={styles.field}>
                          <span className={styles.label}>ID do vendedor</span>
                          <input
                            className={styles.input}
                            value={sellerInputs[seller.id] ?? ""}
                            onChange={(event) =>
                              setSellerInputs((current) => ({
                                ...current,
                                [seller.id]: event.target.value
                              }))
                            }
                            placeholder="user_..."
                          />
                        </label>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => handleSaveSeller(seller.id)}
                          disabled={savingSellerId === seller.id}
                        >
                          {savingSellerId === seller.id ? "Salvando..." : "Salvar"}
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className={styles.emptyState}>Nenhum vendedor encontrado para esta empresa.</div>
                  )}
                </section>
              ) : null}

              {isSuperAdmin ? (
                <section className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div>
                      <h2 className={styles.cardTitle}>Nova empresa</h2>
                      <p className={styles.cardText}>
                        Crie uma empresa e, se quiser, ja registre o admin inicial para ela.
                      </p>
                    </div>
                  </div>

                  <div className={styles.fieldGrid}>
                    <label className={styles.field}>
                      <span className={styles.label}>Nome</span>
                      <input
                        className={styles.input}
                        value={createState.name}
                        onChange={(event) => setCreateState((current) => ({ ...current, name: event.target.value }))}
                      />
                    </label>

                    <label className={styles.field}>
                      <span className={styles.label}>Slug</span>
                      <input
                        className={styles.input}
                        value={createState.slug}
                        onChange={(event) => setCreateState((current) => ({ ...current, slug: event.target.value }))}
                      />
                    </label>

                    <label className={styles.fieldWide}>
                      <span className={styles.label}>Logo URL</span>
                      <input
                        className={styles.input}
                        value={createState.logoUrl}
                        onChange={(event) =>
                          setCreateState((current) => ({ ...current, logoUrl: event.target.value }))
                        }
                      />
                    </label>

                    <label className={styles.field}>
                      <span className={styles.label}>Nome do admin</span>
                      <input
                        className={styles.input}
                        value={createState.adminName}
                        onChange={(event) =>
                          setCreateState((current) => ({ ...current, adminName: event.target.value }))
                        }
                      />
                    </label>

                    <label className={styles.field}>
                      <span className={styles.label}>Email do admin</span>
                      <input
                        className={styles.input}
                        value={createState.adminEmail}
                        onChange={(event) =>
                          setCreateState((current) => ({ ...current, adminEmail: event.target.value }))
                        }
                      />
                    </label>

                    <label className={styles.field}>
                      <span className={styles.label}>Login do admin</span>
                      <input
                        className={styles.input}
                        value={createState.adminUsername}
                        onChange={(event) =>
                          setCreateState((current) => ({ ...current, adminUsername: event.target.value }))
                        }
                      />
                    </label>

                    <label className={styles.field}>
                      <span className={styles.label}>Senha do admin</span>
                      <input
                        className={styles.input}
                        type="password"
                        value={createState.adminPassword}
                        onChange={(event) =>
                          setCreateState((current) => ({ ...current, adminPassword: event.target.value }))
                        }
                      />
                    </label>
                  </div>

                  <div className={styles.sectionDivider} />

                  <div className={styles.buttonRow}>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={handleCreateOrganization}
                      disabled={creatingOrganization}
                    >
                      {creatingOrganization ? "Criando..." : "Criar empresa"}
                    </button>
                  </div>
                </section>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
