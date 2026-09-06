"use client";

import { useEffect, useRef, useState } from "react";

type NaverMapStatus = "loading" | "ready" | "unavailable" | "error";

type NaverLatLng = object;
type NaverMapInstance = {
  destroy?: () => void;
};
type NaverMarkerInstance = {
  setMap: (map: NaverMapInstance | null) => void;
};

type NaverMapsNamespace = {
  Map: new (
    element: HTMLElement,
    options: {
      center: NaverLatLng;
      zoom: number;
      zoomControl: boolean;
      mapTypeControl: boolean;
      scaleControl: boolean;
    },
  ) => NaverMapInstance;
  Marker: new (options: {
    position: NaverLatLng;
    map: NaverMapInstance;
  }) => NaverMarkerInstance;
  LatLng: new (latitude: number, longitude: number) => NaverLatLng;
  Service: {
    Status: { OK: unknown };
    geocode: (
      options: { query: string },
      callback: (
        status: unknown,
        response: {
          v2?: { addresses?: { x: string; y: string }[] };
        },
      ) => void,
    ) => void;
  };
};

declare global {
  interface Window {
    naver?: { maps: NaverMapsNamespace };
    navermap_authFailure?: () => void;
  }
}

let naverMapsPromise: Promise<NaverMapsNamespace> | null = null;

function loadNaverMaps(clientId: string) {
  if (window.naver?.maps?.Service) {
    return Promise.resolve(window.naver.maps);
  }
  if (naverMapsPromise) return naverMapsPromise;

  naverMapsPromise = new Promise<NaverMapsNamespace>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-naver-maps-sdk]",
    );
    const script = existing ?? document.createElement("script");
    const previousAuthFailure = window.navermap_authFailure;
    let settled = false;
    let timeout = 0;
    let readinessPoll = 0;

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.clearInterval(readinessPoll);
      script.removeEventListener("load", finish);
      script.removeEventListener("error", handleScriptError);
      if (window.navermap_authFailure === authFailure) {
        if (previousAuthFailure) {
          window.navermap_authFailure = previousAuthFailure;
        } else {
          delete window.navermap_authFailure;
        }
      }
    };

    const finish = () => {
      if (settled || !window.naver?.maps?.Service) return;
      settled = true;
      cleanup();
      resolve(window.naver.maps);
    };
    const fail = (error = new Error("네이버 지도 SDK를 불러오지 못했습니다.")) => {
      if (settled) return;
      settled = true;
      cleanup();
      naverMapsPromise = null;
      reject(error);
    };
    const authFailure = () =>
      fail(new Error("네이버 지도 인증에 실패했습니다."));
    const handleScriptError = () => fail();

    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", handleScriptError, { once: true });
    window.navermap_authFailure = authFailure;

    timeout = window.setTimeout(
      () => fail(new Error("네이버 지도 SDK 응답 시간이 초과되었습니다.")),
      15_000,
    );
    readinessPoll = window.setInterval(finish, 50);

    if (!existing) {
      script.dataset.naverMapsSdk = "true";
      script.async = true;
      script.src =
        `https://oapi.map.naver.com/openapi/v3/maps.js?` +
        `ncpKeyId=${encodeURIComponent(clientId)}&submodules=geocoder`;
      document.head.appendChild(script);
    }

    finish();
  });

  return naverMapsPromise;
}

function geocode(maps: NaverMapsNamespace, query: string) {
  return new Promise<NaverLatLng>((resolve, reject) => {
    maps.Service.geocode({ query }, (status, response) => {
      const address = response.v2?.addresses?.[0];
      if (status !== maps.Service.Status.OK || !address) {
        reject(new Error("단지 위치를 찾지 못했습니다."));
        return;
      }
      resolve(new maps.LatLng(Number(address.y), Number(address.x)));
    });
  });
}

export function NaverMap({
  query,
  apartment,
  district,
  dong,
  externalUrl,
}: {
  query: string;
  apartment: string;
  district: string;
  dong: string;
  externalUrl: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<NaverMapStatus>("loading");

  useEffect(() => {
    const container = containerRef.current;
    let cancelled = false;
    let map: NaverMapInstance | null = null;
    let marker: NaverMarkerInstance | null = null;

    async function renderMap() {
      setStatus("loading");
      try {
        const response = await fetch("/api/map-config", { cache: "no-store" });
        const config = (await response.json()) as {
          enabled: boolean;
          clientId: string | null;
        };
        if (!config.enabled || !config.clientId) {
          if (!cancelled) setStatus("unavailable");
          return;
        }

        const maps = await loadNaverMaps(config.clientId);
        const center = await geocode(maps, query);
        if (cancelled || !container) return;

        map = new maps.Map(container, {
          center,
          zoom: 16,
          zoomControl: true,
          mapTypeControl: false,
          scaleControl: true,
        });
        marker = new maps.Marker({ position: center, map });
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void renderMap();

    return () => {
      cancelled = true;
      marker?.setMap(null);
      map?.destroy?.();
      container?.replaceChildren();
    };
  }, [query]);

  return (
    <div className={`detail-naver-map-shell is-${status}`}>
      <div
        ref={containerRef}
        className="detail-naver-live-map"
        role="img"
        aria-label={`${apartment} 네이버 지도`}
      />

      {status === "loading" && (
        <div className="detail-naver-map-loading" aria-live="polite">
          <span aria-hidden="true" />
          네이버지도를 불러오는 중
        </div>
      )}

      {(status === "unavailable" || status === "error") && (
        <a
          className="detail-naver-map-preview"
          href={externalUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`${apartment} 네이버지도에서 열기`}
        >
          <span className="detail-naver-map-brand"><b>N</b> NAVER MAP</span>
          <span className="detail-naver-map-pin" aria-hidden="true">N</span>
          <strong>{apartment}</strong>
          <small>{district} {dong}</small>
          <em>
            {status === "unavailable"
              ? "지도 연동 준비 중 · 네이버지도 열기 ↗"
              : "위치 검색 실패 · 네이버지도 열기 ↗"}
          </em>
        </a>
      )}

      {status === "ready" && (
        <a
          className="detail-naver-map-open"
          href={externalUrl}
          target="_blank"
          rel="noreferrer"
        >
          네이버지도에서 크게 보기 ↗
        </a>
      )}
    </div>
  );
}
