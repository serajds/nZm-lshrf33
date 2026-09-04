export function reloadOnceOnServiceWorkerUpdate(
  serviceWorker: ServiceWorkerContainer = navigator.serviceWorker,
  reload: () => void = () => window.location.reload(),
): () => void {
  let reloadingForUpdate = false;
  const onControllerChange = () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    reload();
  };
  serviceWorker.addEventListener("controllerchange", onControllerChange);
  return () => serviceWorker.removeEventListener("controllerchange", onControllerChange);
}