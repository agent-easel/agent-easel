/**
 * Electron shell: one installation role, the bundled UI on `factory://app`, a supervised
 * local backend (server role) or one pinned remote server (client role). Business rules
 * stay in the backend's public operations.
 */
import { hostReceiptPath, reportClientUpdates, stageUpdate } from "./update-receipts.ts";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MessageChannelMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
  type WebContents,
  type WebFrameMain,
} from "electron";
import {
  clientAccessOperations,
  operationPath,
  productPositioning,
  productStatement,
  type Result as OperationResult,
  type ServerUpdateAction,
  type UpdateChannel,
} from "@agent-easel/contracts";
import type {
  Appearance,
  AppearancePreference,
  DesktopAlertSettings,
  DesktopMenuState,
  DesktopResult,
  DesktopRole,
  DesktopRoute,
  DesktopState,
  FactoryDesktop,
  PreviousInstallation,
} from "@agent-easel/contracts/desktop-bridge";
import { ApprovedClient } from "./approved-client.ts";
import { AttentionCoordinator } from "./attention-coordinator.ts";
import { AttentionSubscription, type AttentionSelection } from "./attention-subscription.ts";
import { BackendSupervisor } from "./backend.ts";
import { channels } from "./ipc.ts";
import { buildApplicationMenu, parseMenuState, withoutOpenRun } from "./menu.ts";
import { openLiveSocket, refuseLive, relayLive, type LivePort } from "./live-relay.ts";
import { loadNativeNotifications, MacAlerts } from "./macos-alerts.ts";
import {
  defaultPreviousInstallationPaths,
  dismissMigrationSummary,
  migrationText,
  migratePreviousInstallation,
  postponeRemovalReminder,
  previousInstallation,
  removalReminderDue,
  removePreviousInstallation,
} from "./previous-installation.ts";
import { appOrigin, factoryProtocolHandler, type ApiTarget } from "./protocol.ts";
import { SettingsStore, type DesktopSettings, type RememberedServer } from "./settings-store.ts";
import { buildChannel, Updates } from "./updates.ts";
import { WindowBoundsTracker } from "./window-bounds.ts";

// Disposable profiles for probes and side-by-side installs; FACTORY_HOME selects server data.
if (process.env.FACTORY_DESKTOP_USER_DATA)
  app.setPath("userData", process.env.FACTORY_DESKTOP_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: "factory", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const here = dirname(fileURLToPath(import.meta.url));
const uiDirectory = join(here, "ui");
const uiPartition = "persist:factory-ui";
const documentationUrl = "https://github.com/alimek/t3-factory/tree/main/docs#readme";

/** Each mode's `--background` in the frontend's styles.css, painted while the page loads. */
const windowBackground: Record<Appearance, string> = { light: "#ffffff", dark: "#09090b" };

function effectiveAppearance(): Appearance {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

const failed = (message: string): Extract<DesktopResult, { ok: false }> => ({ ok: false, message });

let store: SettingsStore;
let approvedClient: ApprovedClient;
let backend: BackendSupervisor;
let updates: Updates;
let alerts: MacAlerts;
let attention: AttentionCoordinator;
let attentionSubscription: AttentionSubscription;
let permissionCheck: NodeJS.Timeout | undefined;
/** The local backend the attention subscription follows in the server role. */
let attentionHost: string | null = null;
let window: BrowserWindow | null = null;
let windowBounds = new WindowBoundsTracker(null);
/** The window's page once it listens for routes; a route chosen before that waits in `pendingRoute`. */
let routeReceiver: WebContents | null = null;
let pendingRoute: DesktopRoute | null = null;
/** The page a closed window showed; reopening the window returns to it. */
let lastView = `${appOrigin}/`;
/** The notification whose click launched this process, read before any window exists. */
let launchActivation: string | null = null;
let tray: Tray | null = null;
let menuState: DesktopMenuState | null = null;
/** Set only after the local user confirmed and the backend stopped in order. */
let quitting = false;
let started = false;
let pendingOpen = false;
let pendingActivate = false;
let installingUpdate = false;
/** An approved client's install request was accepted and starts on the next tick. */
let serverInstallAccepted = false;
let previous: PreviousInstallation | null = null;

const updateChannel = (): UpdateChannel => store.get().updateChannel ?? buildChannel();

const alertSettings = ({
  notifications,
  notifyRunFinished,
  dockBadge,
  showRunDetails,
}: DesktopSettings): DesktopAlertSettings => ({
  notifications,
  notifyRunFinished,
  dockBadge,
  showRunDetails,
});

const alertSettingNames = new Set<unknown>([
  "notifications",
  "notifyRunFinished",
  "dockBadge",
  "showRunDetails",
] satisfies (keyof DesktopAlertSettings)[]);

function desktopState(): DesktopState {
  const settings = store.get();
  return {
    version: app.getVersion(),
    role: settings.role,
    server: settings.server
      ? { url: settings.server.url, fingerprint: settings.server.trust.fingerprint }
      : null,
    backend: backend.state,
    launchAtLogin: settings.launchAtLogin,
    menuBarIcon: settings.menuBarIcon,
    alerts: alertSettings(settings),
    notificationPermission: attention.permission,
    updateChannel: updateChannel(),
    update: updates.current,
    // macOS keeps a minimized window's document "visible"; live delivery detaches on this.
    minimized: window !== null && !window.isDestroyed() && window.isMinimized(),
    previousInstallation: previous,
  };
}

function broadcast() {
  // Quit and role changes can race the window's destruction.
  if (window && !window.isDestroyed()) window.webContents.send(channels.state, desktopState());
  refreshTray();
}

function apiTarget(): ApiTarget {
  const settings = store.get();
  if (settings.role === "server")
    return backend.port === null
      ? null
      : { kind: "host", base: `http://127.0.0.1:${backend.port}` };
  const connection = approvedClient.capture();
  return connection ? { kind: "remote", connection } : null;
}

/** The running local backend the server role's attention follows. */
const attentionHostBase = () =>
  backend.state.state === "running" && backend.port !== null
    ? `http://127.0.0.1:${backend.port}`
    : null;

/** A remembered server's identity in the attention ledger. */
const clientServer = ({ url, trust }: RememberedServer) => `client ${url} ${trust.fingerprint}`;

/**
 * The server whose attention this installation follows, independent of any window and of
 * whether it is reachable: a stopped local backend leaves the selection, and its
 * notifications, in place.
 */
function attentionSelection(): AttentionSelection | null {
  const settings = store.get();
  if (settings.role === "server") {
    const base = attentionHostBase();
    return { server: "server", target: base ? { kind: "host", base } : null };
  }
  if (settings.role !== "client" || !settings.server) return null;
  const connection = approvedClient.capture();
  return {
    server: clientServer(settings.server),
    target: connection ? { kind: "remote", connection } : null,
  };
}

/** Replaces the subscription after a server, role, credential or backend change. */
function followAttention() {
  // A route chosen for the previous selection never opens in the next one.
  pendingRoute = null;
  attentionHost = store.get().role === "server" ? attentionHostBase() : null;
  attentionSubscription.follow(attentionSelection());
  reportClientUpdate();
}

/** Quit: alerts stop with the process; delivered notifications stay in Notification Center. */
function stopAttention() {
  clearInterval(permissionCheck);
  attentionSubscription.stop();
  void attention.close();
}

async function openRunCount(): Promise<number | null> {
  if (backend.port === null) return 0;
  try {
    const response = await fetch(
      `http://127.0.0.1:${backend.port}${operationPath(clientAccessOperations.getHostLifecycle)}`,
      {
        method: clientAccessOperations.getHostLifecycle.method,
        signal: AbortSignal.timeout(5000),
      },
    );
    const body = (await response.json()) as { ok: boolean; value?: { openRunCount: number } };
    return body.ok && body.value ? body.value.openRunCount : null;
  } catch {
    return null;
  }
}

const interruption = {
  quit: { button: "Quit AgentEasel", verb: "Quitting" },
  switch: { button: "Stop server and switch", verb: "Switching to client mode" },
} as const;

/**
 * Host-local confirmation before Factory control stops. Quit and role switch never Stop
 * Runs; T3 work may continue while Factory is closed. Update installation is confirmed in
 * the upgrade review, which shows the same open-Run warning.
 */
async function confirmInterruption(action: keyof typeof interruption): Promise<boolean> {
  if (store.get().role !== "server" || backend.state.state !== "running") return true;
  const open = await openRunCount();
  if (action === "quit" && open === 0) return true;
  const runs =
    open === null
      ? "AgentEasel could not count open Runs."
      : `${open} Run${open === 1 ? " is" : "s are"} still open.`;
  const { verb, button } = interruption[action];
  const options = {
    type: "warning" as const,
    buttons: [button, "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: `${verb} stops AgentEasel control on this computer.`,
    detail: `${runs} Reports, Human answers and transitions wait until AgentEasel runs again, and work already started in T3 Code may continue meanwhile. Runs are not stopped: on restart AgentEasel reconciles them before eligible work resumes.`,
  };
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return response === 0;
}

async function stopBackendFor(action: keyof typeof interruption): Promise<boolean> {
  if (!(await confirmInterruption(action))) return false;
  await backend.stop();
  return true;
}

/**
 * Applies a click's route in the window, which the caller already opened. The page applies it
 * through its own navigation, behind its connection gate, so its draft guards still ask.
 */
function openRoute(route: DesktopRoute | null) {
  if (!route) return;
  if (routeReceiver) routeReceiver.send(channels.route, route);
  else pendingRoute = route;
}

/** A notification click focuses or opens the window, then routes to the Run's current state. */
function activateNotification(id: string) {
  openWindow();
  void attention.activate(id).then(openRoute);
}

function openWindow() {
  if (window) {
    if (windowBounds.reveal(window)) void saveWindowBounds();
    window.focus();
    return;
  }
  const saved = windowBounds.prepareOpen(
    screen.getAllDisplays().map((display) => display.workArea),
  );
  const created = new BrowserWindow({
    ...(saved
      ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
      : { width: 1400, height: 900 }),
    ...(saved?.fullScreen ? { fullscreen: true } : {}),
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "AgentEasel",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 17 },
    backgroundColor: windowBackground[effectiveAppearance()],
    // Windows and Linux show the application menu bar on Alt; macOS ignores this option.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      partition: uiPartition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  created.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${appOrigin}/`)) event.preventDefault();
  });
  created.once("ready-to-show", () => {
    if (windowBounds.revealInitial(created)) void saveWindowBounds();
  });
  // A reload replaces the page and its route listener; in-page navigation keeps both.
  created.webContents.on("did-navigate", () => {
    routeReceiver = null;
  });
  const rememberBounds = () => void saveWindowBounds();
  created.on("resized", rememberBounds);
  created.on("moved", rememberBounds);
  created.on("maximize", rememberBounds);
  created.on("unmaximize", rememberBounds);
  created.on("enter-full-screen", rememberBounds);
  created.on("leave-full-screen", rememberBounds);
  created.on("close", () => {
    const url = created.webContents.getURL();
    if (url.startsWith(`${appOrigin}/`)) lastView = url;
    if (!quitting) rememberBounds();
  });
  created.on("minimize", broadcast);
  created.on("restore", broadcast);
  // Closing the window never stops the backend; the Dock and the optional tray reopen it.
  created.on("closed", () => {
    window = null;
    windowBounds.closed();
    routeReceiver = null;
    attention.focus(false);
    applyMenuState(withoutOpenRun(menuState));
  });
  window = created;
  void created.loadURL(lastView);
}

function saveWindowBounds(): Promise<unknown> {
  return store.update({ windowBounds: windowBounds.capture(window) }).catch(() => undefined);
}

function persistWindowBounds(): Promise<void> {
  void saveWindowBounds();
  return store.settled();
}

function trayImage() {
  const image = nativeImage.createFromPath(join(here, "resources", "trayTemplate.png"));
  image.setTemplateImage(true);
  return image;
}

/** The menu-bar icon exists only while the user keeps it enabled. */
function applyMenuBarIcon() {
  if (store.get().menuBarIcon) {
    tray ??= new Tray(trayImage());
    return;
  }
  tray?.destroy();
  tray = null;
}

function refreshTray() {
  if (!tray) return;
  const settings = store.get();
  const status =
    settings.role === "server"
      ? `Server: ${backend.state.state}`
      : settings.role === "client"
        ? `Client of ${settings.server?.url ?? "no server"}`
        : "Role not chosen";
  tray.setToolTip(`AgentEasel — ${status}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      { type: "separator" },
      { label: "Open AgentEasel", click: openWindow },
      { label: "Quit AgentEasel", click: () => app.quit() },
    ]),
  );
}

function applyMenuState(state: DesktopMenuState | null) {
  menuState = state;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildApplicationMenu(
        menuState,
        { platform: process.platform, development: !app.isPackaged },
        {
          run: (id) => {
            // Without a window the command has no renderer; reopening it is the useful answer.
            const target = window;
            openWindow();
            target?.webContents.send(channels.menuCommand, id);
          },
          checkForUpdates: () => void updates.check(),
          openDocumentation: () => void shell.openExternal(documentationUrl),
        },
      ),
    ),
  );
}

async function chooseRole(role: DesktopRole): Promise<DesktopResult> {
  const current = store.get().role;
  if (role === current) return { ok: true };
  if (current === "server" && !(await stopBackendFor("switch")))
    return failed("AgentEasel kept running as a server.");
  // Local data stays where it is; nothing is copied to or from another server.
  await approvedClient.chooseRole(role);
  if (role === "server") backend.start();
  followAttention();
  broadcast();
  return { ok: true };
}

async function connectServer(url: string, fingerprint: string): Promise<DesktopResult> {
  try {
    await approvedClient.connect(url, fingerprint);
  } catch (error) {
    return failed(String(error));
  }
  followAttention();
  broadcast();
  return { ok: true };
}

async function setLaunchAtLogin(enabled: boolean): Promise<DesktopResult> {
  app.setLoginItemSettings({ openAtLogin: enabled });
  await store.update({ launchAtLogin: enabled });
  broadcast();
  const status = app.getLoginItemSettings().status;
  if (enabled && status === "requires-approval")
    return failed("Approve AgentEasel in System Settings → General → Login Items.");
  return { ok: true };
}

async function setMenuBarIcon(enabled: boolean): Promise<DesktopResult> {
  try {
    await store.update({ menuBarIcon: enabled });
  } catch (error) {
    // The stored choice and the icon stay as they were; Settings shows why.
    return failed(`The menu bar setting could not be saved: ${String(error)}`);
  }
  applyMenuBarIcon();
  broadcast();
  return { ok: true };
}

async function setAlertSetting(name: unknown, enabled: boolean): Promise<DesktopResult> {
  if (!alertSettingNames.has(name)) return failed("Unknown notification setting.");
  try {
    await store.update({ [name as keyof DesktopAlertSettings]: enabled });
  } catch (error) {
    return failed(`The notification setting could not be saved: ${String(error)}`);
  }
  await attention.configure(alertSettings(store.get()));
  broadcast();
  return { ok: true };
}

async function setUpdateChannel(channel: unknown): Promise<DesktopResult> {
  if (channel !== "stable" && channel !== "beta") return failed("Choose stable or beta.");
  const problem = updates.configure(channel);
  if (problem) return failed(problem);
  await store.update({ updateChannel: channel });
  broadcast();
  return { ok: true };
}

function updateWindowBackground() {
  if (window && !window.isDestroyed())
    window.setBackgroundColor(windowBackground[effectiveAppearance()]);
}

function applyNativeAppearance(preference: AppearancePreference) {
  nativeTheme.themeSource = preference;
  updateWindowBackground();
}

async function setAppearance(preference: unknown): Promise<DesktopResult> {
  if (preference !== "system" && preference !== "light" && preference !== "dark")
    return failed("Choose System, Light or Dark.");
  try {
    await store.update({ appearance: preference });
  } catch (error) {
    return failed(`The appearance could not be saved: ${String(error)}`);
  }
  applyNativeAppearance(preference);
  return { ok: true };
}

function reportClientUpdate() {
  const settings = store.get();
  if (!app.isPackaged || settings.role !== "client" || !settings.server) return;
  const connection = approvedClient.capture();
  if (connection)
    void reportClientUpdates(
      app.getPath("userData"),
      clientServer(settings.server),
      app.getVersion(),
      connection,
    ).catch(() => undefined);
}

/** Confirmed in the upgrade review; the backend still shuts down in order before replacement. */
async function installUpdate(): Promise<DesktopResult> {
  if (installingUpdate) return failed("Update installation is already in progress.");
  if (updates.current.state !== "downloaded") return failed("No downloaded update is ready.");
  installingUpdate = true;
  try {
    await backend.stop();
    await persistWindowBounds();
    if (updates.current.state !== "downloaded")
      throw new Error("The update is no longer ready. Check for updates again.");
    const settings = store.get();
    const server =
      settings.role === "client" && settings.server ? clientServer(settings.server) : null;
    if (app.isPackaged && updates.current.version && (settings.role === "server" || server)) {
      await stageUpdate(
        app.getPath("userData"),
        server,
        app.getVersion(),
        updates.current.version,
      ).catch(() => undefined);
    }
    quitting = true;
    updates.install();
    return { ok: true };
  } catch (error) {
    installingUpdate = false;
    quitting = false;
    if (store.get().role === "server") backend.start();
    return failed(`Update installation could not start: ${String(error)}`);
  }
}

/** Server role: approved clients operate this installation's updater through the backend. */
async function runServerUpdate(action: ServerUpdateAction): Promise<OperationResult<null>> {
  const refused = (message: string): OperationResult<null> => ({
    ok: false,
    error: { code: "conflict", message, issues: [] },
  });
  const state = updates.current.state;
  if (action === "check") {
    await updates.check();
    return { ok: true, value: null };
  }
  if (action === "download") {
    if (state !== "available") return refused("No server update is available to download.");
    void updates.download();
    return { ok: true, value: null };
  }
  if (state !== "downloaded") return refused("No downloaded server update is ready to install.");
  if (installingUpdate || serverInstallAccepted)
    return refused("The server update is already being installed.");
  // Accepted before the deferred start, so a concurrent request is refused, not failed.
  serverInstallAccepted = true;
  // Answer the client before the backend begins its orderly shutdown.
  // A failed start is published as the updater's error, which the waiting client reads.
  setImmediate(
    () =>
      void installUpdate().then((result) => {
        serverInstallAccepted = false;
        if (!result.ok) updates.fail(result.message);
      }),
  );
  return { ok: true, value: null };
}

const liveChannels = new Set<{ close(reason: string): void }>();

function closeLive(reason: string) {
  for (const channel of liveChannels) channel.close(reason);
}

/** Captures the current target: a later selection or backend change closes this channel. */
function openLive(query: string, port: LivePort) {
  const socket = openLiveSocket(apiTarget(), query);
  if (!socket) return refuseLive(port, "The AgentEasel server is unreachable.");
  const channel = relayLive(socket, port, () => liveChannels.delete(channel));
  liveChannels.add(channel);
}

/** Only the bundled UI in this app's own window may use the native bridge. */
function trustedFrame(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  if (!frame?.url.startsWith(`${appOrigin}/`)) throw new Error("Untrusted sender.");
  return frame;
}

/** Bridge methods the page calls over `ipcRenderer.invoke`; the rest are main → page pushes. */
type BridgeRequest = Exclude<keyof FactoryDesktop, "onState" | "onMenuCommand" | "onRoute">;
type BridgeAnswer<Name extends BridgeRequest> = Awaited<ReturnType<FactoryDesktop[Name]>>;

/**
 * Arguments are typed as the preload sends them; a handler that cannot rely on the preload's
 * coercion declares them `unknown` and validates them.
 */
type BridgeHandlers = {
  readonly [Name in BridgeRequest]: (
    frame: WebFrameMain,
    ...args: Parameters<FactoryDesktop[Name]>
  ) => BridgeAnswer<Name> | Promise<BridgeAnswer<Name>>;
};

const bridgeHandlers: BridgeHandlers = {
  getState: () => desktopState(),
  chooseRole: (_frame, role: unknown) =>
    role === "server" || role === "client" ? chooseRole(role) : failed("Unknown role."),
  probeServer: async (_frame, address: string) => {
    try {
      const { url, fingerprint, matchesExpected, systemTrusted } =
        await approvedClient.probe(address);
      return { ok: true, url, fingerprint, matchesExpected, systemTrusted };
    } catch (error) {
      return failed(
        error instanceof Error && error.message.startsWith("Enter")
          ? error.message
          : "No AgentEasel server answered securely at that address. Check that the server app is running with remote access enabled.",
      );
    }
  },
  connectServer: (_frame, url: string, fingerprint: string) => connectServer(url, fingerprint),
  forgetServer: async () => {
    const forgotten = store.get().server;
    await approvedClient.forget();
    followAttention();
    if (forgotten) await attention.forget(clientServer(forgotten));
    broadcast();
    return { ok: true };
  },
  retryBackend: () => {
    if (store.get().role === "server") backend.start();
    return { ok: true };
  },
  setLaunchAtLogin: (_frame, enabled: boolean) => setLaunchAtLogin(enabled === true),
  setMenuBarIcon: (_frame, enabled: boolean) => setMenuBarIcon(enabled === true),
  setAlertSetting: (_frame, name: unknown, enabled: boolean) =>
    setAlertSetting(name, enabled === true),
  openNotificationSettings: async () => {
    await shell.openExternal(alerts.systemSettingsUrl);
    return { ok: true };
  },
  checkForUpdates: async () => {
    await updates.check();
    return { ok: true };
  },
  downloadUpdate: async () => {
    if (updates.current.state !== "available") return failed("No update is available to download.");
    await updates.download();
    return { ok: true };
  },
  installUpdate: () => installUpdate(),
  setUpdateChannel: (_frame, channel: unknown) => setUpdateChannel(channel),
  setAppearance: (_frame, preference: unknown) => setAppearance(preference),
  dismissMigrationSummary: async () => {
    const paths = previousInstallationPaths();
    if (paths) await dismissMigrationSummary(paths);
    await refreshPreviousInstallation();
    return { ok: true };
  },
  removePreviousInstallation: () => confirmPreviousInstallationRemoval(),
  setMenuState: (_frame, state: unknown) => {
    const publication = parseMenuState(state);
    if (!publication.ok) return failed(publication.message);
    applyMenuState(publication.state);
    return { ok: true };
  },
  // A MessagePort cannot be an invoke result; it goes to the requesting frame, keyed by nonce.
  openLive: (frame, query: unknown, nonce: unknown) => {
    if (typeof query !== "string" || typeof nonce !== "string")
      return failed("Invalid live request.");
    const { port1, port2 } = new MessageChannelMain();
    frame.postMessage(channels.livePort, nonce, [port2]);
    openLive(query, port1);
    return { ok: true };
  },
};

function registerBridge() {
  ipcMain.handle(channels.takeRoute, (event: IpcMainInvokeEvent) => {
    trustedFrame(event);
    routeReceiver = event.sender;
    const route = pendingRoute;
    pendingRoute = null;
    return route;
  });
  for (const name of Object.keys(bridgeHandlers) as BridgeRequest[]) {
    const run = bridgeHandlers[name] as (frame: WebFrameMain, ...args: unknown[]) => unknown;
    ipcMain.handle(channels[name], (event: IpcMainInvokeEvent, ...args: unknown[]) =>
      run(trustedFrame(event), ...args),
    );
  }
}

function registerUi() {
  const ui = session.fromPartition(uiPartition);
  ui.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ui.setPermissionCheckHandler(() => false);
  ui.protocol.handle(
    "factory",
    factoryProtocolHandler({
      uiDirectory,
      target: apiTarget,
      appearance: () => ({ mode: effectiveAppearance(), preference: store.get().appearance }),
    }),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (started) openWindow();
    else pendingOpen = true;
  });
  // A Dock click: an open window only comes forward; otherwise the window opens where attention waits.
  app.on("activate", () => {
    if (!started) {
      pendingActivate = true;
      return;
    }
    const windowOpen = window !== null;
    openWindow();
    void attention.dock(windowOpen).then(openRoute);
  });
  app.once("ready", (_event, launchInfo) => {
    if ("identifier" in launchInfo && typeof launchInfo.identifier === "string")
      launchActivation = launchInfo.identifier;
  });
  // Background operation: the last window closing leaves the server and app running.
  app.on("window-all-closed", () => undefined);
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    const finish = () =>
      void persistWindowBounds().then(() => {
        stopAttention();
        approvedClient.close();
        quitting = true;
        app.quit();
      });
    // Cancel keeps Factory running; a failed orderly stop still exits, which releases the
    // OS lock with the process, rather than leaving a half-quit application.
    void stopBackendFor("quit").then((stopped) => stopped && finish(), finish);
  });
  void app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      // A startup failure must be visible; the app never lingers without a window.
      dialog.showErrorBox(
        "AgentEasel could not start",
        `AgentEasel could not read its desktop settings or start its window. Your AgentEasel data was not changed.\n\n${String(error)}`,
      );
      app.exit(1);
    });
}

async function start() {
  app.setAboutPanelOptions({
    applicationName: "AgentEasel",
    credits: `${productPositioning}\n\n${productStatement}`,
  });
  if (!(await migrateAtFirstLaunch())) {
    quitting = true;
    app.exit(0);
    return;
  }
  await refreshPreviousInstallation();
  store = await SettingsStore.open(app.getPath("userData"));
  windowBounds = new WindowBoundsTracker(store.get().windowBounds);
  applyNativeAppearance(store.get().appearance);
  nativeTheme.on("updated", updateWindowBackground);
  // A newly issued credential replaces the attention subscription at once.
  approvedClient = await ApprovedClient.open(store, safeStorage, followAttention);
  backend = new BackendSupervisor(
    join(here, "backend-host.js"),
    {
      FACTORY_UI_DIRECTORY: uiDirectory,
      FACTORY_UPDATE_RECEIPT: hostReceiptPath(app.getPath("userData")),
      FACTORY_APPLICATION_VERSION: app.getVersion(),
      FACTORY_DESKTOP_PACKAGED: String(app.isPackaged),
    },
    (state) => {
      if (state.state !== "running") closeLive("The AgentEasel server stopped.");
      if (store.get().role === "server" && attentionHostBase() !== attentionHost) followAttention();
      broadcast();
    },
    {
      status: () => ({
        channel: updates.current.state === "unsupported" ? null : updateChannel(),
        update: updates.current,
      }),
      run: runServerUpdate,
    },
  );
  updates = new Updates((status) => {
    if (installingUpdate && quitting && status.state === "error") {
      installingUpdate = false;
      quitting = false;
      // The updater failed before replacement: reopen the same home and reconcile.
      if (store.get().role === "server") backend.start();
      openWindow();
    }
    backend.publishUpdate();
    broadcast();
  });
  // A system termination request (kill, launchd) is not an interactive Quit: no dialog,
  // but the same orderly backend shutdown. Electron would otherwise only close windows.
  process.once("SIGTERM", () => {
    void backend
      .stop()
      .catch(() => undefined)
      .then(persistWindowBounds)
      .finally(() => {
        stopAttention();
        approvedClient.close();
        quitting = true;
        app.quit();
      });
  });
  // Alerts run in the main process for the installation's lifetime, with every window closed.
  alerts = new MacAlerts(
    loadNativeNotifications(join(here, "native", "notifications.node")),
    app.dock!,
    activateNotification,
  );
  attention = await AttentionCoordinator.open(app.getPath("userData"), alerts, {
    settings: alertSettings(store.get()),
    permissionChanged: broadcast,
  });
  attentionSubscription = new AttentionSubscription(attention);
  // No window is needed: a grant made in System Settings is noticed here and catches up.
  const checkPermission = () => void attention.checkPermission();
  permissionCheck = setInterval(() => {
    checkPermission();
    reportClientUpdate();
  }, 60_000);
  app.on("did-become-active", checkPermission);
  powerMonitor.on("resume", checkPermission);
  app.on("browser-window-focus", () => attention.focus(true));
  app.on("browser-window-blur", () => attention.focus(false));
  followAttention();
  void alerts.listenForClicks();
  // A relaunch from a notification routes once the subscription is ready, behind the connection gate.
  if (launchActivation) void attention.activate(launchActivation).then(openRoute);
  registerUi();
  registerBridge();
  applyMenuState(null);
  if (store.get().role === "server") backend.start();
  updates.start(updateChannel());
  applyMenuBarIcon();
  refreshTray();
  started = true;
  const settings = store.get();
  // Launch at login starts in the background with the remembered role.
  const background =
    !pendingOpen &&
    !pendingActivate &&
    settings.role !== null &&
    app.getLoginItemSettings().wasOpenedAtLogin;
  if (!background) openWindow();
  if (pendingActivate) void attention.dock(false).then(openRoute);
  if (store.problem) void dialog.showMessageBox({ type: "warning", message: store.problem });
  void remindAboutPreviousInstallation();
}

const previousInstallationPaths = () =>
  defaultPreviousInstallationPaths(
    process.env,
    homedir(),
    app.getPath("appData"),
    app.getPath("userData"),
  );

async function refreshPreviousInstallation() {
  const paths = previousInstallationPaths();
  previous = paths ? await previousInstallation(paths) : null;
  if (started) broadcast();
}

async function migrateAtFirstLaunch(): Promise<boolean> {
  const paths = previousInstallationPaths();
  if (!paths) return true;
  for (;;) {
    const problem = await migratePreviousInstallation(paths, () =>
      app.setLoginItemSettings({ openAtLogin: true }),
    ).then(
      (outcome) => (outcome.kind === "refused" ? outcome.reason : null),
      (error: unknown) => `${migrationText.failed}\n\n${String(error)}`,
    );
    if (problem === null) return true;
    const { response } = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Retry", "Quit"],
      defaultId: 0,
      cancelId: 1,
      message: migrationText.migrating,
      detail: problem,
    });
    if (response === 1) return false;
  }
}

async function confirmPreviousInstallationRemoval(): Promise<DesktopResult> {
  const paths = previousInstallationPaths();
  if (!paths || !previous?.oldDataPresent) return failed(migrationText.nothingToRemove);
  const options = {
    type: "warning" as const,
    buttons: ["Move to Trash", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: migrationText.removeQuestion,
    detail: migrationText.removeDetail,
  };
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  if (response !== 0) return { ok: true };
  const refused = await removePreviousInstallation(
    paths,
    (path) => shell.trashItem(path),
    new Date(),
  ).catch((error: unknown) => ({ refused: `The data could not be moved: ${String(error)}` }));
  await refreshPreviousInstallation();
  return refused ? failed(refused.refused) : { ok: true };
}

async function remindAboutPreviousInstallation() {
  const paths = previousInstallationPaths();
  if (!paths || !(await removalReminderDue(paths, new Date()))) return;
  const { response } = await dialog.showMessageBox({
    type: "info",
    buttons: ["Move to Trash…", "Remind Me in 30 Days"],
    defaultId: 1,
    cancelId: 1,
    message: migrationText.reminder,
    detail: migrationText.reminderDetail,
  });
  await postponeRemovalReminder(paths, new Date());
  if (response === 0) await confirmPreviousInstallationRemoval();
}
