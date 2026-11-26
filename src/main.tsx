import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

try {
  const pendingRedirect = sessionStorage.getItem("mdo_spa_redirect");
  if (pendingRedirect && pendingRedirect.startsWith("/")) {
    sessionStorage.removeItem("mdo_spa_redirect");
    window.history.replaceState(null, "", pendingRedirect);
  }
} catch {
  // Ignore storage errors
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
