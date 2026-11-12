/**
 * Regional radio coverage that the global popularity catalog misses.
 *
 * The main catalog keeps the most-listened stations worldwide, so local
 * stations in a city (for example Sydney and the NSW Central Coast) rarely make
 * the cut, and most of them carry no coordinates in Radio Browser. This module
 * adds every playable station for each configured area, places stations that
 * have no coordinates near the area's centre, and adds the SomaFM channels from
 * SomaFM's own channel list at their San Francisco home.
 *
 * Everything here is best effort: a failed regional fetch never changes the
 * health of the main catalog.
 */
import { createHash } from 'node:crypto';

import { cleanRadioText, normalizeRadioBrowserStation } from './stations.js';

/** Areas whose every playable station joins the catalog. */
export const RADIO_REGIONAL_AREAS = Object.freeze([
  Object.freeze({
    id: 'sydney',
    countryCode: 'AU',
    centre: Object.freeze({ lat: -33.8688, lon: 151.2093 }),
    spreadDeg: 0.06,
    statePattern: /\bsydney\b/i,
    textPattern: /\bsydney\b/i,
    box: Object.freeze({
      south: -34.2,
      north: -33.55,
      west: 150.6,
      east: 151.35,
    }),
  }),
  Object.freeze({
    id: 'central-coast',
    countryCode: 'AU',
    centre: Object.freeze({ lat: -33.4245, lon: 151.3419 }),
    spreadDeg: 0.05,
    statePattern: /central coast|gosford|wyong/i,
    textPattern:
      /central coast|gosford|wyong|terrigal|woy woy|the entrance|tuggerah|\berina\b/i,
    box: Object.freeze({
      south: -33.55,
      north: -33.1,
      west: 151.1,
      east: 151.65,
    }),
  }),
]);

/**
 * Stream hosts checked to serve the same stream over HTTPS. Radio Browser lists
 * them with http:// links, which a secure page cannot play, so they are
 * upgraded. Only hosts confirmed to return audio over HTTPS belong here.
 */
export const RADIO_HTTPS_UPGRADE_HOSTS = Object.freeze(
  new Set([
    'a2.asurahosting.com:6350',
    'abc.streamguys1.com',
    'air.radioart.online',
    'audio-edge-d34v9.syd.o.radiomast.io',
    'audio.joy.org.au',
    'az1.syd2.hostyourservices.au',
    'az1.syd2.hostyourservices.au:8010',
    'azure.bullantcomm.com:8030',
    'bbr0.radioca.st',
    'c13.radioboss.fm:18190',
    'c17.radioboss.fm:18193',
    'c3.radioboss.fm:8018',
    'c7.radioboss.fm:18291',
    'cast2.my-control-panel.com',
    'cast3.asurahosting.com',
    'cast4.asurahosting.com',
    'cast4.my-control-panel.com',
    'cast5.asurahosting.com',
    'firstnationsmedia.stream',
    'ice10.securenetsystems.net',
    'ice9.securenetsystems.net',
    'listen.radioking.com',
    'playerservices.streamtheworld.com',
    'radio.torchwoodhosting.com:8020',
    'radio.torchwoodhosting.com:8028',
    'radio12.shoutcast.net.au:2020',
    'realtime.rrr.org.au',
    's10.myradiostream.com:10122',
    's2.radio.co',
    's23.myradiostream.com:13240',
    's4.yesstreaming.net:7011',
    's6.myradiostream.com:46712',
    's8.yesstreaming.net:7099',
    's9.viastreaming.net:9010',
    's9.viastreaming.net:9645',
    'sbs-ice.streamguys1.com',
    'legacy.scahw.com.au',
    'stream.aiir.com',
    'stream.artsound.fm',
    'stream.zeno.fm',
    'stream.lava.net.au',
    'stream.radio.co',
    'stream.swifthosting.com.au',
    'stream.tripleafm.com.au',
    'stream1.faithfm.com.au',
    'stream2.rhema.cc',
    'streamer.eastsidefm.org',
    'streamer.radio.co',
    'streaming.2yyyradio.com',
    'streaming.radio.co',
    'streaming.rimfm.org',
    'streaming.starterfm.com',
    'streaming.starterfm.com:8010',
    'streams2.vision.org.au',
    'thassos.cdnstream.com',
    'www.oakfm.com.au',
  ]),
);

/**
 * Where a station names its suburb ("2RRR - Ryde - 88.5 FM"), it is placed
 * there rather than at the city centre. Coordinates are suburb centres.
 */
export const RADIO_SUBURB_POINTS = Object.freeze({
  bankstown: [-33.9175, 151.0355],
  blacktown: [-33.771, 150.9057],
  bondi: [-33.8915, 151.2767],
  burwood: [-33.8774, 151.1044],
  camden: [-34.0544, 150.6963],
  campbelltown: [-34.065, 150.8142],
  chatswood: [-33.7969, 151.1832],
  gosford: [-33.4245, 151.3419],
  hawkesbury: [-33.6127, 150.8231],
  hornsby: [-33.7047, 151.0993],
  liverpool: [-33.9209, 150.9234],
  macarthur: [-34.065, 150.8142],
  narwee: [-33.9469, 151.0697],
  parramatta: [-33.815, 151.0011],
  ryde: [-33.8149, 151.1056],
  sutherland: [-34.0316, 151.0586],
  waverley: [-33.8983, 151.2516],
  wyong: [-33.2826, 151.4229],
});
const SUBURB_RE = new RegExp(
  `\\b(${Object.keys(RADIO_SUBURB_POINTS).join('|')})\\b`,
  'i',
);

const ABC_ULTIMO = Object.freeze({ lat: -33.8796, lon: 151.1985 });
const abcStream = (mount) =>
  `https://abc.streamguys1.com/live/${mount}/icecast.audio`;

/**
 * Well-known stations Radio Browser lists only as HLS (which the player does
 * not use) or without a Sydney location. Each stream was checked to serve
 * audio over HTTPS.
 */
export const RADIO_CURATED_STATIONS = Object.freeze([
  {
    key: 'abc-sydney',
    name: 'ABC Radio Sydney 702',
    streamUrl: abcStream('localsydney'),
    at: ABC_ULTIMO,
    tags: 'abc,news,talk,local radio',
    homepage: 'https://www.abc.net.au/listen/live/sydney',
  },
  {
    key: 'abc-central-coast',
    name: 'ABC Central Coast 92.5',
    streamUrl: abcStream('localcentralcoast'),
    at: { lat: -33.4366, lon: 151.3909 },
    tags: 'abc,news,talk,local radio,central coast',
    homepage: 'https://www.abc.net.au/listen/live/centralcoast',
    state: 'Central Coast NSW',
  },
  {
    key: 'triple-j',
    name: 'triple j',
    streamUrl: abcStream('triplejnsw'),
    at: ABC_ULTIMO,
    tags: 'abc,alternative,indie,youth',
    homepage: 'https://www.abc.net.au/triplej',
  },
  {
    key: 'triple-j-unearthed',
    name: 'triple j Unearthed',
    streamUrl: abcStream('triplejunearthed'),
    at: ABC_ULTIMO,
    tags: 'abc,alternative,indie,new music',
    homepage: 'https://www.triplejunearthed.com',
  },
  {
    key: 'double-j',
    name: 'Double J',
    streamUrl: abcStream('doublejnsw'),
    at: ABC_ULTIMO,
    tags: 'abc,alternative,adult album alternative',
    homepage: 'https://www.abc.net.au/doublej',
  },
  {
    key: 'abc-classic',
    name: 'ABC Classic',
    streamUrl: abcStream('classicfmnsw'),
    at: ABC_ULTIMO,
    tags: 'abc,classical',
    homepage: 'https://www.abc.net.au/listen/classic',
  },
  {
    key: 'abc-newsradio',
    name: 'ABC NewsRadio',
    streamUrl: abcStream('newsradio'),
    at: ABC_ULTIMO,
    tags: 'abc,news',
    homepage: 'https://www.abc.net.au/listen/newsradio',
  },
  {
    key: 'abc-rn',
    name: 'ABC Radio National',
    streamUrl: abcStream('rnnsw'),
    at: ABC_ULTIMO,
    tags: 'abc,talk,news,culture',
    homepage: 'https://www.abc.net.au/listen/rn',
  },
  {
    key: 'abc-jazz',
    name: 'ABC Jazz',
    streamUrl: abcStream('abcjazz'),
    at: ABC_ULTIMO,
    tags: 'abc,jazz,blues',
    homepage: 'https://www.abc.net.au/listen/jazz',
  },
  {
    key: 'abc-country',
    name: 'ABC Country',
    streamUrl: abcStream('abccountry'),
    at: ABC_ULTIMO,
    tags: 'abc,country',
    homepage: 'https://www.abc.net.au/listen/country',
  },
  {
    key: '2day-fm',
    name: '2Day FM 104.1',
    streamUrl: 'https://legacy.scahw.com.au/2day_128',
    at: { lat: -33.8205, lon: 151.1989 },
    tags: 'hits,pop,commercial',
    codec: 'AAC',
    homepage: 'https://www.2dayfm.com.au',
  },
  {
    key: '2ser',
    name: '2SER 107.3',
    streamUrl: 'https://icecast1.myradio.click/streamrelay',
    at: { lat: -33.8832, lon: 151.2005 },
    tags: 'community radio,alternative,news',
    codec: 'MP3',
    homepage: 'https://2ser.com',
  },
]);

/** Curated stations as catalog rows, at their studios. */
export function curatedRegionalStations(curated = RADIO_CURATED_STATIONS) {
  return curated
    .map((entry) =>
      normalizeRadioBrowserStation({
        stationuuid: stableRadioUuid(`curated:${entry.key}`),
        name: entry.name,
        url_resolved: entry.streamUrl,
        homepage: entry.homepage || null,
        tags: entry.tags,
        language: 'English',
        country: 'Australia',
        countrycode: 'AU',
        state: entry.state || 'Sydney NSW',
        codec: entry.codec || 'AAC+',
        bitrate: 128,
        hls: 0,
        lastcheckok: 1,
        ...(() => {
          const point = spreadPoint(entry.at, 0.002, `curated:${entry.key}`);
          return { geo_lat: point.lat, geo_long: point.lon };
        })(),
        clickcount: 0,
      }),
    )
    .filter(Boolean);
}

export const SOMAFM_CHANNELS_URL = 'https://api.somafm.com/channels.json';
/** SomaFM broadcasts from San Francisco's Mission District. */
export const SOMAFM_HOME = Object.freeze({ lat: 37.7599, lon: -122.4148 });
export const RADIO_REGIONAL_LIMIT = 900;
const SOMAFM_CHANNEL_LIMIT = 120;
const SOMAFM_ID_RE = /^[a-z0-9]{1,40}$/;
const SOMAFM_HOSTS = ['ice2', 'ice4', 'ice5', 'ice6'];

/** Return a stable RFC 4122-shaped id derived from a namespaced key. */
export function stableRadioUuid(key) {
  const hex = createHash('sha1').update(String(key)).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A deterministic point near `centre`, so stacked stations stay put. */
function spreadPoint(centre, spreadDeg, key) {
  const hex = createHash('sha1').update(String(key)).digest('hex');
  const angle = (parseInt(hex.slice(0, 8), 16) / 0xffffffff) * 2 * Math.PI;
  const radius =
    Math.sqrt(parseInt(hex.slice(8, 16), 16) / 0xffffffff) * spreadDeg;
  return {
    lat: Number((centre.lat + radius * Math.sin(angle)).toFixed(5)),
    lon: Number(
      (
        centre.lon +
        (radius * Math.cos(angle)) / Math.cos((centre.lat * Math.PI) / 180)
      ).toFixed(5),
    ),
  };
}

/** Upgrade an http:// stream on a host known to serve the same path securely. */
export function upgradeRadioStreamUrl(value) {
  const text = String(value ?? '');
  if (!/^http:\/\//i.test(text)) return text;
  try {
    const url = new URL(text);
    if (!RADIO_HTTPS_UPGRADE_HOSTS.has(url.host.toLowerCase())) return text;
    url.protocol = 'https:';
    return url.href;
  } catch {
    return text;
  }
}

function hasCoordinates(row) {
  const lat = Number(row?.geo_lat);
  const lon = Number(row?.geo_long);
  return (
    row?.geo_lat !== null &&
    row?.geo_lat !== '' &&
    row?.geo_long !== null &&
    row?.geo_long !== '' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    !(lat === 0 && lon === 0)
  );
}

function inBox(row, box) {
  if (!hasCoordinates(row)) return false;
  const lat = Number(row.geo_lat);
  const lon = Number(row.geo_long);
  return (
    lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east
  );
}

/** Return the configured area a Radio Browser row belongs to, if any. */
export function regionalAreaFor(row, areas = RADIO_REGIONAL_AREAS) {
  if (!row || typeof row !== 'object') return null;
  const countryCode = cleanRadioText(row.countrycode, 2).toUpperCase();
  const state = cleanRadioText(row.state, 80);
  const text = `${cleanRadioText(row.name, 140)} ${cleanRadioText(row.tags, 400)}`;
  // Coordinates inside an area win; then the more specific text matches, so a
  // "Central Coast" station listed under "Sydney NSW" lands on the Coast.
  for (const area of areas) if (inBox(row, area.box)) return area;
  for (const area of [...areas].reverse()) {
    if (countryCode && countryCode !== area.countryCode) continue;
    if (area.statePattern.test(state) || area.textPattern.test(text))
      return area;
  }
  return null;
}

/** A display key that folds MP3/AAC/bitrate variants of one station together. */
export function regionalStationKey(name) {
  return cleanRadioText(name, 140)
    .toLocaleLowerCase()
    .replace(/\((?:[^)]*\b(?:mp3|aac|kbps|\d+k)\b[^)]*)\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Normalize the regional rows of one country-wide Radio Browser listing. */
export function selectRegionalStations(rows, areas = RADIO_REGIONAL_AREAS) {
  const candidates = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const area = regionalAreaFor(row, areas);
    if (!area) continue;
    const located = hasCoordinates(row)
      ? row
      : {
          ...row,
          ...(() => {
            const suburb = cleanRadioText(row.name, 140).match(SUBURB_RE);
            const suburbPoint = suburb
              ? RADIO_SUBURB_POINTS[suburb[1].toLowerCase()]
              : null;
            const point = spreadPoint(
              suburbPoint
                ? { lat: suburbPoint[0], lon: suburbPoint[1] }
                : area.centre,
              suburbPoint ? 0.006 : area.spreadDeg,
              `${area.id}:${regionalStationKey(row.name) || row.stationuuid}`,
            );
            return { geo_lat: point.lat, geo_long: point.lon };
          })(),
        };
    const station = normalizeRadioBrowserStation({
      ...located,
      url_resolved: upgradeRadioStreamUrl(located.url_resolved || located.url),
    });
    if (station) candidates.push(station);
  }
  candidates.sort(
    (a, b) =>
      b.clickCount - a.clickCount ||
      (b.bitrate || 0) - (a.bitrate || 0) ||
      a.name.localeCompare(b.name),
  );
  const seenKeys = new Set();
  const selected = [];
  for (const station of candidates) {
    const key = regionalStationKey(station.name);
    if (key && seenKeys.has(key)) continue;
    if (key) seenKeys.add(key);
    selected.push(station);
  }
  return selected;
}

/** Turn SomaFM's channel list into catalog stations placed at SomaFM's home. */
export function normalizeSomaFmChannels(body) {
  const channels = Array.isArray(body?.channels) ? body.channels : [];
  const stations = [];
  for (const channel of channels.slice(0, SOMAFM_CHANNEL_LIMIT)) {
    const id = cleanRadioText(channel?.id, 40).toLowerCase();
    const title = cleanRadioText(channel?.title, 120);
    if (!SOMAFM_ID_RE.test(id) || !title) continue;
    const host =
      SOMAFM_HOSTS[
        parseInt(stableRadioUuid(id).slice(0, 2), 16) % SOMAFM_HOSTS.length
      ];
    const point = spreadPoint(SOMAFM_HOME, 0.012, `somafm:${id}`);
    const genres = cleanRadioText(channel?.genre, 200)
      .split(/[|,/]/)
      .map((genre) => cleanRadioText(genre, 80).toLocaleLowerCase())
      .filter(Boolean);
    const station = normalizeRadioBrowserStation({
      stationuuid: stableRadioUuid(`somafm:${id}`),
      name: /^soma ?fm\b/i.test(title) ? title : `SomaFM ${title}`,
      url_resolved: `https://${host}.somafm.com/${id}-128-mp3`,
      homepage: `https://somafm.com/${id}/`,
      tags: ['somafm', 'commercial free', ...genres].join(','),
      language: 'English',
      country: 'United States',
      countrycode: 'US',
      state: 'San Francisco, California',
      codec: 'MP3',
      bitrate: 128,
      hls: 0,
      lastcheckok: 1,
      geo_lat: point.lat,
      geo_long: point.lon,
      clickcount: Math.max(0, Number(channel?.listeners) || 0),
    });
    if (station) stations.push(station);
  }
  return stations;
}
