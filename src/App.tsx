import { Component, type ErrorInfo, type ReactNode } from "react";
import { Bubble } from "./components/Bubble";
import { Settings } from "./components/Settings";
import { ScriptWindow } from "./components/ScriptWindow";
import { PreviewDrawer } from "./components/PreviewDrawer";
import { ReviewStudio } from "./components/ReviewStudio";
import { ZenithEditor } from "./components/ZenithEditor";
import { ZenithResearch } from "./components/ZenithResearch";

/* ── Error Boundary ── */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("[ErrorBoundary]", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ background: "#0a0a0f", color: "#e2e8f0", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", padding: 40 }}>
          <div style={{ maxWidth: 600, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#x26A0;</div>
            <h2 style={{ color: "#ef4444", marginBottom: 8 }}>Something went wrong</h2>
            <pre style={{ background: "rgba(255,255,255,0.05)", padding: 16, borderRadius: 8, textAlign: "left", overflow: "auto", maxHeight: 300, fontSize: 12, color: "#fca5a5" }}>
              {this.state.error.message}{"\n"}{this.state.error.stack}
            </pre>
            <button onClick={() => { localStorage.removeItem("zenith_research_pipeline"); this.setState({ error: null }); }}
              style={{ marginTop: 16, padding: "8px 24px", background: "rgba(34,211,238,0.15)", border: "1px solid rgba(34,211,238,0.3)", color: "#67e8f9", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
              Clear Cache &amp; Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const params = new URLSearchParams(window.location.search);
  const windowType = params.get("window");

  if (windowType === "settings") {
    return <Settings />;
  }

  if (windowType === "script") {
    return <ScriptWindow />;
  }

  if (windowType === "editor") {
    return <ZenithEditor />;
  }

  if (windowType === "research") {
    return (
      <ErrorBoundary>
        <ZenithResearch />
      </ErrorBoundary>
    );
  }

  return (
    <>
      <Bubble />
      <PreviewDrawer />
      <ReviewStudio />
    </>
  );
}

export default App;
