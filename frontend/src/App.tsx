import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Composer from "./components/Composer";
import Rail from "./components/Rail";
import Home from "./pages/Home";
import LinkPage from "./pages/LinkPage";
import Settings from "./pages/Settings";
import { StoreProvider, useStore } from "./store";

function Shell() {
  const { composer, setComposer } = useStore();
  const { pathname } = useLocation();
  // on phones only one pane shows: the list at "/", the detail everywhere else
  const pane = pathname === "/" ? "list" : "detail";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "n" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) {
        e.preventDefault();
        setComposer(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setComposer]);

  return (
    <div className="shell" data-pane={pane}>
      <Routes>
        <Route path="/links/:code" element={<Rail />} />
        <Route path="*" element={<Rail />} />
      </Routes>
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/links/:code" element={<LinkPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<div className="empty"><div><h2>Page not found</h2></div></div>} />
        </Routes>
      </main>
      {composer && <Composer />}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
