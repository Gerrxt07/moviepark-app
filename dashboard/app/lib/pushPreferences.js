export const FAVORITES_STORAGE_KEY = "moviepark-attraction-favorites";

export function storedFavoriteIds() {
  try {
    const values = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
    return Array.isArray(values) ? values.map(Number).filter(Number.isSafeInteger).slice(0,100) : [];
  } catch { return []; }
}

export function favoritePushPreferences(favorites = storedFavoriteIds()) {
  return { favoriteAlerts:true, reopenAlerts:true, showReminders:true, threshold:15, favorites };
}

export async function syncPushPreferences(checkedInUntil, favorites = storedFavoriteIds()) {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager?.getSubscription();
  if (!subscription) return;
  await fetch("/api/push", { method:"PATCH", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({
    endpoint:subscription.endpoint, checkedInUntil:checkedInUntil ?? null, preferences:favoritePushPreferences(favorites),
  }) });
}
