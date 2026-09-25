let pending: Promise<typeof google.maps> | undefined;
/** Loaded only when the map tab is opened. This key is public and referrer restricted. */
export function loadGoogleMaps(apiKey: string): Promise<typeof google.maps> {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const globals = window as unknown as Record<string, unknown>;
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      pending = undefined;
      reject(new Error("地圖暫時載入唔到，請用清單或再試。"));
    };
    const timer = setTimeout(fail, 15000);
    globals.ec2eatMapReady = () => {
      clearTimeout(timer);
      resolve(google.maps);
    };
    script.onerror = fail;
    script.src = "https://maps.googleapis.com/maps/api/js?" + new URLSearchParams({
      key: apiKey, loading: "async", callback: "ec2eatMapReady", v: "quarterly", language: "zh-TW", region: "HK",
    });
    script.async = true;
    document.head.appendChild(script);
  });
  return pending;
}
