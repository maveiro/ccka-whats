import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getSnapshot() {
  return document.documentElement.classList.contains("light");
}

// SSR assume escuro (padrão histórico); o script inline em app/layout.tsx já
// corrige a classe antes da pintura quando a preferência é clara, e
// useSyncExternalStore lê o valor real do DOM desde o primeiro render no
// cliente — sem useEffect+setState (regra do AGENTS.md: não somar nesse
// padrão, já é a maior parte da dívida de lint herdada).
function getServerSnapshot() {
  return false;
}

export function useIsLightTheme(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
