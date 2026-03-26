import { Bubble } from "./components/Bubble";
import { Settings } from "./components/Settings";
import { ScriptWindow } from "./components/ScriptWindow";
import { PreviewDrawer } from "./components/PreviewDrawer";
import { ReviewStudio } from "./components/ReviewStudio";
import { ZenithEditor } from "./components/ZenithEditor";

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

  return (
    <>
      <Bubble />
      <PreviewDrawer />
      <ReviewStudio />
    </>
  );
}

export default App;
