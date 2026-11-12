import assert from 'node:assert/strict';
import test from 'node:test';

import { createRadioProxyMiddleware } from '../../server/providers/radio/catalog.js';
import {
  RADIO_CURATED_STATIONS,
  curatedRegionalStations,
  normalizeSomaFmChannels,
  regionalAreaFor,
  regionalStationKey,
  selectRegionalStations,
  stableRadioUuid,
  upgradeRadioStreamUrl,
} from '../../server/providers/radio/regional.js';
import { createCatalogModel } from '../layers/radio/catalogModel.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const { isValidRadioDirectoryStation } = createCatalogModel({});

function row(overrides = {}) {
  return {
    stationuuid: '12345678-1234-4234-8234-123456789abc',
    name: 'Test FM - Sydney - 99.9 FM (MP3)',
    url_resolved: 'https://stream.example.org/live.mp3',
    homepage: 'https://station.example.org/',
    tags: 'community radio',
    language: 'English',
    country: 'Australia',
    countrycode: 'AU',
    state: 'Sydney NSW',
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    lastcheckok: 1,
    geo_lat: null,
    geo_long: null,
    clickcount: 5,
    ...overrides,
  };
}

function responseJson(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function invoke(middleware, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const result = { status: 0, body: '' };
    const res = {
      writeHead(status) {
        result.status = status;
      },
      end(body = '') {
        result.body = String(body);
        resolve(result);
      },
    };
    Promise.resolve(middleware({ url, method }, res)).catch(reject);
  });
}

test('Sydney and Central Coast rows are recognised by state, name and location', () => {
  assert.equal(regionalAreaFor(row())?.id, 'sydney');
  assert.equal(
    regionalAreaFor(row({ state: 'NSW', name: 'Coast FM 963 - Gosford' }))?.id,
    'central-coast',
  );
  assert.equal(
    regionalAreaFor(row({ state: '', name: 'Somewhere FM', geo_lat: -33.43, geo_long: 151.34 }))?.id,
    'central-coast',
  );
  assert.equal(regionalAreaFor(row({ state: 'NSW', name: 'ABC Riverina' })), null);
  assert.equal(regionalAreaFor(row({ state: 'Melbourne VIC', name: 'Melb FM' })), null);
  assert.equal(regionalAreaFor(row({ countrycode: 'US', state: 'Sydney NSW' })), null);
});

test('stations without coordinates are placed at their suburb, deterministically', () => {
  const [ryde] = selectRegionalStations([row({ name: '2RRR - Ryde - 88.5 FM (MP3)' })]);
  assert.ok(Math.abs(ryde.lat - -33.8149) < 0.01);
  assert.ok(Math.abs(ryde.lon - 151.1056) < 0.01);
  const [again] = selectRegionalStations([row({ name: '2RRR - Ryde - 88.5 FM (MP3)' })]);
  assert.deepEqual([again.lat, again.lon], [ryde.lat, ryde.lon]);
  const [city] = selectRegionalStations([row({ name: 'Plain Sydney Radio' })]);
  assert.ok(Math.abs(city.lat - -33.8688) < 0.07);
});

test('known http stream hosts are upgraded and unknown ones stay out', () => {
  assert.equal(
    upgradeRadioStreamUrl('http://playerservices.streamtheworld.com/api/livestream-redirect/2GB.mp3'),
    'https://playerservices.streamtheworld.com/api/livestream-redirect/2GB.mp3',
  );
  assert.equal(
    upgradeRadioStreamUrl('http://abm21.com.au:8000/CONTAINER1'),
    'http://abm21.com.au:8000/CONTAINER1',
  );
  const stations = selectRegionalStations([
    row({ url_resolved: 'http://abm21.com.au:8000/CONTAINER1' }),
    row({
      stationuuid: '22345678-1234-4234-8234-123456789abc',
      name: 'Upgraded - Sydney',
      url_resolved: 'http://stream.radio.co/abc/listen',
    }),
  ]);
  assert.deepEqual(stations.map((station) => station.streamUrl), [
    'https://stream.radio.co/abc/listen',
  ]);
});

test('codec and bitrate variants of one station collapse to one marker', () => {
  assert.equal(
    regionalStationKey('Nova 96.9 - Sydney - 96.9 FM (AAC+ 128k)'),
    regionalStationKey('Nova 96.9 - Sydney - 96.9 FM (MP3)'),
  );
  const stations = selectRegionalStations([
    row({ name: 'Nova 96.9 - Sydney - 96.9 FM (MP3)', clickcount: 1 }),
    row({
      stationuuid: '22345678-1234-4234-8234-123456789abc',
      name: 'Nova 96.9 - Sydney - 96.9 FM (AAC+ 128k)',
      codec: 'AAC+',
      clickcount: 9,
    }),
  ]);
  assert.equal(stations.length, 1);
  assert.equal(stations[0].codec, 'AAC+');
});

test('curated and SomaFM stations pass the client station checks', () => {
  const curated = curatedRegionalStations();
  assert.equal(curated.length, RADIO_CURATED_STATIONS.length);
  const soma = normalizeSomaFmChannels({
    channels: [
      { id: 'groovesalad', title: 'Groove Salad', genre: 'ambient|electronica', listeners: '900' },
      { id: 'live', title: 'SomaFM Live', genre: 'live' },
      { id: '../bad', title: 'Bad' },
      { id: 'notitle' },
    ],
  });
  assert.deepEqual(soma.map((station) => station.name), [
    'SomaFM Groove Salad',
    'SomaFM Live',
  ]);
  assert.match(soma[0].streamUrl, /^https:\/\/ice\d\.somafm\.com\/groovesalad-128-mp3$/);
  assert.ok(Math.abs(soma[0].lat - 37.76) < 0.05);
  for (const station of [...curated, ...soma])
    assert.ok(isValidRadioDirectoryStation(station), station.name);
  assert.equal(stableRadioUuid('somafm:x'), stableRadioUuid('somafm:x'));
});

test('regional stations join the catalog beyond the global cap without affecting health', async () => {
  const globalRows = Array.from({ length: 800 }, (_, index) =>
    row({
      stationuuid: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      name: `Global ${index}`,
      tags: 'news,talk,weather,emergency,scanner,aviation,marine,traffic',
      country: 'Germany',
      countrycode: 'DE',
      state: 'Berlin',
      geo_lat: 52.5,
      geo_long: 13.4,
      clickcount: 1000 - index,
    }),
  );
  const communitySoma = row({
    stationuuid: '33333333-0000-4000-8000-000000000001',
    name: 'Community SomaFM copy',
    url_resolved: 'https://ice1.somafm.com/groovesalad-256-mp3',
    countrycode: 'US',
    state: 'California',
    geo_lat: 37.8,
    geo_long: -122.4,
    clickcount: 5000,
  });
  const local = row({ stationuuid: '44444444-0000-4000-8000-000000000001' });
  const fetched = [];
  const middleware = createRadioProxyMiddleware({
    lookupImpl: publicLookup,
    fetchImpl: async (url) => {
      const text = String(url);
      fetched.push(text);
      if (text.includes('/json/servers'))
        return responseJson([{ name: 'de1.api.radio-browser.info' }]);
      if (text.includes('countrycode=AU')) return responseJson([local]);
      if (text === 'https://api.somafm.com/channels.json')
        return responseJson({ channels: [{ id: 'groovesalad', title: 'Groove Salad' }] });
      if (text.includes('/json/stations/search'))
        return responseJson([communitySoma, ...globalRows]);
      if (text.includes('/json/url/')) return responseJson({ ok: 'true' });
      return responseJson({}, 404);
    },
  });
  const result = await invoke(middleware, '/stations');
  assert.equal(result.status, 200);
  const body = JSON.parse(result.body);
  assert.equal(body.degraded, false);
  const names = body.stations.map((station) => station.name);
  assert.ok(names.includes('Test FM - Sydney - 99.9 FM (MP3)'));
  assert.ok(names.includes('SomaFM Groove Salad'));
  assert.ok(names.includes('ABC Radio Sydney 702'));
  assert.ok(!names.includes('Community SomaFM copy'));
  assert.ok(body.stations.length > 750);
  assert.equal(body.coverage.regionalStationCount, body.stations.length - 749);
  for (const station of body.stations)
    assert.ok(isValidRadioDirectoryStation(station), station.name);

  // SomaFM and curated stations are not Radio Browser records: no upstream click.
  const somaId = body.stations.find((s) => s.name === 'SomaFM Groove Salad').id;
  const before = fetched.length;
  assert.equal((await invoke(middleware, `/click/${somaId}`, 'POST')).status, 204);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetched.length, before);
  assert.equal(
    (await invoke(middleware, `/click/${local.stationuuid}`, 'POST')).status,
    204,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetched.length, before + 1);
});

test('a failed regional fetch leaves the global catalog healthy', async () => {
  const globalRows = Array.from({ length: 400 }, (_, index) =>
    row({
      stationuuid: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      name: `Global ${index}`,
      tags: 'news,talk,weather,emergency,scanner,aviation,marine,traffic',
      countrycode: 'DE',
      state: 'Berlin',
      geo_lat: 52.5,
      geo_long: 13.4,
    }),
  );
  const middleware = createRadioProxyMiddleware({
    lookupImpl: publicLookup,
    fetchImpl: async (url) => {
      const text = String(url);
      if (text.includes('/json/servers'))
        return responseJson([{ name: 'de1.api.radio-browser.info' }]);
      if (text.includes('countrycode=AU') || text.includes('somafm'))
        return responseJson({}, 500);
      return responseJson(globalRows);
    },
  });
  const body = JSON.parse((await invoke(middleware, '/stations')).body);
  assert.equal(body.degraded, false);
  assert.equal(body.stations.length, 400 + RADIO_CURATED_STATIONS.length);
});
