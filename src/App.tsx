import { Bubble } from "./components/Bubble";
import { Settings } from "./components/Settings";
import { ScriptWindow } from "./components/ScriptWindow";

function App() {
  const params = new URLSearchParams(window.location.search);
  const windowType = params.get("window");

  if (windowType === "settings") {
    return <Settings />;
  }

  if (windowType === "script") {
    return <ScriptWindow />;
  }

  return <Bubble />;
}

export default App;
