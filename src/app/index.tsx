import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Alert,
  Dimensions,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import {
  WebView,
  WebViewMessageEvent,
} from "react-native-webview";

import * as Location from "expo-location";

import AsyncStorage from "@react-native-async-storage/async-storage";

/* ========================================================================= */
/* TYPES                                                                     */
/* ========================================================================= */

type Coordinate = {
  latitude: number;
  longitude: number;
};

type BoatProfile = {
  boatName: string;
  manufacturer: string;
  model: string;
  year: string;
  length: string;
  beam: string;
  engineMake: string;
  engineModel: string;
  horsepower: string;
  displacement: string;
  tankCapacity: string;
  propeller: string;
  draft: string;
};

type FuelStation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  petrolPrice: string;
  dieselPrice: string;
  marinePrice: string;
  updatedAt: number;
};

type Screen =
  | "home"
  | "routes"
  | "boat"
  | "engine"
  | "fuel"
  | "data"
  | "settings";

/* ========================================================================= */
/* CONSTANTS                                                                 */
/* ========================================================================= */

const BOAT_STORAGE =
  "@sjokart_boat_profile_v11";

const FUEL_STORAGE =
  "@sjokart_fuel_stations_v11";

const DEFAULT_BOAT: BoatProfile = {
  boatName: "NORDKAPP 17 HT",
  manufacturer: "Nordkapp",
  model: "17 HT / Prince HT",
  year: "1986",
  length: "5.15",
  beam: "2.12",
  engineMake: "Evinrude",
  engineModel: "E-TEC 200",
  horsepower: "200",
  displacement: "2.7",
  tankCapacity: "90",
  propeller: "Viper 21P",
  draft: "0.30",
};

const DEFAULT_REGION = {
  latitude: 59.9111,
  longitude: 10.7528,
  latitudeDelta: 0.22,
  longitudeDelta: 0.32,
};

/* ========================================================================= */
/* GEO                                                                       */
/* ========================================================================= */

function distanceMeters(
  a: Coordinate,
  b: Coordinate
) {
  const R = 6371000;

  const lat1 =
    (a.latitude * Math.PI) / 180;

  const lat2 =
    (b.latitude * Math.PI) / 180;

  const dLat =
    ((b.latitude - a.latitude) *
      Math.PI) /
    180;

  const dLon =
    ((b.longitude - a.longitude) *
      Math.PI) /
    180;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLon / 2) ** 2;

  return (
    R *
    2 *
    Math.atan2(
      Math.sqrt(h),
      Math.sqrt(1 - h)
    )
  );
}

function bearingDegrees(
  a: Coordinate,
  b: Coordinate
) {
  const lat1 =
    (a.latitude * Math.PI) / 180;

  const lat2 =
    (b.latitude * Math.PI) / 180;

  const dLon =
    ((b.longitude - a.longitude) *
      Math.PI) /
    180;

  const y =
    Math.sin(dLon) * Math.cos(lat2);

  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) *
      Math.cos(lat2) *
      Math.cos(dLon);

  return (
    ((Math.atan2(y, x) * 180) /
      Math.PI +
      360) %
    360
  );
}

function formatBearing(
  degrees: number
) {
  return `${Math.round(
    ((degrees % 360) + 360) % 360
  )
    .toString()
    .padStart(3, "0")}°`;
}

function formatNm(
  meters: number
) {
  return (
    meters / 1852
  ).toFixed(2);
}

function formatDuration(
  seconds: number
) {
  if (
    !Number.isFinite(
      seconds
    )
  ) {
    return "--";
  }

  if (seconds < 60) {
    return "<1 min";
  }

  const hours =
    Math.floor(
      seconds / 3600
    );

  const minutes =
    Math.floor(
      (seconds % 3600) / 60
    );

  if (hours > 0) {
    return `${hours}t ${minutes}m`;
  }

  return `${minutes}m`;
}

function totalRouteDistance(
  points: Coordinate[]
) {
  let total = 0;

  for (
    let i = 1;
    i < points.length;
    i++
  ) {
    total += distanceMeters(
      points[i - 1],
      points[i]
    );
  }

  return total;
}

function nearestRouteIndex(
  position: Coordinate,
  route: Coordinate[]
) {
  if (!route.length) {
    return 0;
  }

  let index = 0;
  let smallest =
    Number.POSITIVE_INFINITY;

  for (
    let i = 0;
    i < route.length;
    i++
  ) {
    const dx =
      (route[i].longitude -
        position.longitude) *
      Math.cos(
        (position.latitude *
          Math.PI) /
          180
      );

    const dy =
      route[i].latitude -
      position.latitude;

    const score =
      dx * dx + dy * dy;

    if (
      score < smallest
    ) {
      smallest = score;
      index = i;
    }
  }

  return index;
}

function remainingRouteDistance(
  position: Coordinate,
  route: Coordinate[]
) {
  if (!route.length) {
    return 0;
  }

  const index =
    nearestRouteIndex(
      position,
      route
    );

  let total =
    distanceMeters(
      position,
      route[index]
    );

  for (
    let i = index + 1;
    i < route.length;
    i++
  ) {
    total += distanceMeters(
      route[i - 1],
      route[i]
    );
  }

  return total;
}

function routeBearing(
  position: Coordinate,
  route: Coordinate[]
) {
  if (
    !route.length
  ) {
    return 0;
  }

  const index =
    nearestRouteIndex(
      position,
      route
    );

  const next =
    route[
      Math.min(
        index + 1,
        route.length - 1
      )
    ];

  return bearingDegrees(
    position,
    next
  );
}

/* ========================================================================= */
/* KARTVERKET + LEAFLET + SEA ROUTE                                         */
/* ========================================================================= */

const MAP_HTML = `
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8" />

<meta
  name="viewport"
  content="width=device-width,
  initial-scale=1.0,
  maximum-scale=1.0,
  user-scalable=no"
/>

<link
  rel="stylesheet"
  href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
/>

<script
  src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js">
</script>

<style>

html,
body,
#map {

  width:100%;
  height:100%;

  margin:0;
  padding:0;

  overflow:hidden;

  background:#06111A;

}

.leaflet-container {

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "SF Pro Display",
    "Segoe UI",
    sans-serif;

}

.leaflet-control-zoom {

  margin-right:12px !important;
  margin-bottom:115px !important;

}

.leaflet-control-attribution {

  font-size:8px;

}

.boat-marker {

  width:36px;
  height:36px;

  border-radius:50%;

  background:
    rgba(14,165,233,0.18);

  border:2px solid #0EA5E9;

  box-shadow:
    0 0 0 8px
    rgba(14,165,233,0.07),

    0 0 24px
    rgba(14,165,233,0.42);

  position:relative;

}

.boat-arrow {

  position:absolute;

  left:50%;
  top:50%;

  width:0;
  height:0;

  margin-left:-8px;
  margin-top:-12px;

  border-left:
    8px solid transparent;

  border-right:
    8px solid transparent;

  border-bottom:
    20px solid #F5FCFF;

  transform-origin:
    50% 70%;

}

.destination-marker {

  width:31px;
  height:31px;

  border-radius:50%;

  background:
    rgba(239,68,68,0.16);

  border:
    3px solid #EF7178;

  box-shadow:
    0 0 0 6px
    rgba(239,68,68,0.08);

}

.fuel-marker {

  width:35px;
  height:35px;

  border-radius:12px;

  display:flex;
  align-items:center;
  justify-content:center;

  background:
    rgba(8,37,30,0.97);

  border:
    2px solid #2DD4A3;

  color:#F5FFFC;

  font-size:17px;

  box-shadow:
    0 4px 15px
    rgba(0,0,0,0.4);

}

</style>

</head>

<body>

<div id="map"></div>

<script>

const map =
  L.map("map", {

    zoomControl:false,

    attributionControl:true,

    preferCanvas:true,

    minZoom:5,

    maxZoom:18

  })
  .setView(
    [
      ${DEFAULT_REGION.latitude},
      ${DEFAULT_REGION.longitude}
    ],
    10
  );

L.control.zoom({
  position:"bottomright"
}).addTo(map);

L.tileLayer(

  "https://cache.kartverket.no/v1/wmts/1.0.0/sjokartraster/default/webmercator/{z}/{y}/{x}.png",

  {
    attribution:
      "© Kartverket",

    maxZoom:18,

    tileSize:256

  }

).addTo(map);

/* ------------------------------------------------------------------------- */
/* STATE                                                                     */
/* ------------------------------------------------------------------------- */

let boatMarker = null;

let routeLine = null;

let destinationMarker = null;

let fuelLayer =
  L.layerGroup().addTo(map);

let suppressClickUntil = 0;

/* ------------------------------------------------------------------------- */
/* ICONS                                                                     */
/* ------------------------------------------------------------------------- */

function makeBoatIcon(
  heading
) {

  return L.divIcon({

    className:"",

    html:
      '<div class="boat-marker">' +
      '<div class="boat-arrow" ' +
      'style="transform:rotate(' +
      Number(heading || 0) +
      'deg)"></div>' +
      '</div>',

    iconSize:[36,36],

    iconAnchor:[18,18]

  });

}

const destinationIcon =
  L.divIcon({

    className:"",

    html:
      '<div class="destination-marker"></div>',

    iconSize:[31,31],

    iconAnchor:[15.5,15.5]

  });

const fuelIcon =
  L.divIcon({

    className:"",

    html:
      '<div class="fuel-marker">⛽</div>',

    iconSize:[35,35],

    iconAnchor:[17.5,17.5]

  });

/* ------------------------------------------------------------------------- */
/* BOAT                                                                       */
/* ------------------------------------------------------------------------- */

window.setBoatPosition =
function(
  lat,
  lng,
  heading,
  follow
) {

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return;
  }

  if (!boatMarker) {

    boatMarker =
      L.marker(
        [lat,lng],
        {
          icon:
            makeBoatIcon(
              heading
            ),

          zIndexOffset:1000

        }
      ).addTo(map);

  } else {

    boatMarker.setLatLng(
      [lat,lng]
    );

    boatMarker.setIcon(
      makeBoatIcon(
        heading
      )
    );

  }

  if (follow) {

    map.setView(

      [lat,lng],

      Math.max(
        map.getZoom(),
        14
      ),

      {
        animate:true
      }

    );

  }

};

/* ------------------------------------------------------------------------- */
/* ROUTE                                                                      */
/* ------------------------------------------------------------------------- */

window.setRoute =
function(
  points
) {

  if (
    routeLine
  ) {

    map.removeLayer(
      routeLine
    );

  }

  if (
    destinationMarker
  ) {

    map.removeLayer(
      destinationMarker
    );

  }

  routeLine = null;

  destinationMarker =
    null;

  if (
    !Array.isArray(points) ||
    points.length < 2
  ) {

    return;

  }

  const line =
    points.map(
      point => [
        Number(
          point.latitude
        ),

        Number(
          point.longitude
        )
      ]
    );

  routeLine =
    L.polyline(
      line,
      {
        color:"#0EA5E9",
        weight:5,
        opacity:0.96,
        dashArray:"12 10",
        lineJoin:"round"
      }
    ).addTo(map);

  const last =
    line[line.length - 1];

  destinationMarker =
    L.marker(
      last,
      {
        icon:
          destinationIcon,

        zIndexOffset:900
      }
    ).addTo(map);

};

/* ------------------------------------------------------------------------- */
/* CLEAR ROUTE                                                               */
/* ------------------------------------------------------------------------- */

window.clearRoute =
function() {

  if (
    routeLine
  ) {

    map.removeLayer(
      routeLine
    );

  }

  if (
    destinationMarker
  ) {

    map.removeLayer(
      destinationMarker
    );

  }

  routeLine = null;

  destinationMarker =
    null;

};

/* ------------------------------------------------------------------------- */
/* FUEL                                                                       */
/* ------------------------------------------------------------------------- */

window.setFuelStations =
function(
  stations
) {

  fuelLayer.clearLayers();

  (
    Array.isArray(
      stations
    )
      ? stations
      : []
  ).forEach(
    station => {

      const marker =
        L.marker(
          [
            station.latitude,
            station.longitude
          ],
          {
            icon:fuelIcon,
            zIndexOffset:500
          }
        ).addTo(
          fuelLayer
        );

      const prices = [

        station.marinePrice
          ? "Marine " +
            station.marinePrice
          : null,

        station.petrolPrice
          ? "95 " +
            station.petrolPrice
          : null,

        station.dieselPrice
          ? "Diesel " +
            station.dieselPrice
          : null

      ]
      .filter(Boolean)
      .join(" • ");

      marker.bindTooltip(
        "<b>" +
        station.name +
        "</b>" +
        (
          prices
            ? "<br>" + prices
            : ""
        ),
        {
          direction:"top"
        }
      );

      marker.on(
        "click",
        function() {

          window.ReactNativeWebView
            .postMessage(
              JSON.stringify({

                type:
                  "FUEL_CLICK",

                id:
                  station.id

              })
            );

        }
      );

    }
  );

};

/* ------------------------------------------------------------------------- */
/* CENTER                                                                     */
/* ------------------------------------------------------------------------- */

window.centerBoat =
function() {

  if (
    !boatMarker
  ) {

    return;

  }

  const point =
    boatMarker.getLatLng();

  map.setView(
    [
      point.lat,
      point.lng
    ],
    Math.max(
      map.getZoom(),
      14
    ),
    {
      animate:true
    }
  );

};

/* ------------------------------------------------------------------------- */
/* LONG PRESS                                                                */
/* ------------------------------------------------------------------------- */

const container =
  map.getContainer();

let pressTimer =
  null;

let pressStart = null;

let longPressTriggered =
  false;

container.addEventListener(
  "touchstart",
  function(event) {

    if (
      !event.touches ||
      !event.touches[0]
    ) {
      return;
    }

    const touch =
      event.touches[0];

    pressStart = {
      x:
        touch.clientX,

      y:
        touch.clientY,

      latlng:
        map.mouseEventToLatLng(
          touch
        )
    };

    longPressTriggered =
      false;

    clearTimeout(
      pressTimer
    );

    pressTimer =
      setTimeout(
        function() {

          if (
            !pressStart
          ) {
            return;
          }

          longPressTriggered =
            true;

          suppressClickUntil =
            Date.now() + 900;

          window.ReactNativeWebView
            .postMessage(
              JSON.stringify({

                type:
                  "MAP_LONG_PRESS",

                latitude:
                  pressStart.latlng.lat,

                longitude:
                  pressStart.latlng.lng

              })
            );

        },
        700
      );

  },
  {
    passive:true
  }
);

container.addEventListener(
  "touchmove",
  function(event) {

    if (
      !pressStart ||
      !event.touches ||
      !event.touches[0]
    ) {

      clearTimeout(
        pressTimer
      );

      return;

    }

    const touch =
      event.touches[0];

    const dx =
      touch.clientX -
      pressStart.x;

    const dy =
      touch.clientY -
      pressStart.y;

    if (
      Math.sqrt(
        dx * dx +
        dy * dy
      ) > 12
    ) {

      clearTimeout(
        pressTimer
      );

      pressStart =
        null;

    }

  },
  {
    passive:true
  }
);

container.addEventListener(
  "touchend",
  function() {

    clearTimeout(
      pressTimer
    );

    pressStart =
      null;

  },
  {
    passive:true
  }
);

/* ------------------------------------------------------------------------- */
/* MAP CLICK                                                                 */
/* ------------------------------------------------------------------------- */

map.on(
  "click",
  function(event) {

    if (
      Date.now() <
      suppressClickUntil
    ) {

      return;

    }

    if (
      longPressTriggered
    ) {

      longPressTriggered =
        false;

      return;

    }

    window.ReactNativeWebView
      .postMessage(
        JSON.stringify({

          type:
            "MAP_CLICK",

          latitude:
            event.latlng.lat,

          longitude:
            event.latlng.lng

        })
      );

  }
);

/* ------------------------------------------------------------------------- */
/* AUTO ROUTE MODULE                                                         */
/* ------------------------------------------------------------------------- */

/*

  Browser build is loaded from esm.unpkg.com.

  React Native never imports this package.

*/

window.seaRoutePromise =
  import(
    "https://esm.unpkg.com/searoute-js@0.1.0?target=es2020"
  )
  .then(
    module =>
      module.default ||
      module
  )
  .catch(
    error => {

      console.error(
        "SeaRoute failed",
        error
      );

      return null;

    }
  );

/* ------------------------------------------------------------------------- */
/* AUTO ROUTE                                                                */
/* ------------------------------------------------------------------------- */

window.generateAutoRoute =
async function(
  fromLat,
  fromLng,
  toLat,
  toLng
) {

  try {

    const module =
      await window.seaRoutePromise;

    if (
      !module
    ) {

      throw new Error(
        "SeaRoute unavailable"
      );

    }

    const origin = {

      type:"Feature",

      properties:{},

      geometry:{

        type:"Point",

        coordinates:[
          Number(fromLng),
          Number(fromLat)
        ]

      }

    };

    const destination = {

      type:"Feature",

      properties:{},

      geometry:{

        type:"Point",

        coordinates:[
          Number(toLng),
          Number(toLat)
        ]

      }

    };

    const result =
      module(
        origin,
        destination
      );

    if (
      !result ||
      !result.geometry
    ) {

      throw new Error(
        "No route"
      );

    }

    let coordinates =
      [];

    if (
      result.geometry.type ===
      "LineString"
    ) {

      coordinates =
        result.geometry.coordinates;

    } else if (
      result.geometry.type ===
      "MultiLineString"
    ) {

      coordinates =
        result.geometry.coordinates
          .reduce(
            (all,line) =>
              all.concat(line),
            []
          );

    }

    if (
      !coordinates ||
      coordinates.length < 2
    ) {

      throw new Error(
        "Empty geometry"
      );

    }

    window.ReactNativeWebView
      .postMessage(
        JSON.stringify({

          type:
            "AUTO_ROUTE_RESULT",

          coordinates

        })
      );

  } catch(error) {

    console.error(
      "Auto route failed",
      error
    );

    window.ReactNativeWebView
      .postMessage(
        JSON.stringify({

          type:
            "AUTO_ROUTE_ERROR",

          message:
            "Auto-rute kunne ikke beregnes."

        })
      );

  }

};

/* ------------------------------------------------------------------------- */
/* READY                                                                      */
/* ------------------------------------------------------------------------- */

window.ReactNativeWebView
  .postMessage(
    JSON.stringify({
      type:"MAP_READY"
    })
  );

</script>

</body>

</html>
`;

/* ========================================================================= */
/* APP                                                                       */
/* ========================================================================= */

export default function Index() {

  const {
    width,
    height,
  } =
    Dimensions.get(
      "window"
    );

  const webMapRef =
    useRef<WebView | null>(
      null
    );

  const gpsWatch =
    useRef<
      Location.LocationSubscription |
      null
    >(null);

  const lastGpsTime =
    useRef<number | null>(
      null
    );

  const lastGpsPosition =
    useRef<Coordinate | null>(
      null
    );

  const [screen,setScreen] =
    useState<Screen>(
      "home"
    );

  const [boat,setBoat] =
    useState<BoatProfile>(
      DEFAULT_BOAT
    );

  const [draftBoat,setDraftBoat] =
    useState<BoatProfile>(
      DEFAULT_BOAT
    );

  const [gps,setGps] =
    useState<Coordinate | null>(
      null
    );

  const [gpsAccuracy,setGpsAccuracy] =
    useState<number | null>(
      null
    );

  const [gpsStatus,setGpsStatus] =
    useState<
      "searching" |
      "fixed" |
      "denied" |
      "off"
    >("searching");

  const [gpsSpeed,setGpsSpeed] =
    useState(0);

  const [heading,setHeading] =
    useState(0);

  const [speed,setSpeed] =
    useState(0);

  const [rpm,setRpm] =
    useState(850);

  const [maxSpeed,setMaxSpeed] =
    useState(0);

  const [maxRpm,setMaxRpm] =
    useState(850);

  const [trim,setTrim] =
    useState(4);

  const [depth,setDepth] =
    useState(18.4);

  const [engineTemp,setEngineTemp] =
    useState(62);

  const [battery,setBattery] =
    useState(12.72);

  const [fuel,setFuel] =
    useState(76);

  const [tripDistance,setTripDistance] =
    useState(0);

  const [tripSeconds,setTripSeconds] =
    useState(0);

  const [testMode,setTestMode] =
    useState(true);

  const [followGps,setFollowGps] =
    useState(true);

  const [mapReady,setMapReady] =
    useState(false);

  const [route,setRoute] =
    useState<Coordinate[]>(
      []
    );

  const [routeMode,setRouteMode] =
    useState<
      "none" |
      "direct" |
      "auto" |
      "fallback"
    >("none");

  const [routeTarget,setRouteTarget] =
    useState<Coordinate | null>(
      null
    );

  const [routeError,setRouteError] =
    useState("");

  const [routeBusy,setRouteBusy] =
    useState(false);

  const [contextPoint,setContextPoint] =
    useState<Coordinate | null>(
      null
    );

  const [contextOpen,setContextOpen] =
    useState(false);

  const [fuelStations,setFuelStations] =
    useState<FuelStation[]>(
      []
    );

  const [fuelModal,setFuelModal] =
    useState(false);

  const [editingFuelId,setEditingFuelId] =
    useState<string | null>(
      null
    );

  const [fuelDraft,setFuelDraft] =
    useState({
      name:"",
      latitude:0,
      longitude:0,
      petrolPrice:"",
      dieselPrice:"",
      marinePrice:"",
    });

  const isWide =
    width >= 850 ||
    width > height;

  /* ----------------------------------------------------------------------- */
  /* ROUTE DATA                                                              */
  /* ----------------------------------------------------------------------- */

  const fullRouteDistance =
    useMemo(
      () =>
        totalRouteDistance(
          route
        ),
      [route]
    );

  const routeRemaining =
    useMemo(
      () =>
        gps && route.length
          ? remainingRouteDistance(
              gps,
              route
            )
          : fullRouteDistance,
      [
        gps,
        route,
        fullRouteDistance,
      ]
    );

  const routeCourse =
    useMemo(
      () =>
        gps && route.length
          ? routeBearing(
              gps,
              route
            )
          : 0,
      [gps,route]
    );

  const routeProgress =
    fullRouteDistance > 0
      ? Math.max(
          0,
          Math.min(
            1,
            1 -
              routeRemaining /
                fullRouteDistance
          )
        )
      : 0;

  const routeEtaSeconds =
    speed > 0.3 &&
    routeRemaining > 0
      ? (
          routeRemaining /
          1852 /
          speed
        ) *
        3600
      : Infinity;

  /* ----------------------------------------------------------------------- */
  /* LOAD                                                                      */
  /* ----------------------------------------------------------------------- */

  useEffect(() => {

    loadBoat();

    loadStations();

  }, []);

  /* ----------------------------------------------------------------------- */
  /* GPS                                                                       */
  /* ----------------------------------------------------------------------- */

  useEffect(() => {

    startGps();

    return () => {

      if (
        gpsWatch.current
      ) {

        gpsWatch.current.remove();

        gpsWatch.current =
          null;

      }

    };

  }, []);

  /* ----------------------------------------------------------------------- */
  /* LIVE TESTDATA                                                            */
  /* ----------------------------------------------------------------------- */

  useEffect(() => {

    const timer =
      setInterval(
        () => {

          setTripSeconds(
            value =>
              value + 1
          );

          if (!testMode)
            return;

          setSpeed(
            current => {

              const target =
                current < 1
                  ? 12
                  : 18;

              const next =
                Math.max(
                  0,
                  Math.min(
                    40,
                    current +
                      (target -
                        current) *
                        0.04 +
                      Math.random() *
                        1.8 -
                      0.9
                  )
                );

              const rounded =
                Number(
                  next.toFixed(1)
                );

              setMaxSpeed(
                maximum =>
                  Math.max(
                    maximum,
                    rounded
                  )
              );

              return rounded;

            }
          );

          setRpm(
            current => {

              const target =
                speed > 2
                  ? 3200
                  : 850;

              const next =
                Math.max(
                  700,
                  Math.min(
                    5200,
                    current +
                      (target -
                        current) *
                        0.08 +
                      Math.random() *
                        160 -
                      80
                  )
                );

              const rounded =
                Math.round(next);

              setMaxRpm(
                maximum =>
                  Math.max(
                    maximum,
                    rounded
                  )
              );

              return rounded;

            }
          );

          setTrim(
            current =>
              Number(
                Math.max(
                  -6,
                  Math.min(
                    10,
                    current +
                      Math.random() *
                        0.3 -
                      0.15
                  )
                ).toFixed(1)
              )
          );

          setDepth(
            current =>
              Number(
                Math.max(
                  2,
                  Math.min(
                    100,
                    current +
                      Math.random() *
                        0.8 -
                      0.4
                  )
                ).toFixed(1)
              )
          );

          setEngineTemp(
            current =>
              Math.round(
                Math.max(
                  45,
                  Math.min(
                    90,
                    current +
                      Math.random() *
                        1.4 -
                      0.7
                  )
                )
              )
          );

          setBattery(
            current =>
              Number(
                Math.max(
                  11.8,
                  Math.min(
                    14.6,
                    current +
                      Math.random() *
                        0.04 -
                      0.02
                  )
                ).toFixed(2)
              )
          );

          setFuel(
            current =>
              Math.max(
                0,
                current -
                  (rpm > 2500
                    ? 0.003
                    : 0.0001)
              )
          );

          setHeading(
            current =>
              Math.round(
                (
                  current +
                  Math.random() *
                    6 -
                  3 +
                  360
                ) % 360
              )
          );

          setTripDistance(
            current =>
              current +
              Math.max(
                0,
                (speed * 1852) /
                  3600
              )
          );

        },
        1000
      );

    return () =>
      clearInterval(
        timer
      );

  }, [
    speed,
    rpm,
    testMode,
  ]);

  /* ----------------------------------------------------------------------- */
  /* UPDATE MAP BOAT                                                         */
  /* ----------------------------------------------------------------------- */

  useEffect(() => {

    if (
      !mapReady ||
      !gps
    ) {

      return;

    }

    webMapRef.current?.injectJavaScript(`

      if (window.setBoatPosition) {

        window.setBoatPosition(
          ${gps.latitude},
          ${gps.longitude},
          ${heading},
          ${followGps}
        );

      }

      true;

    `);

  }, [
    gps,
    heading,
    followGps,
    mapReady,
  ]);

  /* ----------------------------------------------------------------------- */
  /* UPDATE ROUTE ON MAP                                                     */
  /* ----------------------------------------------------------------------- */

  useEffect(() => {

    if (!mapReady)
      return;

    if (!route.length) {

      webMapRef.current?.injectJavaScript(`

        if (window.clearRoute) {

          window.clearRoute();

        }

        true;

      `);

      return;

    }

    webMapRef.current?.injectJavaScript(`

      if (window.setRoute) {

        window.setRoute(
          ${JSON.stringify(route)}
        );

      }

      true;

    `);

  }, [
    route,
    mapReady,
  ]);

  /* ----------------------------------------------------------------------- */
  /* FUEL MARKERS                                                             */
  /* ----------------------------------------------------------------------- */

  useEffect(() => {

    if (!mapReady)
      return;

    webMapRef.current?.injectJavaScript(`

      if (window.setFuelStations) {

        window.setFuelStations(
          ${JSON.stringify(
            fuelStations
          )}
        );

      }

      true;

    `);

  }, [
    fuelStations,
    mapReady,
  ]);

  /* ========================================================================= */
  /* STORAGE                                                                   */
  /* ========================================================================= */

  async function loadBoat() {

    try {

      const saved =
        await AsyncStorage.getItem(
          BOAT_STORAGE
        );

      if (!saved)
        return;

      const merged = {
        ...DEFAULT_BOAT,
        ...JSON.parse(
          saved
        ),
      };

      setBoat(
        merged
      );

      setDraftBoat(
        merged
      );

    } catch {

      setBoat(
        DEFAULT_BOAT
      );

      setDraftBoat(
        DEFAULT_BOAT
      );

    }

  }

  async function loadStations() {

    try {

      const saved =
        await AsyncStorage.getItem(
          FUEL_STORAGE
        );

      if (!saved)
        return;

      setFuelStations(
        JSON.parse(
          saved
        )
      );

    } catch {

      setFuelStations(
        []
      );

    }

  }

  async function persistStations(
    stations: FuelStation[]
  ) {

    await AsyncStorage.setItem(
      FUEL_STORAGE,
      JSON.stringify(
        stations
      )
    );

  }

  /* ========================================================================= */
  /* GPS                                                                       */
  /* ========================================================================= */

  function updateGps(
    location:
      Location.LocationObject
  ) {

    const next = {
      latitude:
        location.coords.latitude,

      longitude:
        location.coords.longitude,
    };

    const now =
      Date.now();

    let derivedSpeed =
      location.coords.speed;

    if (
      derivedSpeed === null ||
      derivedSpeed === undefined ||
      derivedSpeed < 0
    ) {

      if (
        lastGpsPosition.current &&
        lastGpsTime.current
      ) {

        const distance =
          distanceMeters(
            lastGpsPosition.current,
            next
          );

        const elapsed =
          (
            now -
            lastGpsTime.current
          ) /
          1000;

        if (
          elapsed > 0
        ) {

          derivedSpeed =
            distance /
            elapsed;

        }

      }

    }

    if (
      Number.isFinite(
        derivedSpeed
      )
    ) {

      const knots =
        Math.max(
          0,
          Number(
            (
              Number(
                derivedSpeed
              ) *
              1.943844
            ).toFixed(1)
          )
        );

      setGpsSpeed(
        knots
      );

      if (
        !testMode
      ) {

        setSpeed(
          knots
        );

        setMaxSpeed(
          maximum =>
            Math.max(
              maximum,
              knots
            )
        );

      }

    }

    if (
      Number.isFinite(
        location.coords.heading
      ) &&
      location.coords.heading >=
        0
    ) {

      setHeading(
        Math.round(
          location.coords.heading
        )
      );

    } else if (
      lastGpsPosition.current
    ) {

      const newBearing =
        bearingDegrees(
          lastGpsPosition.current,
          next
        );

      if (
        distanceMeters(
          lastGpsPosition.current,
          next
        ) > 2
      ) {

        setHeading(
          Math.round(
            newBearing
          )
        );

      }

    }

    setGps(
      next
    );

    setGpsAccuracy(
      location.coords.accuracy ??
        null
    );

    setGpsStatus(
      "fixed"
    );

    lastGpsPosition.current =
      next;

    lastGpsTime.current =
      now;

  }

  async function startGps() {

    try {

      setGpsStatus(
        "searching"
      );

      const provider =
        await Location.getProviderStatusAsync();

      if (
        !provider.locationServicesEnabled
      ) {

        setGpsStatus(
          "off"
        );

        return;

      }

      let permission =
        await Location.getForegroundPermissionsAsync();

      if (
        permission.status !==
        Location.PermissionStatus.GRANTED
      ) {

        permission =
          await Location.requestForegroundPermissionsAsync();

      }

      if (
        permission.status !==
        Location.PermissionStatus.GRANTED
      ) {

        setGpsStatus(
          "denied"
        );

        return;

      }

      const lastKnown =
        await Location.getLastKnownPositionAsync(
          {
            maxAge:120000,
            requiredAccuracy:5000,
          }
        );

      if (
        lastKnown
      ) {

        updateGps(
          lastKnown
        );

      }

      const current =
        await Location.getCurrentPositionAsync(
          {
            accuracy:
              Location.Accuracy.High,
          }
        );

      updateGps(
        current
      );

      if (
        gpsWatch.current
      ) {

        gpsWatch.current.remove();

      }

      gpsWatch.current =
        await Location.watchPositionAsync(
          {

            accuracy:
              Location.Accuracy.High,

            distanceInterval:1,

            timeInterval:1000,

          },

          location => {

            updateGps(
              location
            );

          }

        );

    } catch {

      setGpsStatus(
        "off"
      );

    }

  }

  async function requestGps() {

    try {

      const permission =
        await Location.getForegroundPermissionsAsync();

      if (
        permission.status !==
        Location.PermissionStatus.GRANTED
      ) {

        const requested =
          await Location.requestForegroundPermissionsAsync();

        if (
          requested.status !==
          Location.PermissionStatus.GRANTED
        ) {

          Alert.alert(
            "GPS-TILLATELSE",
            "Sjøkart trenger tilgang til posisjonen din.",
            [
              {
                text:"AVBRYT",
                style:"cancel",
              },
              {
                text:"ÅPNE INNSTILLINGER",
                onPress:() =>
                  Linking.openSettings(),
              },
            ]
          );

          setGpsStatus(
            "denied"
          );

          return;

        }

      }

      await startGps();

      setTimeout(
        () => {

          webMapRef.current?.injectJavaScript(`

            if (window.centerBoat) {

              window.centerBoat();

            }

            true;

          `);

        },
        800
      );

    } catch {

      Alert.alert(
        "GPS",
        "Klarte ikke hente GPS-posisjonen."
      );

    }

  }

  /* ========================================================================= */
  /* MAP                                                                       */
  /* ========================================================================= */

  function handleMapMessage(
    event:
      WebViewMessageEvent
  ) {

    try {

      const message =
        JSON.parse(
          event.nativeEvent.data
        );

      if (
        message.type ===
        "MAP_READY"
      ) {

        setMapReady(
          true
        );

        return;

      }

      if (
        message.type ===
        "MAP_CLICK"
      ) {

        const point = {

          latitude:
            Number(
              message.latitude
            ),

          longitude:
            Number(
              message.longitude
            ),

        };

        createDirectRoute(
          point
        );

        return;

      }

      if (
        message.type ===
        "MAP_LONG_PRESS"
      ) {

        setContextPoint({

          latitude:
            Number(
              message.latitude
            ),

          longitude:
            Number(
              message.longitude
            ),

        });

        setContextOpen(
          true
        );

        return;

      }

      if (
        message.type ===
        "AUTO_ROUTE_RESULT"
      ) {

        const raw =
          Array.isArray(
            message.coordinates
          )
            ? message.coordinates
            : [];

        const converted =
          raw
            .map(
              (
                item:any
              ) => ({

                latitude:
                  Number(
                    item[1]
                  ),

                longitude:
                  Number(
                    item[0]
                  ),

              })
            )
            .filter(
              (
                point:Coordinate
              ) =>
                Number.isFinite(
                  point.latitude
                ) &&
                Number.isFinite(
                  point.longitude
                )
            );

        if (
          converted.length >= 2
        ) {

          setRoute(
            converted
          );

          setRouteTarget(
            converted[
              converted.length - 1
            ]
          );

          setRouteMode(
            "auto"
          );

          setRouteError(
            ""
          );

        } else {

          fallbackRoute(
            contextPoint
          );

        }

        setRouteBusy(
          false
        );

        setContextPoint(
          null
        );

        return;

      }

      if (
        message.type ===
        "AUTO_ROUTE_ERROR"
      ) {

        setRouteBusy(
          false
        );

        fallbackRoute(
          contextPoint
        );

        setContextPoint(
          null
        );

        return;

      }

      if (
        message.type ===
        "FUEL_CLICK"
      ) {

        const found =
          fuelStations.find(
            station =>
              station.id ===
              message.id
          );

        if (
          found
        ) {

          openFuelEditor(
            found
          );

        }

      }

    } catch {

      // Ignorer ukjente meldinger.

    }

  }

  /* ========================================================================= */
  /* ROUTING                                                                   */
  /* ========================================================================= */

  function createDirectRoute(
    target:
      Coordinate
  ) {

    if (!gps) {

      Alert.alert(
        "GPS MANGLER",
        "Få først GPS-fix før du lager en rute."
      );

      requestGps();

      return;

    }

    setRoute([
      gps,
      target,
    ]);

    setRouteTarget(
      target
    );

    setRouteMode(
      "direct"
    );

    setRouteError(
      ""
    );

  }

  function fallbackRoute(
    target:
      Coordinate | null
  ) {

    if (
      !gps ||
      !target
    ) {

      setRouteBusy(
        false
      );

      return;

    }

    const points:Coordinate[] = [];

    const numberOfSteps =
      10;

    for (
      let i = 0;
      i <= numberOfSteps;
      i++
    ) {

      const t =
        i /
        numberOfSteps;

      points.push({

        latitude:
          gps.latitude +
          (
            target.latitude -
            gps.latitude
          ) *
          t,

        longitude:
          gps.longitude +
          (
            target.longitude -
            gps.longitude
          ) *
          t,

      });

    }

    setRoute(
      points
    );

    setRouteTarget(
      target
    );

    setRouteMode(
      "fallback"
    );

    setRouteError(
      "Auto-rute kunne ikke lastes. Direkte GPS-fallback er brukt."
    );

    setRouteBusy(
      false
    );

  }

  function generateAutoRoute() {

    if (
      !contextPoint
    ) {

      return;

    }

    if (
      !gps
    ) {

      setContextOpen(
        false
      );

      Alert.alert(
        "GPS MANGLER",
        "Appen trenger først posisjonen din."
      );

      requestGps();

      return;

    }

    setRouteBusy(
      true
    );

    setContextOpen(
      false
    );

    setRouteError(
      ""
    );

    const target =
      contextPoint;

    webMapRef.current?.injectJavaScript(`

      if (window.generateAutoRoute) {

        window.generateAutoRoute(
          ${gps.latitude},
          ${gps.longitude},
          ${target.latitude},
          ${target.longitude}
        );

      }

      true;

    `);

  }

  function clearRoute() {

    setRoute(
      []
    );

    setRouteTarget(
      null
    );

    setRouteMode(
      "none"
    );

    setRouteError(
      ""
    );

  }

  /* ========================================================================= */
  /* FUEL STATION                                                             */
  /* ========================================================================= */

  function newFuelStation() {

    if (
      !contextPoint
    ) {

      return;

    }

    setFuelDraft({

      name:"",

      latitude:
        contextPoint.latitude,

      longitude:
        contextPoint.longitude,

      petrolPrice:"",

      dieselPrice:"",

      marinePrice:"",

    });

    setEditingFuelId(
      null
    );

    setContextOpen(
      false
    );

    setFuelModal(
      true
    );

  }

  function openFuelEditor(
    station:
      FuelStation
  ) {

    setFuelDraft({

      name:
        station.name,

      latitude:
        station.latitude,

      longitude:
        station.longitude,

      petrolPrice:
        station.petrolPrice,

      dieselPrice:
        station.dieselPrice,

      marinePrice:
        station.marinePrice,

    });

    setEditingFuelId(
      station.id
    );

    setFuelModal(
      true
    );

  }

  async function saveFuelStation() {

    if (
      !fuelDraft.name.trim()
    ) {

      Alert.alert(
        "MANGLER NAVN",
        "Skriv inn navnet på bensinstasjonen."
      );

      return;

    }

    let updated:FuelStation[];

    if (
      editingFuelId
    ) {

      updated =
        fuelStations.map(
          station =>
            station.id ===
            editingFuelId
              ? {
                  ...station,
                  ...fuelDraft,
                  name:
                    fuelDraft.name.trim(),
                  updatedAt:
                    Date.now(),
                }
              : station
        );

    } else {

      updated = [

        ...fuelStations,

        {
          id:
            `${Date.now()}-${Math.random()
              .toString(36)
              .slice(2,8)}`,

          ...fuelDraft,

          name:
            fuelDraft.name.trim(),

          updatedAt:
            Date.now(),
        },

      ];

    }

    setFuelStations(
      updated
    );

    await persistStations(
      updated
    );

    setFuelModal(
      false
    );

  }

  async function deleteFuelStation() {

    if (
      !editingFuelId
    ) {

      return;

    }

    const updated =
      fuelStations.filter(
        station =>
          station.id !==
          editingFuelId
      );

    setFuelStations(
      updated
    );

    await persistStations(
      updated
    );

    setFuelModal(
      false
    );

  }

  /* ========================================================================= */
  /* BOAT                                                                      */
  /* ========================================================================= */

  function updateBoat(
    key:
      keyof BoatProfile,
    value:string
  ) {

    setDraftBoat(
      current => ({

        ...current,

        [key]:
          value,

      })
    );

  }

  async function saveBoat() {

    await AsyncStorage.setItem(
      BOAT_STORAGE,
      JSON.stringify(
        draftBoat
      )
    );

    setBoat(
      draftBoat
    );

    Alert.alert(
      "LAGRET",
      "Båtprofilen er lagret."
    );

  }

  /* ========================================================================= */
  /* SPOTIFY                                                                   */
  /* ========================================================================= */

  async function openSpotify() {

    try {

      await Linking.openURL(
        "spotify:"
      );

      return;

    } catch {

      // Spotify finnes ikke.

    }

    try {

      await Linking.openURL(
        "https://apps.apple.com/no/app/spotify-music-and-podcasts/id324684580"
      );

    } catch {

      Alert.alert(
        "SPOTIFY",
        "Klarte ikke åpne Spotify."
      );

    }

  }

  /* ========================================================================= */
  /* RESET                                                                      */
  /* ========================================================================= */

  function resetTrip() {

    setTripDistance(
      0
    );

    setTripSeconds(
      0
    );

    setMaxSpeed(
      0
    );

    Alert.alert(
      "TUR NULLSTILT",
      "Turdata er nullstilt."
    );

  }

  /* ========================================================================= */
  /* HOME                                                                      */
  /* ========================================================================= */

  function renderHome() {

    return (

      <View
        style={
          styles.home
        }
      >

        {/* FULL SCREEN MAP */}

        <WebView

          ref={
            webMapRef
          }

          source={{
            html:
              MAP_HTML,
          }}

          originWhitelist={[
            "*",
          ]}

          javaScriptEnabled

          domStorageEnabled

          mixedContentMode="always"

          setSupportMultipleWindows={
            false
          }

          onMessage={
            handleMapMessage
          }

          style={
            StyleSheet.absoluteFillObject
          }

        />

        {/* BRAND */}

        <View
          style={
            styles.brandOverlay
          }
        >

          <View
            style={
              styles.brandGlass
            }
          >

            <View
              style={
                styles.logoBox
              }
            >

              <Text
                style={
                  styles.logoText
                }
              >
                N
              </Text>

            </View>

            <View>

              <Text
                style={
                  styles.brandTiny
                }
              >
                SJØKART
              </Text>

              <Text
                style={
                  styles.brandName
                }
              >
                {boat.boatName}
              </Text>

            </View>

          </View>

        </View>

        {/* TOP RIGHT */}

        <View
          style={
            styles.topActions
          }
        >

          <Pressable
            style={
              styles.glassButton
            }
            onPress={
              requestGps
            }
          >

            <View
              style={[
                styles.gpsDot,
                gpsStatus ===
                  "fixed" &&
                  styles.gpsDotGood,
              ]}
            />

            <Text
              style={
                styles.glassButtonText
              }
            >
              GPS
            </Text>

          </Pressable>

          <Pressable
            style={
              styles.glassButton
            }
            onPress={
              openSpotify
            }
          >

            <Text
              style={
                styles.spotifyIcon
              }
            >
              ♫
            </Text>

          </Pressable>

        </View>

        {/* ROUTE HUD */}

        {route.length > 0 && (

          <View
            style={
              styles.routeHud
            }
          >

            <View>

              <Text
                style={
                  styles.routeHudEyebrow
                }
              >
                {routeMode ===
                "auto"
                  ? "AUTO-RUTE"
                  : routeMode ===
                    "fallback"
                  ? "RUTE-FALLBACK"
                  : "DIREKTE KURS"}
              </Text>

              <Text
                style={
                  styles.routeHudDistance
                }
              >
                {formatNm(
                  routeRemaining
                )}{" "}
                NM
              </Text>

            </View>

            <View
              style={
                styles.routeHudRight
              }
            >

              <Text
                style={
                  styles.routeHudCourse
                }
              >
                {formatBearing(
                  routeCourse
                )}
              </Text>

              <Text
                style={
                  styles.routeHudEta
                }
              >
                {Number.isFinite(
                  routeEtaSeconds
                )
                  ? `ETA ${formatDuration(
                      routeEtaSeconds
                    )}`
                  : "START MOTOR"}
              </Text>

            </View>

            <Pressable
              style={
                styles.routeHudClose
              }
              onPress={
                clearRoute
              }
            >

              <Text
                style={
                  styles.routeHudCloseText
                }
              >
                ×
              </Text>

            </Pressable>

          </View>

        )}

        {/* ROUTE PROGRESS */}

        {route.length > 0 && (

          <View
            style={
              styles.routeProgress
            }
          >

            <View
              style={
                styles.routeProgressTrack
              }
            >

              <View
                style={[
                  styles.routeProgressFill,
                  {
                    width:
                      `${routeProgress * 100}%`,
                  },
                ]}
              />

            </View>

          </View>

        )}

        {/* INSTRUMENTS */}

        <View
          style={
            isWide
              ? styles.instrumentRowWide
              : styles.instrumentRow
          }
        >

          <Tachometer
            rpm={
              rpm
            }
            maxRpm={
              5200
            }
          />

          <View
            style={
              styles.digitalSpeed
            }
          >

            <Text
              style={
                styles.digitalSpeedLabel
              }
            >
              SPEED
            </Text>

            <View
              style={
                styles.digitalSpeedRow
              }
            >

              <Text
                style={
                  styles.digitalSpeedNumber
                }
              >
                {speed.toFixed(1)}
              </Text>

              <Text
                style={
                  styles.digitalSpeedUnit
                }
              >
                KN
              </Text>

            </View>

            <Text
              style={
                styles.digitalSpeedSub
              }
            >
              MAX{" "}
              {maxSpeed.toFixed(1)}
            </Text>

          </View>

          <View
            style={
              styles.miniHudColumn
            }
          >

            <HudMetric
              label="DYBDE"
              value={`${depth.toFixed(
                1
              )} M`}
            />

            <HudMetric
              label="FUEL"
              value={`${fuel.toFixed(
                0
              )}%`}
            />

            <HudMetric
              label="TEMP"
              value={`${engineTemp}°`}
            />

          </View>

        </View>

        {/* MAP CONTROLS */}

        <View
          style={
            styles.mapControls
          }
        >

          <Pressable
            style={
              styles.mapRound
            }
            onPress={
              requestGps
            }
          >

            <Text
              style={
                styles.mapRoundText
              }
            >
              ⌖
            </Text>

          </Pressable>

          <Pressable
            style={[
              styles.mapRound,
              followGps &&
                styles.mapRoundActive,
            ]}
            onPress={() =>
              setFollowGps(
                current =>
                  !current
              )
            }
          >

            <Text
              style={
                styles.mapRoundText
              }
            >
              ◉
            </Text>

          </Pressable>

        </View>

        {/* INSTRUCTION */}

        <View
          style={
            styles.gestureHint
          }
        >

          <Text
            style={
              styles.gestureHintText
            }
          >
            TRYKK = KURS
            {"  "}
            •
            {"  "}
            HOLD INNE = AUTO-RUTE / BENSIN
          </Text>

        </View>

        {/* CARPLAY DOCK */}

        <ScrollView

          horizontal

          showsHorizontalScrollIndicator={
            false
          }

          style={
            styles.dock
          }

          contentContainerStyle={
            styles.dockContent
          }

        >

          <CarApp
            icon="⌖"
            title="NAV"
            subtitle="Sjøkart"
            active
            onPress={() =>
              setScreen(
                "home"
              )
            }
          />

          <CarApp
            icon="➤"
            title="RUTER"
            subtitle={
              route.length
                ? "Aktiv"
                : "Planlegg"
            }
            onPress={() =>
              setScreen(
                "routes"
              )
            }
          />

          <CarApp
            icon="⛵"
            title="BÅT"
            subtitle={
              boat.model
            }
            onPress={() =>
              setScreen(
                "boat"
              )
            }
          />

          <CarApp
            icon="◉"
            title="MOTOR"
            subtitle={
              boat.engineModel
            }
            onPress={() =>
              setScreen(
                "engine"
              )
            }
          />

          <CarApp
            icon="⛽"
            title="FUEL"
            subtitle={`${fuel.toFixed(
              0
            )}%`}
            onPress={() =>
              setScreen(
                "fuel"
              )
            }
          />

          <CarApp
            icon="▤"
            title="DATA"
            subtitle="Tur"
            onPress={() =>
              setScreen(
                "data"
              )
            }
          />

          <CarApp
            icon="♫"
            title="SPOTIFY"
            subtitle="Musikk"
            onPress={
              openSpotify
            }
          />

          <CarApp
            icon="⚙"
            title="SETTINGS"
            subtitle="System"
            onPress={() =>
              setScreen(
                "settings"
              )
            }
          />

        </ScrollView>

      </View>

    );

  }

  /* ========================================================================= */
  /* ROUTES                                                                    */
  /* ========================================================================= */

  function renderRoutes() {

    return (

      <ScreenShell
        title="RUTER"
        subtitle="NAVIGASJON"
        onBack={() =>
          setScreen(
            "home"
          )
        }
      >

        {route.length > 0 ? (

          <>

            <View
              style={
                styles.routeBig
              }
            >

              <Text
                style={
                  styles.routeBigType
                }
              >
                {routeMode ===
                "auto"
                  ? "AUTO-RUTE"
                  : routeMode ===
                    "fallback"
                  ? "FALLBACK-RUTE"
                  : "DIREKTE KURS"}
              </Text>

              <Text
                style={
                  styles.routeBigNumber
                }
              >
                {formatNm(
                  routeRemaining
                )}{" "}
                NM
              </Text>

              <Text
                style={
                  styles.routeBigSub
                }
              >
                gjenstår
              </Text>

            </View>

            <View
              style={
                styles.metricGrid
              }
            >

              <InfoMetric
                label="KURS"
                value={formatBearing(
                  routeCourse
                )}
              />

              <InfoMetric
                label="ETA"
                value={
                  Number.isFinite(
                    routeEtaSeconds
                  )
                    ? formatDuration(
                        routeEtaSeconds
                      )
                    : "--"
                }
              />

              <InfoMetric
                label="FART"
                value={`${speed.toFixed(
                  1
                )} KN`}
              />

              <InfoMetric
                label="PROGRESS"
                value={`${Math.round(
                  routeProgress *
                    100
                )}%`}
              />

            </View>

            {routeError ? (

              <View
                style={
                  styles.warningPanel
                }
              >

                <Text
                  style={
                    styles.warningTitle
                  }
                >
                  RUTEMELDING
                </Text>

                <Text
                  style={
                    styles.warningText
                  }
                >
                  {routeError}
                </Text>

              </View>

            ) : null}

            <Pressable
              style={
                styles.primaryLarge
              }
              onPress={() =>
                setScreen(
                  "home"
                )
              }
            >

              <Text
                style={
                  styles.primaryLargeText
                }
              >
                VIS RUTE
              </Text>

            </Pressable>

            <Pressable
              style={
                styles.secondaryLarge
              }
              onPress={
                clearRoute
              }
            >

              <Text
                style={
                  styles.secondaryLargeText
                }
              >
                AVSLUTT RUTE
              </Text>

            </Pressable>

          </>

        ) : (

          <View
            style={
              styles.emptyRoute
            }
          >

            <Text
              style={
                styles.emptyRouteIcon
              }
            >
              ➤
            </Text>

            <Text
              style={
                styles.emptyRouteTitle
              }
            >
              INGEN AKTIV RUTE
            </Text>

            <Text
              style={
                styles.emptyRouteText
              }
            >
              Åpne kartet og hold fingeren
              inne på stedet du vil kjøre til.
              Der får du GENERER AUTO-RUTE,
              DIREKTE KURS og
              BENSINSTASJON.
            </Text>

            <Pressable
              style={
                styles.primaryLarge
              }
              onPress={() =>
                setScreen(
                  "home"
                )
              }
            >

              <Text
                style={
                  styles.primaryLargeText
                }
              >
                ÅPNE KART
              </Text>

            </Pressable>

          </View>

        )}

      </ScreenShell>

    );

  }

  /* ========================================================================= */
  /* BOAT                                                                      */
  /* ========================================================================= */

  function renderBoat() {

    return (

      <ScreenShell
        title="BÅT"
        subtitle="PROFIL"
        onBack={() =>
          setScreen(
            "home"
          )
        }
      >

        <View
          style={
            styles.profileHero
          }
        >

          <View
            style={
              styles.profileLogo
            }
          >

            <Text
              style={
                styles.profileLogoText
              }
            >
              N
            </Text>

          </View>

          <View
            style={{
              flex:1,
            }}
          >

            <Text
              style={
                styles.profileBrand
              }
            >
              {draftBoat.manufacturer}
            </Text>

            <Text
              style={
                styles.profileModel
              }
            >
              {draftBoat.model}
            </Text>

            <Text
              style={
                styles.profileSub
              }
            >
              {draftBoat.year} •{" "}
              {draftBoat.length} m •{" "}
              {draftBoat.beam} m
            </Text>

          </View>

        </View>

        <SectionTitle
          title="BÅT"
          subtitle="Grunnleggende"
        />

        <Input
          label="BÅTNAVN"
          value={
            draftBoat.boatName
          }
          onChangeText={value =>
            updateBoat(
              "boatName",
              value
            )
          }
        />

        <Input
          label="PRODUSENT"
          value={
            draftBoat.manufacturer
          }
          onChangeText={value =>
            updateBoat(
              "manufacturer",
              value
            )
          }
        />

        <Input
          label="MODELL"
          value={
            draftBoat.model
          }
          onChangeText={value =>
            updateBoat(
              "model",
              value
            )
          }
        />

        <View
          style={
            styles.formRow
          }
        >

          <Input
            label="ÅR"
            value={
              draftBoat.year
            }
            half
            keyboardType="numeric"
            onChangeText={value =>
              updateBoat(
                "year",
                value
              )
            }
          />

          <Input
            label="LENGDE"
            value={
              draftBoat.length
            }
            half
            keyboardType="decimal-pad"
            onChangeText={value =>
              updateBoat(
                "length",
                value
              )
            }
          />

        </View>

        <View
          style={
            styles.formRow
          }
        >

          <Input
            label="BREDDE"
            value={
              draftBoat.beam
            }
            half
            keyboardType="decimal-pad"
            onChangeText={value =>
              updateBoat(
                "beam",
                value
              )
            }
          />

          <Input
            label="DYPGANG"
            value={
              draftBoat.draft
            }
            half
            keyboardType="decimal-pad"
            onChangeText={value =>
              updateBoat(
                "draft",
                value
              )
            }
          />

        </View>

        <SectionTitle
          title="MOTOR"
          subtitle="Motorinformasjon"
        />

        <Input
          label="MERKE"
          value={
            draftBoat.engineMake
          }
          onChangeText={value =>
            updateBoat(
              "engineMake",
              value
            )
          }
        />

        <Input
          label="MODELL"
          value={
            draftBoat.engineModel
          }
          onChangeText={value =>
            updateBoat(
              "engineModel",
              value
            )
          }
        />

        <View
          style={
            styles.formRow
          }
        >

          <Input
            label="HK"
            value={
              draftBoat.horsepower
            }
            half
            keyboardType="numeric"
            onChangeText={value =>
              updateBoat(
                "horsepower",
                value
              )
            }
          />

          <Input
            label="VOLUM L"
            value={
              draftBoat.displacement
            }
            half
            keyboardType="decimal-pad"
            onChangeText={value =>
              updateBoat(
                "displacement",
                value
              )
            }
          />

        </View>

        <Input
          label="TANK L"
          value={
            draftBoat.tankCapacity
          }
          keyboardType="decimal-pad"
          onChangeText={value =>
            updateBoat(
              "tankCapacity",
              value
            )
          }
        />

        <Input
          label="PROPELL"
          value={
            draftBoat.propeller
          }
          onChangeText={value =>
            updateBoat(
              "propeller",
              value
            )
          }
        />

        <Pressable
          style={
            styles.primaryLarge
          }
          onPress={
            saveBoat
          }
        >

          <Text
            style={
              styles.primaryLargeText
            }
          >
            LAGRE BÅTPROFIL
          </Text>

        </Pressable>

      </ScreenShell>

    );

  }

  /* ========================================================================= */
  /* ENGINE                                                                    */
  /* ========================================================================= */

  function renderEngine() {

    return (

      <ScreenShell
        title="MOTOR"
        subtitle={
          boat.engineModel
        }
        onBack={() =>
          setScreen(
            "home"
          )
        }
      >

        <View
          style={
            styles.engineHero
          }
        >

          <View>

            <Text
              style={
                styles.engineBrand
              }
            >
              {boat.engineMake.toUpperCase()}
            </Text>

            <Text
              style={
                styles.engineHp
              }
            >
              {boat.horsepower} HK
            </Text>

            <Text
              style={
                styles.engineModelText
              }
            >
              {boat.engineModel}
            </Text>

          </View>

          <View
            style={
              styles.livePill
            }
          >

            <View
              style={
                styles.liveDot
              }
            />

            <Text
              style={
                styles.livePillText
              }
            >
              {testMode
                ? "DEMO"
                : "GPS LIVE"}
            </Text>

          </View>

        </View>

        <View
          style={
            styles.metricGrid
          }
        >

          <InfoMetric
            label="RPM"
            value={`${rpm}`}
          />

          <InfoMetric
            label="TEMP"
            value={`${engineTemp}°C`}
          />

          <InfoMetric
            label="BATTERI"
            value={`${battery.toFixed(
              2
            )} V`}
          />

          <InfoMetric
            label="TRIM"
            value={`${trim.toFixed(
              1
            )}°`}
          />

        </View>

        <SectionTitle
          title="TESTDATA"
          subtitle="Slå av når ekte motordata kobles til"
        />

        <SettingRow
          title="Simuler motorverdier"
          subtitle={
            testMode
              ? "Motorinstrumentene beveger seg automatisk."
              : "Testdata er av."
          }
          value={
            <Switch
              value={
                testMode
              }
              onValueChange={
                setTestMode
              }
            />
          }
        />

      </ScreenShell>

    );

  }

  /* ========================================================================= */
  /* FUEL                                                                      */
  /* ========================================================================= */

  function renderFuel() {

    return (

      <ScreenShell
        title="FUEL"
        subtitle="BENSIN & STASJONER"
        onBack={() =>
          setScreen(
            "home"
          )
        }
      >

        <View
          style={
            styles.fuelHero
          }
        >

          <Text
            style={
              styles.fuelHeroLabel
            }
          >
            AKTUELL TANK
          </Text>

          <Text
            style={
              styles.fuelHeroNumber
            }
          >
            {fuel.toFixed(0)}%
          </Text>

          <Text
            style={
              styles.fuelHeroLiters
            }
          >
            {(
              (Number(
                boat.tankCapacity
              ) || 0) *
              fuel /
              100
            ).toFixed(1)}{" "}
            L igjen
          </Text>

          <View
            style={
              styles.fuelBar
            }
          >

            <View
              style={[
                styles.fuelBarFill,
                {
                  width:
                    `${fuel}%`,
                },
              ]}
            />

          </View>

        </View>

        <SectionTitle
          title="STASJONER"
          subtitle={`${fuelStations.length} lagret`}
        />

        {fuelStations.map(
          station => (

            <Pressable
              key={
                station.id
              }
              style={
                styles.stationRow
              }
              onPress={() =>
                openFuelEditor(
                  station
                )
              }
            >

              <View
                style={
                  styles.stationIcon
                }
              >

                <Text>
                  ⛽
                </Text>

              </View>

              <View
                style={
                  styles.stationCenter
                }
              >

                <Text
                  style={
                    styles.stationName
                  }
                >
                  {station.name}
                </Text>

                <Text
                  style={
                    styles.stationCoordinates
                  }
                >
                  {station.latitude.toFixed(
                    5
                  )}
                  {"  "}
                  {station.longitude.toFixed(
                    5
                  )}
                </Text>

              </View>

              <View
                style={
                  styles.stationPrices
                }
              >

                {station.marinePrice ? (

                  <Text
                    style={
                      styles.stationMarine
                    }
                  >
                    M{" "}
                    {
                      station.marinePrice
                    }
                  </Text>

                ) : null}

                {station.petrolPrice ? (

                  <Text
                    style={
                      styles.stationPrice
                    }
                  >
                    95{" "}
                    {
                      station.petrolPrice
                    }
                  </Text>

                ) : null}

              </View>

            </Pressable>

          )
        )}

        <View
          style={
            styles.infoPanel
          }
        >

          <Text
            style={
              styles.infoPanelTitle
            }
          >
            VIL DU LEGGE TIL EN?
          </Text>

          <Text
            style={
              styles.infoPanelText
            }
          >
            Hold fingeren inne på kartet der
            stasjonen ligger. Velg
            LEGG TIL BENSINSTASJON.
          </Text>

        </View>

      </ScreenShell>

    );

  }

  /* ========================================================================= */
  /* DATA                                                                      */
  /* ========================================================================= */

  function renderData() {

    const avgSpeed =
      tripSeconds > 0
        ? (
            tripDistance /
            1852 /
            (tripSeconds / 3600)
          )
        : 0;

    return (

      <ScreenShell
        title="DATA"
        subtitle="TURINFORMASJON"
        onBack={() =>
          setScreen(
            "home"
          )
        }
      >

        <View
          style={
            styles.dataHero
          }
        >

          <Text
            style={
              styles.dataHeroLabel
            }
          >
            AKTIV TUR
          </Text>

          <Text
            style={
              styles.dataHeroNumber
            }
          >
            {(
              tripDistance /
              1852
            ).toFixed(2)}{" "}
            NM
          </Text>

          <Text
            style={
              styles.dataHeroSub
            }
          >
            {formatDuration(
              tripSeconds
            )}
          </Text>

        </View>

        <View
          style={
            styles.metricGrid
          }
        >

          <InfoMetric
            label="FART"
            value={`${speed.toFixed(
              1
            )} KN`}
          />

          <InfoMetric
            label="SNITT"
            value={`${avgSpeed.toFixed(
              1
            )} KN`}
          />

          <InfoMetric
            label="MAX"
            value={`${maxSpeed.toFixed(
              1
            )} KN`}
          />

          <InfoMetric
            label="RPM"
            value={`${rpm}`}
          />

        </View>

        <InfoRow
          label="Dybde"
          value={`${depth.toFixed(
            1
          )} M`}
        />

        <InfoRow
          label="Heading"
          value={formatBearing(
            heading
          )}
        />

        <InfoRow
          label="GPS speed"
          value={`${gpsSpeed.toFixed(
            1
          )} KN`}
        />

        <InfoRow
          label="GPS nøyaktighet"
          value={
            gpsAccuracy !== null
              ? `± ${Math.round(
                  gpsAccuracy
                )} m`
              : "--"
          }
        />

        <InfoRow
          label="Drivstoff"
          value={`${fuel.toFixed(
            0
          )}%`}
        />

        <Pressable
          style={
            styles.dangerLarge
          }
          onPress={
            resetTrip
          }
        >

          <Text
            style={
              styles.dangerLargeText
            }
          >
            NULLSTILL TUR
          </Text>

        </Pressable>

      </ScreenShell>

    );

  }

  /* ========================================================================= */
  /* SETTINGS                                                                  */
  /* ========================================================================= */

  function renderSettings() {

    return (

      <ScreenShell
        title="SETTINGS"
        subtitle="SYSTEM"
        onBack={() =>
          setScreen(
            "home"
          )
        }
      >

        <SectionTitle
          title="GPS"
          subtitle="Kartbevegelse"
        />

        <SettingRow
          title="Følg GPS"
          subtitle={
            followGps
              ? "Kartet følger båten automatisk."
              : "Kartet er fritt."
          }
          value={
            <Switch
              value={
                followGps
              }
              onValueChange={
                setFollowGps
              }
            />
          }
        />

        <SectionTitle
          title="MUSIKK"
          subtitle="Spotify"
        />

        <Pressable
          style={
            styles.spotifyPanel
          }
          onPress={
            openSpotify
          }
        >

          <View
            style={
              styles.spotifyPanelIcon
            }
          >

            <Text
              style={
                styles.spotifyPanelIconText
              }
            >
              ♫
            </Text>

          </View>

          <View
            style={{
              flex:1,
            }}
          >

            <Text
              style={
                styles.spotifyPanelTitle
              }
            >
              SPOTIFY
            </Text>

            <Text
              style={
                styles.spotifyPanelSub
              }
            >
              Åpne Spotify
            </Text>

          </View>

          <Text
            style={
              styles.spotifyArrow
            }
          >
            ›
          </Text>

        </Pressable>

        <SectionTitle
          title="TEST"
          subtitle="Utviklingsfunksjoner"
        />

        <SettingRow
          title="Testdata"
          subtitle={
            testMode
              ? "Instrumentene simulerer verdier."
              : "Testdata er av."
          }
          value={
            <Switch
              value={
                testMode
              }
              onValueChange={
                setTestMode
              }
            />
          }
        />

        <View
          style={
            styles.infoPanel
          }
        >

          <Text
            style={
              styles.infoPanelTitle
            }
          >
            KARTSYSTEM
          </Text>

          <Text
            style={
              styles.infoPanelText
            }
          >
            Kartverket sjøkart • live iPhone-GPS
            • sjøruting i kartets nettmiljø.
          </Text>

          <Text
            style={
              styles.aboutWarning
            }
          >
            IKKE SERTIFISERT
            NAVIGASJONSUTSTYR
          </Text>

        </View>

      </ScreenShell>

    );

  }

  /* ========================================================================= */
  /* SCREEN                                                                     */
  /* ========================================================================= */

  function renderCurrentScreen() {

    switch (
      screen
    ) {

      case "routes":
        return renderRoutes();

      case "boat":
        return renderBoat();

      case "engine":
        return renderEngine();

      case "fuel":
        return renderFuel();

      case "data":
        return renderData();

      case "settings":
        return renderSettings();

      default:
        return renderHome();

    }

  }

  /* ========================================================================= */
  /* LONG PRESS MENU                                                          */
  /* ========================================================================= */

  const longPressModal =
    contextOpen &&
    contextPoint ? (

      <Modal
        visible
        transparent
        animationType="slide"
        onRequestClose={() =>
          setContextOpen(
            false
          )
        }
      >

        <Pressable
          style={
            styles.modalBackdrop
          }
          onPress={() =>
            setContextOpen(
              false
            )
          }
        >

          <Pressable
            style={
              styles.actionSheet
            }
            onPress={event =>
              event.stopPropagation()
            }
          >

            <View
              style={
                styles.sheetHandle
              }
            />

            <Text
              style={
                styles.sheetEyebrow
              }
            >
              KARTPUNKT
            </Text>

            <Text
              style={
                styles.sheetTitle
              }
            >
              Hva vil du gjøre?
            </Text>

            <Text
              style={
                styles.sheetCoordinates
              }
            >
              {contextPoint.latitude.toFixed(
                5
              )}
              {"  "}
              {contextPoint.longitude.toFixed(
                5
              )}
            </Text>

            <Pressable
              style={
                styles.sheetPrimary
              }
              onPress={
                generateAutoRoute
              }
            >

              <Text
                style={
                  styles.sheetPrimaryIcon
                }
              >
                ➤
              </Text>

              <View>
                <Text
                  style={
                    styles.sheetPrimaryTitle
                  }
                >
                  {routeBusy
                    ? "BEREGNER..."
                    : "GENERER AUTO-RUTE"}
                </Text>

                <Text
                  style={
                    styles.sheetPrimarySub
                  }
                >
                  Maritim ruting
                </Text>
              </View>

            </Pressable>

            <Pressable
              style={
                styles.sheetButton
              }
              onPress={() => {

                if (
                  contextPoint
                ) {

                  createDirectRoute(
                    contextPoint
                  );

                }

                setContextOpen(
                  false
                );

              }}
            >

              <Text
                style={
                  styles.sheetIcon
                }
              >
                ／
              </Text>

              <View>

                <Text
                  style={
                    styles.sheetButtonTitle
                  }
                >
                  DIREKTE KURS
                </Text>

                <Text
                  style={
                    styles.sheetButtonSub
                  }
                >
                  Rett til punktet
                </Text>

              </View>

            </Pressable>

            <Pressable
              style={
                styles.sheetButton
              }
              onPress={
                newFuelStation
              }
            >

              <Text
                style={
                  styles.sheetIcon
                }
              >
                ⛽
              </Text>

              <View>

                <Text
                  style={
                    styles.sheetButtonTitle
                  }
                >
                  LEGG TIL BENSINSTASJON
                </Text>

                <Text
                  style={
                    styles.sheetButtonSub
                  }
                >
                  Navn + priser
                </Text>

              </View>

            </Pressable>

            <Pressable
              style={
                styles.sheetCancel
              }
              onPress={() =>
                setContextOpen(
                  false
                )
              }
            >

              <Text
                style={
                  styles.sheetCancelText
                }
              >
                AVBRYT
              </Text>

            </Pressable>

          </Pressable>

        </Pressable>

      </Modal>

    ) : null;

  /* ========================================================================= */
  /* FUEL MODAL                                                               */
  /* ========================================================================= */

  const fuelEditorModal =
    fuelModal ? (

      <Modal
        visible
        transparent
        animationType="slide"
        onRequestClose={() =>
          setFuelModal(
            false
          )
        }
      >

        <View
          style={
            styles.formModalBackdrop
          }
        >

          <ScrollView
            contentContainerStyle={
              styles.formModalScroll
            }
            keyboardShouldPersistTaps="handled"
          >

            <View
              style={
                styles.formModal
              }
            >

              <View
                style={
                  styles.sheetHandle
                }
              />

              <Text
                style={
                  styles.sheetEyebrow
                }
              >
                BENSINSTASJON
              </Text>

              <Text
                style={
                  styles.sheetTitle
                }
              >
                {editingFuelId
                  ? "Rediger"
                  : "Legg til"}
              </Text>

              <Input
                label="NAVN"
                value={
                  fuelDraft.name
                }
                onChangeText={
                  value =>
                    setFuelDraft(
                      current => ({
                        ...current,
                        name:value,
                      })
                    )
                }
              />

              <Input
                label="95 / BENSIN"
                value={
                  fuelDraft.petrolPrice
                }
                keyboardType="decimal-pad"
                onChangeText={
                  value =>
                    setFuelDraft(
                      current => ({
                        ...current,
                        petrolPrice:value,
                      })
                    )
                }
              />

              <Input
                label="DIESEL"
                value={
                  fuelDraft.dieselPrice
                }
                keyboardType="decimal-pad"
                onChangeText={
                  value =>
                    setFuelDraft(
                      current => ({
                        ...current,
                        dieselPrice:value,
                      })
                    )
                }
              />

              <Input
                label="MARINE"
                value={
                  fuelDraft.marinePrice
                }
                keyboardType="decimal-pad"
                onChangeText={
                  value =>
                    setFuelDraft(
                      current => ({
                        ...current,
                        marinePrice:value,
                      })
                    )
                }
              />

              <InfoRow
                label="BREDDEGRAD"
                value={fuelDraft.latitude.toFixed(
                  6
                )}
              />

              <InfoRow
                label="LENGDEGRAD"
                value={fuelDraft.longitude.toFixed(
                  6
                )}
              />

              <Pressable
                style={
                  styles.primaryLarge
                }
                onPress={
                  saveFuelStation
                }
              >

                <Text
                  style={
                    styles.primaryLargeText
                  }
                >
                  LAGRE
                </Text>

              </Pressable>

              {editingFuelId ? (

                <Pressable
                  style={
                    styles.dangerLarge
                  }
                  onPress={
                    deleteFuelStation
                  }
                >

                  <Text
                    style={
                      styles.dangerLargeText
                    }
                  >
                    SLETT STASJON
                  </Text>

                </Pressable>

              ) : null}

              <Pressable
                style={
                  styles.secondaryLarge
                }
                onPress={() =>
                  setFuelModal(
                    false
                  )
                }
              >

                <Text
                  style={
                    styles.secondaryLargeText
                  }
                >
                  AVBRYT
                </Text>

              </Pressable>

            </View>

          </ScrollView>

        </View>

      </Modal>

    ) : null;

  return (

    <SafeAreaView
      style={
        styles.safe
      }
    >

      <StatusBar
        barStyle="light-content"
        backgroundColor="#06111A"
      />

      {renderCurrentScreen()}

      {longPressModal}

      {fuelEditorModal}

    </SafeAreaView>

  );

}

/* ========================================================================= */
/* COMPONENTS                                                                */
/* ========================================================================= */

function ScreenShell({
  title,
  subtitle,
  onBack,
  children,
}: {
  title:string;
  subtitle:string;
  onBack:() => void;
  children:React.ReactNode;
}) {

  return (

    <View
      style={
        styles.fullScreen
      }
    >

      <View
        style={
          styles.topBar
        }
      >

        <Pressable
          style={
            styles.backButton
          }
          onPress={
            onBack
          }
        >

          <Text
            style={
              styles.backText
            }
          >
            ‹
          </Text>

        </Pressable>

        <View>

          <Text
            style={
              styles.topBarSubtitle
            }
          >
            {subtitle}
          </Text>

          <Text
            style={
              styles.topBarTitle
            }
          >
            {title}
          </Text>

        </View>

      </View>

      <ScrollView
        style={
          styles.scroll
        }
        contentContainerStyle={
          styles.scrollContent
        }
        showsVerticalScrollIndicator={
          false
        }
        keyboardShouldPersistTaps="handled"
      >

        {children}

      </ScrollView>

    </View>

  );

}

function CarApp({
  icon,
  title,
  subtitle,
  active,
  onPress,
}: {
  icon:string;
  title:string;
  subtitle:string;
  active?:boolean;
  onPress:() => void;
}) {

  return (

    <Pressable
      style={[
        styles.carApp,
        active &&
          styles.carAppActive,
      ]}
      onPress={
        onPress
      }
    >

      <View
        style={
          styles.carAppIcon
        }
      >

        <Text
          style={
            styles.carAppIconText
          }
        >
          {icon}
        </Text>

      </View>

      <Text
        style={
          styles.carAppTitle
        }
      >
        {title}
      </Text>

      <Text
        style={
          styles.carAppSubtitle
        }
        numberOfLines={
          1
        }
      >
        {subtitle}
      </Text>

    </Pressable>

  );

}

function Tachometer({
  rpm,
  maxRpm,
}: {
  rpm:number;
  maxRpm:number;
}) {

  const size = 168;

  const start =
    -135;

  const end =
    135;

  const normalized =
    Math.max(
      0,
      Math.min(
        1,
        (rpm - 700) /
          (maxRpm - 700)
      )
    );

  const angle =
    start +
    normalized *
      (end - start);

  const ticks =
    Array.from(
      {
        length:17,
      },
      (_,index) =>
        start +
        index *
          ((end - start) /
            16)
    );

  return (

    <View
      style={[
        styles.tacho,
        {
          width:size,
          height:size,
          borderRadius:
            size / 2,
        },
      ]}
    >

      {ticks.map(
        (
          tick,
          index
        ) => (

          <View
            key={
              index
            }
            style={[
              styles.tickWrap,
              {
                width:size,
                height:size,
                transform:[
                  {
                    rotate:
                      `${tick}deg`,
                  },
                ],
              },
            ]}
          >

            <View
              style={[
                styles.tick,
                index % 4 === 0 &&
                  styles.majorTick,
              ]}
            />

          </View>

        )
      )}

      <View
        style={[
          styles.needleWrap,
          {
            width:size,
            height:size,
            transform:[
              {
                rotate:
                  `${angle}deg`,
              },
            ],
          },
        ]}
      >

        <View
          style={
            styles.needle
          }
        />

      </View>

      <View
        style={
          styles.tachoCenter
        }
      >

        <Text
          style={
            styles.tachoRpm
          }
        >
          {rpm}
        </Text>

        <Text
          style={
            styles.tachoUnit
          }
        >
          RPM
        </Text>

      </View>

      <Text
        style={
          styles.tachoTitle
        }
      >
        E-TEC
      </Text>

    </View>

  );

}

function HudMetric({
  label,
  value,
}: {
  label:string;
  value:string;
}) {

  return (

    <View
      style={
        styles.hudMetric
      }
    >

      <Text
        style={
          styles.hudLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.hudValue
        }
      >
        {value}
      </Text>

    </View>

  );

}

function InfoMetric({
  label,
  value,
}: {
  label:string;
  value:string;
}) {

  return (

    <View
      style={
        styles.infoMetric
      }
    >

      <Text
        style={
          styles.infoMetricLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.infoMetricValue
        }
      >
        {value}
      </Text>

    </View>

  );

}

function SectionTitle({
  title,
  subtitle,
}: {
  title:string;
  subtitle:string;
}) {

  return (

    <View
      style={
        styles.section
      }
    >

      <Text
        style={
          styles.sectionTitle
        }
      >
        {title}
      </Text>

      <Text
        style={
          styles.sectionSubtitle
        }
      >
        {subtitle}
      </Text>

    </View>

  );

}

function Input({
  label,
  value,
  onChangeText,
  half,
  keyboardType,
}: {
  label:string;
  value:string;
  onChangeText:(value:string) => void;
  half?:boolean;
  keyboardType?:any;
}) {

  return (

    <View
      style={[
        styles.inputField,
        half &&
          styles.inputHalf,
      ]}
    >

      <Text
        style={
          styles.inputLabel
        }
      >
        {label}
      </Text>

      <TextInput
        value={
          value
        }
        onChangeText={
          onChangeText
        }
        keyboardType={
          keyboardType
        }
        style={
          styles.input
        }
        selectionColor="#0EA5E9"
        placeholderTextColor="#607783"
      />

    </View>

  );

}

function SettingRow({
  title,
  subtitle,
  value,
}: {
  title:string;
  subtitle:string;
  value:React.ReactNode;
}) {

  return (

    <View
      style={
        styles.settingRow
      }
    >

      <View
        style={{
          flex:1,
          paddingRight:16,
        }}
      >

        <Text
          style={
            styles.settingTitle
          }
        >
          {title}
        </Text>

        <Text
          style={
            styles.settingSubtitle
          }
        >
          {subtitle}
        </Text>

      </View>

      {value}

    </View>

  );

}

function InfoRow({
  label,
  value,
}: {
  label:string;
  value:string;
}) {

  return (

    <View
      style={
        styles.infoRow
      }
    >

      <Text
        style={
          styles.infoRowLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.infoRowValue
        }
      >
        {value}
      </Text>

    </View>

  );

}

/* ========================================================================= */
/* STYLES                                                                    */
/* ========================================================================= */

const styles =
  StyleSheet.create({

    safe:{
      flex:1,
      backgroundColor:"#06111A",
    },

    home:{
      flex:1,
      backgroundColor:"#06111A",
    },

    fullScreen:{
      flex:1,
      backgroundColor:"#06111A",
    },

    brandOverlay:{
      position:"absolute",
      top:12,
      left:12,
    },

    brandGlass:{
      flexDirection:"row",
      alignItems:"center",
      backgroundColor:"rgba(5,14,21,0.91)",
      borderWidth:1,
      borderColor:"rgba(255,255,255,0.09)",
      borderRadius:17,
      paddingHorizontal:10,
      paddingVertical:8,
    },

    logoBox:{
      width:40,
      height:40,
      borderRadius:13,
      backgroundColor:"#10232D",
      borderWidth:1,
      borderColor:"#254550",
      justifyContent:"center",
      alignItems:"center",
      marginRight:9,
    },

    logoText:{
      color:"#F2F9FB",
      fontSize:22,
      fontWeight:"900",
      fontStyle:"italic",
    },

    brandTiny:{
      color:"#68818E",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1.8,
    },

    brandName:{
      color:"#F1F8FA",
      fontSize:14,
      fontWeight:"900",
      marginTop:2,
    },

    topActions:{
      position:"absolute",
      top:12,
      right:12,
      flexDirection:"row",
      gap:7,
    },

    glassButton:{
      minWidth:44,
      height:43,
      borderRadius:14,
      backgroundColor:"rgba(5,14,21,0.91)",
      borderWidth:1,
      borderColor:"rgba(255,255,255,0.09)",
      paddingHorizontal:10,
      alignItems:"center",
      justifyContent:"center",
      flexDirection:"row",
    },

    glassButtonText:{
      color:"#DCECF1",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:0.8,
    },

    gpsDot:{
      width:7,
      height:7,
      borderRadius:7,
      backgroundColor:"#77858C",
      marginRight:5,
    },

    gpsDotGood:{
      backgroundColor:"#2DD4A3",
    },

    spotifyIcon:{
      color:"#8BDEA0",
      fontSize:20,
      fontWeight:"900",
    },

    routeHud:{
      position:"absolute",
      left:13,
      right:13,
      top:69,
      backgroundColor:"rgba(5,14,21,0.94)",
      borderWidth:1,
      borderColor:"#205268",
      borderRadius:18,
      paddingHorizontal:14,
      paddingVertical:10,
      flexDirection:"row",
      alignItems:"center",
    },

    routeHudEyebrow:{
      color:"#6C8997",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1.5,
    },

    routeHudDistance:{
      color:"#EFF8FA",
      fontSize:23,
      fontWeight:"900",
      marginTop:1,
    },

    routeHudRight:{
      marginLeft:"auto",
      marginRight:31,
      alignItems:"flex-end",
    },

    routeHudCourse:{
      color:"#0EA5E9",
      fontSize:21,
      fontWeight:"900",
    },

    routeHudEta:{
      color:"#718894",
      fontSize:8,
      marginTop:1,
      fontWeight:"900",
    },

    routeHudClose:{
      position:"absolute",
      right:8,
      top:8,
      width:28,
      height:28,
      borderRadius:9,
      backgroundColor:"#11232D",
      justifyContent:"center",
      alignItems:"center",
    },

    routeHudCloseText:{
      color:"#DFECF0",
      fontSize:20,
    },

    routeProgress:{
      position:"absolute",
      top:126,
      left:14,
      right:14,
    },

    routeProgressTrack:{
      height:4,
      borderRadius:4,
      backgroundColor:"rgba(4,12,18,0.8)",
      overflow:"hidden",
    },

    routeProgressFill:{
      height:"100%",
      backgroundColor:"#0EA5E9",
    },

    instrumentRow:{
      position:"absolute",
      left:12,
      right:12,
      bottom:132,
      flexDirection:"row",
      alignItems:"flex-end",
    },

    instrumentRowWide:{
      position:"absolute",
      left:18,
      right:18,
      bottom:127,
      flexDirection:"row",
      alignItems:"flex-end",
    },

    tacho:{
      backgroundColor:"rgba(5,14,21,0.92)",
      borderWidth:1,
      borderColor:"#223D48",
      justifyContent:"center",
      alignItems:"center",
    },

    tickWrap:{
      position:"absolute",
      top:0,
      left:0,
      justifyContent:"flex-start",
      alignItems:"center",
    },

    tick:{
      marginTop:8,
      width:2,
      height:8,
      borderRadius:2,
      backgroundColor:"#637A84",
    },

    majorTick:{
      width:3,
      height:13,
      backgroundColor:"#C2D5DB",
    },

    needleWrap:{
      position:"absolute",
      top:0,
      left:0,
      justifyContent:"center",
      alignItems:"center",
    },

    needle:{
      width:3,
      height:62,
      marginTop:-31,
      backgroundColor:"#EF7279",
      borderRadius:4,
    },

    tachoCenter:{
      width:72,
      height:72,
      borderRadius:72,
      backgroundColor:"#07151D",
      borderWidth:1,
      borderColor:"#274451",
      alignItems:"center",
      justifyContent:"center",
    },

    tachoRpm:{
      color:"#EFF8FA",
      fontSize:20,
      fontWeight:"900",
    },

    tachoUnit:{
      color:"#6A8591",
      fontSize:7,
      fontWeight:"900",
      letterSpacing:1.5,
      marginTop:2,
    },

    tachoTitle:{
      position:"absolute",
      bottom:28,
      color:"#536E79",
      fontSize:7,
      fontWeight:"900",
      letterSpacing:1.4,
    },

    digitalSpeed:{
      marginLeft:9,
      minWidth:150,
      borderRadius:18,
      backgroundColor:"rgba(5,14,21,0.92)",
      borderWidth:1,
      borderColor:"#233F4A",
      alignItems:"center",
      paddingHorizontal:13,
      paddingVertical:12,
    },

    digitalSpeedLabel:{
      color:"#68828E",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1.5,
    },

    digitalSpeedRow:{
      flexDirection:"row",
      alignItems:"flex-end",
      marginTop:-1,
    },

    digitalSpeedNumber:{
      color:"#F2FAFC",
      fontSize:51,
      lineHeight:56,
      fontWeight:"900",
      letterSpacing:-2,
    },

    digitalSpeedUnit:{
      color:"#718A95",
      fontSize:10,
      fontWeight:"900",
      marginLeft:5,
      marginBottom:9,
    },

    digitalSpeedSub:{
      color:"#58737F",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1,
      marginTop:1,
    },

    miniHudColumn:{
      marginLeft:"auto",
      gap:6,
    },

    hudMetric:{
      minWidth:74,
      borderRadius:12,
      backgroundColor:"rgba(5,14,21,0.91)",
      borderWidth:1,
      borderColor:"#1B3440",
      paddingHorizontal:9,
      paddingVertical:7,
    },

    hudLabel:{
      color:"#5E7884",
      fontSize:7,
      fontWeight:"900",
      letterSpacing:1,
    },

    hudValue:{
      color:"#E4F0F4",
      fontSize:13,
      fontWeight:"900",
      marginTop:1,
    },

    mapControls:{
      position:"absolute",
      right:13,
      bottom:287,
      gap:8,
    },

    mapRound:{
      width:43,
      height:43,
      borderRadius:14,
      backgroundColor:"rgba(5,14,21,0.93)",
      borderWidth:1,
      borderColor:"#29434E",
      justifyContent:"center",
      alignItems:"center",
    },

    mapRoundActive:{
      borderColor:"#0EA5E9",
      backgroundColor:"rgba(14,165,233,0.21)",
    },

    mapRoundText:{
      color:"#E3F3F7",
      fontSize:19,
      fontWeight:"900",
    },

    gestureHint:{
      position:"absolute",
      left:12,
      right:12,
      bottom:105,
      justifyContent:"center",
      alignItems:"center",
    },

    gestureHintText:{
      color:"#A8BBC2",
      backgroundColor:"rgba(5,14,21,0.84)",
      paddingHorizontal:9,
      paddingVertical:5,
      borderRadius:8,
      overflow:"hidden",
      fontSize:7,
      fontWeight:"900",
      letterSpacing:0.7,
    },

    dock:{
      position:"absolute",
      left:0,
      right:0,
      bottom:0,
      minHeight:99,
      maxHeight:99,
      backgroundColor:"rgba(5,13,19,0.96)",
      borderTopWidth:1,
      borderTopColor:"#18303B",
    },

    dockContent:{
      paddingHorizontal:7,
      alignItems:"center",
      gap:4,
    },

    carApp:{
      width:91,
      minHeight:78,
      marginTop:8,
      marginHorizontal:2,
      borderRadius:17,
      alignItems:"center",
      justifyContent:"center",
    },

    carAppActive:{
      backgroundColor:"#102630",
      borderWidth:1,
      borderColor:"#215369",
    },

    carAppIcon:{
      width:38,
      height:38,
      borderRadius:12,
      backgroundColor:"#0D202A",
      alignItems:"center",
      justifyContent:"center",
      marginBottom:5,
    },

    carAppIconText:{
      color:"#E0F0F4",
      fontSize:18,
      fontWeight:"900",
    },

    carAppTitle:{
      color:"#DCE8EC",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:0.8,
    },

    carAppSubtitle:{
      color:"#5D7580",
      fontSize:7,
      marginTop:2,
      maxWidth:74,
      textAlign:"center",
    },

    topBar:{
      minHeight:75,
      paddingHorizontal:13,
      flexDirection:"row",
      alignItems:"center",
      borderBottomWidth:1,
      borderBottomColor:"#142A35",
    },

    backButton:{
      width:43,
      height:43,
      borderRadius:14,
      backgroundColor:"#0D1D26",
      borderWidth:1,
      borderColor:"#1B3541",
      alignItems:"center",
      justifyContent:"center",
      marginRight:11,
    },

    backText:{
      color:"#EAF5F8",
      fontSize:31,
      marginTop:-3,
    },

    topBarSubtitle:{
      color:"#607A85",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1.7,
    },

    topBarTitle:{
      color:"#F1F8FA",
      fontSize:20,
      fontWeight:"900",
      marginTop:2,
    },

    scroll:{
      flex:1,
    },

    scrollContent:{
      padding:14,
      paddingBottom:42,
    },

    routeBig:{
      backgroundColor:"#0A1720",
      borderWidth:1,
      borderColor:"#1A3845",
      borderRadius:22,
      padding:18,
    },

    routeBigType:{
      color:"#668391",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1.6,
    },

    routeBigNumber:{
      color:"#F0F8FA",
      fontSize:48,
      fontWeight:"900",
      marginTop:3,
    },

    routeBigSub:{
      color:"#67818C",
      fontSize:10,
      marginTop:1,
    },

    metricGrid:{
      flexDirection:"row",
      flexWrap:"wrap",
      gap:8,
      marginTop:10,
    },

    infoMetric:{
      width:"48.7%",
      backgroundColor:"#0A1720",
      borderWidth:1,
      borderColor:"#18303C",
      borderRadius:17,
      padding:13,
    },

    infoMetricLabel:{
      color:"#5A7480",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1.1,
    },

    infoMetricValue:{
      color:"#EFF8FA",
      fontSize:24,
      fontWeight:"900",
      marginTop:4,
    },

    warningPanel:{
      marginTop:11,
      backgroundColor:"#18170F",
      borderWidth:1,
      borderColor:"#4A4027",
      borderRadius:15,
      padding:12,
    },

    warningTitle:{
      color:"#DBB25A",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1.2,
    },

    warningText:{
      color:"#ADA68D",
      fontSize:10,
      lineHeight:16,
      marginTop:4,
    },

    primaryLarge:{
      marginTop:11,
      backgroundColor:"#0EA5E9",
      borderRadius:15,
      paddingVertical:15,
      alignItems:"center",
    },

    primaryLargeText:{
      color:"#03151C",
      fontSize:9,
      fontWeight:"900",
      letterSpacing:1.2,
    },

    secondaryLarge:{
      marginTop:8,
      backgroundColor:"#0B1A23",
      borderWidth:1,
      borderColor:"#25424F",
      borderRadius:15,
      paddingVertical:14,
      alignItems:"center",
    },

    secondaryLargeText:{
      color:"#92C1D0",
      fontSize:9,
      fontWeight:"900",
      letterSpacing:1.1,
    },

    emptyRoute:{
      backgroundColor:"#0A1720",
      borderWidth:1,
      borderColor:"#193440",
      borderRadius:22,
      padding:22,
      alignItems:"center",
    },

    emptyRouteIcon:{
      color:"#7DA8B8",
      fontSize:38,
    },

    emptyRouteTitle:{
      color:"#E4F0F3",
      fontSize:15,
      fontWeight:"900",
      marginTop:8,
    },

    emptyRouteText:{
      color:"#687F8A",
      fontSize:10,
      lineHeight:16,
      textAlign:"center",
      marginTop:8,
    },

    section:{
      marginTop:17,
      marginBottom:8,
    },

    sectionTitle:{
      color:"#C5D8DE",
      fontSize:10,
      fontWeight:"900",
      letterSpacing:1.5,
    },

    sectionSubtitle:{
      color:"#526B77",
      fontSize:9,
      marginTop:3,
    },

    profileHero:{
      backgroundColor:"#0A1720",
      borderWidth:1,
      borderColor:"#193440",
      borderRadius:22,
      padding:15,
      flexDirection:"row",
      alignItems:"center",
    },

    profileLogo:{
      width:72,
      height:72,
      borderRadius:20,
      backgroundColor:"#10232D",
      borderWidth:1,
      borderColor:"#234552",
      alignItems:"center",
      justifyContent:"center",
      marginRight:13,
    },

    profileLogoText:{
      color:"#F4FAFC",
      fontSize:39,
      fontWeight:"900",
      fontStyle:"italic",
    },

    profileBrand:{
      color:"#78929D",
      fontSize:9,
      fontWeight:"900",
      letterSpacing:1.7,
    },

    profileModel:{
      color:"#F0F8FA",
      fontSize:20,
      fontWeight:"900",
      marginTop:3,
    },

    profileSub:{
      color:"#607985",
      fontSize:10,
      marginTop:4,
    },

    inputField:{
      marginBottom:8,
    },

    inputHalf:{
      flex:1,
    },

    formRow:{
      flexDirection:"row",
      gap:8,
    },

    inputLabel:{
      color:"#58717D",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1.1,
      marginBottom:4,
    },

    input:{
      backgroundColor:"#0A1720",
      color:"#EDF7F9",
      borderWidth:1,
      borderColor:"#193541",
      borderRadius:13,
      paddingHorizontal:12,
      paddingVertical:
        Platform.OS ===
        "ios"
          ? 12
          : 10,
      fontSize:13,
      fontWeight:"700",
    },

    engineHero:{
      backgroundColor:"#0A1720",
      borderWidth:1,
      borderColor:"#193541",
      borderRadius:22,
      padding:18,
      flexDirection:"row",
      justifyContent:"space-between",
    },

    engineBrand:{
      color:"#67818D",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1.7,
    },

    engineHp:{
      color:"#EEF8FA",
      fontSize:39,
      fontWeight:"900",
      marginTop:3,
    },

    engineModelText:{
      color:"#718A94",
      fontSize:11,
      marginTop:2,
    },

    livePill:{
      height:29,
      borderRadius:100,
      paddingHorizontal:9,
      backgroundColor:"#0B201C",
      borderWidth:1,
      borderColor:"#1D4B3E",
      alignItems:"center",
      justifyContent:"center",
      flexDirection:"row",
    },

    liveDot:{
      width:6,
      height:6,
      borderRadius:6,
      backgroundColor:"#2DD4A3",
      marginRight:5,
    },

    livePillText:{
      color:"#88D9C3",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1,
    },

    settingRow:{
      minHeight:68,
      backgroundColor:"#0A1720",
      borderWidth:1,
      borderColor:"#17313D",
      borderRadius:16,
      paddingHorizontal:13,
      alignItems:"center",
      flexDirection:"row",
    },

    settingTitle:{
      color:"#E1EDF1",
      fontSize:11,
      fontWeight:"900",
    },

    settingSubtitle:{
      color:"#647D88",
      fontSize:9,
      lineHeight:14,
      marginTop:3,
    },

    fuelHero:{
      backgroundColor:"#0A1720",
      borderWidth:1,
      borderColor:"#193440",
      borderRadius:22,
      padding:18,
    },

    fuelHeroLabel:{
      color:"#63808C",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1.6,
    },

    fuelHeroNumber:{
      color:"#EFF8FA",
      fontSize:58,
      lineHeight:63,
      fontWeight:"900",
      marginTop:2,
    },

    fuelHeroLiters:{
      color:"#6D858F",
      fontSize:11,
      fontWeight:"700",
    },

    fuelBar:{
      height:14,
      borderRadius:14,
      backgroundColor:"#092731",
      overflow:"hidden",
      marginTop:14,
    },

    fuelBarFill:{
      height:"100%",
      borderRadius:14,
      backgroundColor:"#0EA5E9",
    },

    stationRow:{
      minHeight:70,
      backgroundColor:"#0A1720",
      borderWidth:1,
      borderColor:"#17323D",
      borderRadius:16,
      paddingHorizontal:11,
      flexDirection:"row",
      alignItems:"center",
      marginBottom:7,
    },

    stationIcon:{
      width:40,
      height:40,
      borderRadius:12,
      backgroundColor:"#0C251F",
      borderWidth:1,
      borderColor:"#205546",
      alignItems:"center",
      justifyContent:"center",
      marginRight:10,
    },

    stationCenter:{
      flex:1,
    },

    stationName:{
      color:"#E1EEF2",
      fontSize:11,
      fontWeight:"900",
    },

    stationCoordinates:{
      color:"#58717C",
      fontSize:8,
      marginTop:3,
    },

    stationPrices:{
      alignItems:"flex-end",
    },

    stationMarine:{
      color:"#8DDBC4",
      fontSize:11,
      fontWeight:"900",
    },

    stationPrice:{
      color:"#80969F",
      fontSize:8,
      marginTop:2,
    },

    infoPanel:{
      marginTop:11,
      backgroundColor:"#0A1720",
      borderWidth:1,
      borderColor:"#193440",
      borderRadius:17,
      padding:13,
    },

    infoPanelTitle:{
      color:"#89BBCB",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1.3,
    },

    infoPanelText:{
      color:"#6C848F",
      fontSize:10,
      lineHeight:16,
      marginTop:4,
    },

    aboutWarning:{
      color:"#C09A52",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1,
      marginTop:13,
    },

    dataHero:{
      backgroundColor:"#0A1720",
      borderWidth:1,
      borderColor:"#193440",
      borderRadius:22,
      padding:18,
    },

    dataHeroLabel:{
      color:"#64808C",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1.6,
    },

    dataHeroNumber:{
      color:"#EEF8FA",
      fontSize:42,
      fontWeight:"900",
      marginTop:3,
    },

    dataHeroSub:{
      color:"#6A838E",
      fontSize:11,
      marginTop:2,
    },

    infoRow:{
      minHeight:51,
      backgroundColor:"#0A1720",
      borderWidth:1,
      borderColor:"#172F3B",
      borderRadius:14,
      paddingHorizontal:13,
      marginTop:7,
      flexDirection:"row",
      alignItems:"center",
      justifyContent:"space-between",
    },

    infoRowLabel:{
      color:"#708791",
      fontSize:10,
      fontWeight:"700",
    },

    infoRowValue:{
      color:"#E4EFF2",
      fontSize:12,
      fontWeight:"900",
    },

    spotifyPanel:{
      minHeight:72,
      backgroundColor:"#0A1720",
      borderWidth:1,
      borderColor:"#193740",
      borderRadius:17,
      paddingHorizontal:12,
      alignItems:"center",
      flexDirection:"row",
    },

    spotifyPanelIcon:{
      width:45,
      height:45,
      borderRadius:14,
      backgroundColor:"#123021",
      borderWidth:1,
      borderColor:"#235B3E",
      alignItems:"center",
      justifyContent:"center",
      marginRight:11,
    },

    spotifyPanelIconText:{
      color:"#8DDEA1",
      fontSize:21,
      fontWeight:"900",
    },

    spotifyPanelTitle:{
      color:"#E8F3EB",
      fontSize:12,
      fontWeight:"900",
    },

    spotifyPanelSub:{
      color:"#64806E",
      fontSize:9,
      marginTop:3,
    },

    spotifyArrow:{
      color:"#809D8B",
      fontSize:29,
    },

    modalBackdrop:{
      flex:1,
      backgroundColor:"rgba(0,0,0,0.62)",
      justifyContent:"flex-end",
    },

    actionSheet:{
      backgroundColor:"#08141C",
      borderTopLeftRadius:27,
      borderTopRightRadius:27,
      borderWidth:1,
      borderBottomWidth:0,
      borderColor:"#274451",
      padding:16,
      paddingBottom:26,
    },

    sheetHandle:{
      width:42,
      height:4,
      borderRadius:4,
      backgroundColor:"#38515C",
      alignSelf:"center",
      marginBottom:16,
    },

    sheetEyebrow:{
      color:"#688490",
      fontSize:8,
      fontWeight:"900",
      letterSpacing:1.7,
    },

    sheetTitle:{
      color:"#F0F8FA",
      fontSize:24,
      fontWeight:"900",
      marginTop:3,
    },

    sheetCoordinates:{
      color:"#627A85",
      fontSize:9,
      marginTop:5,
      marginBottom:12,
    },

    sheetPrimary:{
      minHeight:70,
      backgroundColor:"#0EA5E9",
      borderRadius:18,
      paddingHorizontal:13,
      flexDirection:"row",
      alignItems:"center",
    },

    sheetPrimaryIcon:{
      color:"#03151C",
      fontSize:22,
      width:27,
      textAlign:"center",
      marginRight:10,
    },

    sheetPrimaryTitle:{
      color:"#03161D",
      fontSize:10,
      fontWeight:"900",
    },

    sheetPrimarySub:{
      color:"#15506A",
      fontSize:8,
      marginTop:2,
    },

    sheetButton:{
      minHeight:68,
      backgroundColor:"#0D1D26",
      borderWidth:1,
      borderColor:"#1B3642",
      borderRadius:17,
      paddingHorizontal:13,
      marginTop:8,
      flexDirection:"row",
      alignItems:"center",
    },

    sheetIcon:{
      width:27,
      color:"#B0D4DF",
      fontSize:20,
      textAlign:"center",
      marginRight:10,
    },

    sheetButtonTitle:{
      color:"#DFEBEF",
      fontSize:10,
      fontWeight:"900",
    },

    sheetButtonSub:{
      color:"#627A85",
      fontSize:9,
      marginTop:2,
    },

    sheetCancel:{
      marginTop:8,
      minHeight:50,
      borderRadius:14,
      backgroundColor:"#0B1720",
      alignItems:"center",
      justifyContent:"center",
    },

    sheetCancelText:{
      color:"#8297A0",
      fontSize:9,
      fontWeight:"900",
      letterSpacing:1.1,
    },

    formModalBackdrop:{
      flex:1,
      backgroundColor:"rgba(0,0,0,0.64)",
      justifyContent:"flex-end",
    },

    formModalScroll:{
      flexGrow:1,
      justifyContent:"flex-end",
    },

    formModal:{
      backgroundColor:"#08141C",
      borderTopLeftRadius:27,
      borderTopRightRadius:27,
      borderWidth:1,
      borderBottomWidth:0,
      borderColor:"#274451",
      padding:16,
      paddingBottom:26,
    },

    dangerLarge:{
      marginTop:10,
      backgroundColor:"#1A1113",
      borderWidth:1,
      borderColor:"#5A2E34",
      borderRadius:15,
      alignItems:"center",
      paddingVertical:14,
    },

    dangerLargeText:{
      color:"#E0A0A8",
      fontSize:9,
      fontWeight:"900",
      letterSpacing:1.1,
    },

  });