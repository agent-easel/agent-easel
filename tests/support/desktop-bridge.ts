import {
  livePortMessage,
  type DesktopMenuCommandId,
  type DesktopRoute,
  type DesktopState,
  type FactoryDesktop,
  type NotificationPermission,
} from "../../packages/contracts/src/desktop-bridge.ts";

export const desktopBridgeOptions = (
  role: "client" | "server" | null = null,
  update: DesktopState["update"]["state"] = "downloaded",
  releaseNotes:
    | string
    | null = "<ul><li>Reopen authorization from an approved client.</li><li>Review client and server upgrades together.</li></ul>",
) => ({ role, update, releaseNotes, livePortMessage });

// The bundled desktop UI asks the native shell for its role. This stand-in bridge reports
// a first launch and records the choice; native lifecycle is proven by the packaged probe.
// Its live relay stands in for the main process: a page WebSocket to the fixture, relayed
// over a MessageChannel with the same delivery messages the desktop main process posts.
// The application menu is recorded in window.__desktopMenu; window.__chooseMenuItem(id)
// stands in for a pointer click on a native menu item. window.__observePermission(state)
// stands in for the main process re-reading macOS notification permission, and
// window.__notificationSettingsOpened records Open System Settings. window.__route(route) stands
// in for a notification or Dock click the main process routed to the window.
export function desktopBridgeScript({
  role,
  update,
  releaseNotes,
  livePortMessage,
  rejectAppearanceSave,
}: ReturnType<typeof desktopBridgeOptions> & { rejectAppearanceSave?: boolean }) {
  const desktopWindow = window as Window & {
    factoryDesktop?: FactoryDesktop;
    __desktopMenu?: Parameters<FactoryDesktop["setMenuState"]>[0];
    __chooseMenuItem?: (id: DesktopMenuCommandId) => void;
    __clientInstallRequested?: boolean;
    __observePermission?: (permission: NotificationPermission) => void;
    __notificationSettingsOpened?: boolean;
    __route?: (route: DesktopRoute) => void;
  };
  let state: DesktopState = {
    version: "0.1.0",
    role: role,
    server: role === "client" ? { url: "https://factory.example", fingerprint: "fixture" } : null,
    launchAtLogin: false,
    menuBarIcon: false,
    alerts: {
      notifications: true,
      notifyRunFinished: false,
      dockBadge: true,
      showRunDetails: false,
    },
    notificationPermission: "undetermined",
    updateChannel: "stable",
    backend: { state: role === "server" ? "running" : "stopped", message: null },
    minimized: false,
    update: {
      state: update,
      version: "0.2.0",
      progress: 64,
      downloadedBytes: 81000000,
      totalBytes: 126000000,
      message: null,
      checkedAt: null,
      releaseNotes: releaseNotes,
    },
  };
  const listeners = new Set<Parameters<FactoryDesktop["onState"]>[0]>();
  const publish = () => listeners.forEach((listener) => listener(state));
  const menuListeners = new Set<Parameters<FactoryDesktop["onMenuCommand"]>[0]>();
  desktopWindow.__chooseMenuItem = (id) => menuListeners.forEach((listener) => listener(id));
  const routeListeners = new Set<Parameters<FactoryDesktop["onRoute"]>[0]>();
  desktopWindow.__route = (route) => routeListeners.forEach((listener) => listener(route));
  desktopWindow.__observePermission = (notificationPermission) => {
    state = { ...state, notificationPermission };
    publish();
  };
  desktopWindow.factoryDesktop = {
    getState: async () => state,
    onState: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    chooseRole: async (role) => {
      state = { ...state, role };
      publish();
      return { ok: true };
    },
    probeServer: async () => ({
      ok: false,
      message: "No AgentEasel server answered securely at that address.",
    }),
    connectServer: async () => ({ ok: true }),
    forgetServer: async () => ({ ok: true }),
    retryBackend: async () => ({ ok: true }),
    setLaunchAtLogin: async () => ({ ok: true }),
    setMenuBarIcon: async (menuBarIcon) => {
      state = { ...state, menuBarIcon };
      publish();
      return { ok: true };
    },
    setAlertSetting: async (name, enabled) => {
      state = { ...state, alerts: { ...state.alerts, [name]: enabled } };
      publish();
      return { ok: true };
    },
    openNotificationSettings: async () => {
      desktopWindow.__notificationSettingsOpened = true;
      return { ok: true };
    },
    checkForUpdates: async () => ({ ok: true }),
    downloadUpdate: async () => {
      state = { ...state, update: { ...state.update, state: "downloaded", progress: 100 } };
      publish();
      return { ok: true };
    },
    setUpdateChannel: async (updateChannel) => {
      state = { ...state, updateChannel };
      publish();
      return { ok: true };
    },
    setAppearance: async (preference) =>
      rejectAppearanceSave
        ? { ok: false, message: `The desktop fixture refused to save ${preference}.` }
        : { ok: true },
    installUpdate: async () => {
      desktopWindow.__clientInstallRequested = true;
      state = { ...state, update: { ...state.update, state: "idle", version: null } };
      publish();
      return { ok: true };
    },
    setMenuState: async (commands) => {
      desktopWindow.__desktopMenu = commands;
      return { ok: true };
    },
    onMenuCommand: (listener) => (
      menuListeners.add(listener),
      () => menuListeners.delete(listener)
    ),
    onRoute: (listener) => (routeListeners.add(listener), () => routeListeners.delete(listener)),
    openLive: async (query, nonce) => {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(scheme + "://" + location.host + "/api/live" + query);
      socket.binaryType = "arraybuffer";
      const { port1, port2 } = new MessageChannel();
      let closed = false;
      const end = (code: number, reason: string) => {
        if (closed) return;
        closed = true;
        port1.postMessage({ type: "close", code, reason });
        port1.close();
      };
      socket.onopen = () => closed || port1.postMessage({ type: "open" });
      socket.onmessage = ({ data }) =>
        closed ||
        port1.postMessage({
          type: "message",
          data: typeof data === "string" ? data : new Uint8Array(data),
        });
      socket.onclose = ({ code, reason }) => end(code === 1005 ? 1000 : code, reason);
      socket.onerror = () => end(1006, "");
      port1.onmessage = ({ data }) => {
        if (data.type === "message" && socket.readyState === WebSocket.OPEN) socket.send(data.data);
        if (data.type === "close") {
          closed = true;
          port1.close();
          socket.close();
        }
      };
      window.postMessage({ type: livePortMessage, nonce }, location.origin, [port2]);
      return { ok: true };
    },
  };
}
