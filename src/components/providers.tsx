"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Tooltip } from "radix-ui";
import { Toaster } from "sonner";

type Theme = "light" | "dark";
const ThemeContext = React.createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "light", setTheme: () => {} });

export function useTheme() {
  return React.useContext(ThemeContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
          mutations: { retry: 0 },
        },
      }),
  );
  const [theme, setThemeState] = React.useState<Theme>("light");

  React.useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with the pre-paint script
    setThemeState(current === "dark" ? "dark" : "light");
  }, []);

  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("knowlix-theme", t);
    } catch {
      /* private mode */
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <QueryClientProvider client={client}>
        <Tooltip.Provider delayDuration={250}>
          {children}
          <Toaster
            position="bottom-right"
            theme={theme}
            toastOptions={{
              classNames: {
                toast: "!rounded-xl !border !border-rule !bg-card !text-ink !shadow-lift !font-sans",
                description: "!text-ink-2",
              },
            }}
          />
        </Tooltip.Provider>
      </QueryClientProvider>
    </ThemeContext.Provider>
  );
}
