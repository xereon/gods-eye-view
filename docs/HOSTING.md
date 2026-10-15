# Hosting on a Node.js host

`app.cjs` starts the production build (`dist/`) with the same data-provider
middleware as local development, behind an access key. It is written for
cPanel's **Setup Node.js App** (Phusion Passenger) but runs on any host that
can start `node app.cjs`.

Read `SECURITY.md` first: anyone who can reach the server can spend your
provider quotas, which is why every request must carry the access key.

## 1. Get the bundle

Download the **gods-eye-view-hosted** artifact from the latest
**Hosted bundle** workflow run in GitHub Actions. It contains the project with
`dist/` already built, so the host never has to run the build.

Browser keys (`GOOGLE_MAPS_API_KEY`, `CESIUM_ION_TOKEN`) are compiled into
`dist/`. To include them, add them as repository secrets before running the
workflow; without them the globe runs on its keyless sources.

## 2. Create the app (cPanel)

1. **Domains:** create a subdomain such as `gev.example.com` and issue it a
   certificate (AutoSSL / Let's Encrypt). Use a subdomain, not a
   subdirectory: the client calls the server at root paths such as `/api/...`.
2. **Setup Node.js App → Create Application**
   - Node.js version: 24
   - Application mode: **Development** (so `npm install` also installs Vite,
     which serves the app)
   - Application root: e.g. `gods-eye-view`
   - Application URL: the subdomain
   - Application startup file: `app.cjs`
3. **File Manager:** upload the bundle zip into the application root and
   extract it so `app.cjs` sits directly inside it.
4. **Environment variables** (in the app's settings):

   | Name                      | Value                                                                                      |
   | ------------------------- | ------------------------------------------------------------------------------------------ |
   | `GEV_ACCESS_KEY`          | a long random string (at least 16 characters)                                              |
   | `GEV_PUBLIC_HOST`         | the subdomain, e.g. `gev.example.com`                                                      |
   | `PUPPETEER_SKIP_DOWNLOAD` | `1`                                                                                        |
   | provider keys             | any of `OPENAI_API_KEY`, `AISSTREAM_API_KEY`, `OPENSKY_CLIENT_ID`, ... from `.env.example` |

5. Click **Run NPM Install**, then **Restart**.

Open `https://gev.example.com/?key=YOUR_ACCESS_KEY` once in a browser. The
server sets a cookie and removes the key from the address; later visits from
that browser need no key. Without the key or cookie every request gets
`401 Access key required.`

## 3. Point the Android app at it

In `android-app/local.properties` (not committed):

```properties
gev.serverUrl=https://gev.example.com
gev.accessKey=YOUR_ACCESS_KEY
```

or pass `-Pgev.serverUrl=... -Pgev.accessKey=...` to Gradle, or set
`GEV_SERVER_URL` / `GEV_ACCESS_KEY` in the environment.

## Updating

Download a newer bundle, extract it over the application root (your
environment variables live in cPanel, not in the files), run **Run NPM
Install** if `package-lock.json` changed, then **Restart**.

## Running elsewhere

```sh
npm ci && npm run build
GEV_ACCESS_KEY=... GEV_PUBLIC_HOST=gev.example.com PORT=8080 node app.cjs
```

Put it behind a reverse proxy that terminates HTTPS; the access cookie is
`Secure` and browsers will not send it over plain HTTP.
