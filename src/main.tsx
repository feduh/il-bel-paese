import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import ErrorBoundary from "./components/ErrorBoundary";
import { installErrorHandlers } from "./lib/errorHandlers";
import "./i18n";
import "@fontsource-variable/inter";
import "@fontsource-variable/stack-sans-notch";
import "./index.css";

installErrorHandlers();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
