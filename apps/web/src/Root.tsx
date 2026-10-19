import { useEffect, useState } from "react";
import { App } from "./App";
import { Landing } from "./Landing";
import { isAppRoute, parseAppPath, syncUrl } from "./routes";

export function Root() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const route = parseAppPath(path);
  if (!isAppRoute(route)) {
    return (
      <Landing
        onOpenApp={() => {
          syncUrl("/app");
          setPath("/app");
        }}
      />
    );
  }

  return <App />;
}
