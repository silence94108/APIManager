import { createRoot } from "react-dom/client";
import "@/styles/global.css";
import { initUiZoom } from "@/ui/uiZoom";
import App from "./App";

initUiZoom();
createRoot(document.getElementById("root")!).render(<App />);
