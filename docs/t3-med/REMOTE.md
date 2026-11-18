# T3 Med from another computer

How the doctor opens T3 Med, running on their own laptop, from the browser of a second computer where nothing can be installed. This file is written for the doctor's helper, an agent that follows it step by step. What the fork changed for it is in [FORK.md](FORK.md), under Remote access.

## How it works

```
second computer's browser
   │  HTTPS, https://med.example.com
   ▼
Cloudflare: Access asks for a one-time code sent to the doctor's email
   │  the tunnel, an outbound connection the laptop opened
   ▼
cloudflared on the laptop  ──►  http://127.0.0.1:<port>  T3 Med's own server
```

- **Patient data, the agents and their sign-ins stay on the laptop.** The second computer holds a browser tab and one cookie.
- **T3 Med listens on loopback only.** Nothing here binds a LAN address or opens a firewall port. `cloudflared` reaches T3 Med on the laptop itself and connects outwards to Cloudflare.
- **Two locks, one behind the other.** Cloudflare Access lets one email address through. Behind it, T3 Med still asks every new browser for a one-time link made on the laptop. A paired browser is signed out after 12 hours, and the laptop can revoke it at any time.
- **The laptop must be on, awake and running T3 Med.** A closed lid or a closed app means the address answers with an error page.
- **Still closed:** T3 Connect (upstream's hosted relay), Tailscale, LAN "Network access", guest links and "Use in another app (MCP)" stay hidden. This route uses none of them.

Cloudflare sees the traffic in clear inside its network: it ends the browser's TLS and forwards the request through the tunnel. That is how any reverse proxy works, and accepting it is the doctor's decision.

## What was verified, and what was only read

| Part                                                                                                                                                                                                           | Status                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T3 Med's server serves the web interface over plain HTTP on its loopback port, in the mode the desktop app starts it in                                                                                        | **Verified** on 18 November 2026, with the built server started as `--mode desktop` on temporary folders. Not run inside the packaged desktop app: no T3 Med is installed on the machine it was built on                                                              |
| Pairing, the session cookie, the live connection (WebSocket) and every patient page through a reverse proxy that keeps the public `Host` and adds `X-Forwarded-Proto: https`                                   | **Verified** the same day with a local HTTPS proxy standing in for the tunnel, and a fresh Chromium that knew only the public hostname                                                                                                                                |
| The access rules: no patient route without a session, what a paired browser may do, revoking, the 12 hours, what Turn off ends, that a link approves no MCP agent, that a forged `X-Forwarded-Host` is refused | **Verified** by test (`apps/server/src/med/remoteAccess.test.ts`), which runs upstream's own sign-in. The first three also in that run; the rest by test only                                                                                                         |
| Every `cloudflared` command and every Cloudflare dashboard step below                                                                                                                                          | **Read** in Cloudflare's documentation on 18 November 2026, and **not run**: there was no domain and no Cloudflare account. Each step names its page. Dashboard labels change; when one differs, follow the page                                                      |
| That Cloudflare sends `X-Forwarded-Proto: https` and the public `Host` to T3 Med through a tunnel                                                                                                              | **Read** ([HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/), [Origin parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/)). Step 8 checks it |
| WebSockets through Cloudflare and through Access                                                                                                                                                               | **Read** ([WebSockets](https://developers.cloudflare.com/network/websockets/)). Step 8 checks it                                                                                                                                                                      |
| A `path` in an ingress rule (step 6), and the zone's **Always Use HTTPS** switch (step 7)                                                                                                                      | **Not read again and not run.** Written on 18 November 2026 from what Cloudflare's configuration-file and SSL/TLS pages are known to say, without opening them. Step 6 checks the rule with `cloudflared` itself; for the switch, follow the dashboard                |

## Before you start

The doctor provides, and only the doctor can:

1. **A domain whose DNS is on Cloudflare.** Cloudflare's guide for a tunnel made from the command line lists as prerequisites: add the site to Cloudflare, and change the domain's nameservers to Cloudflare ([Create a locally-managed tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/)).
2. **A Cloudflare account with Zero Trust**, and its team name (the `<team>` in `<team>.cloudflareaccess.com`).
3. **The hostname** T3 Med will answer at, a subdomain of that domain. This file writes `med.example.com`.
4. **The one email address** that may get in.

Stop and ask the doctor when any of these is missing. Do not pick a hostname or an email address for them.

## Setting it up

Do the steps in this order. Access is created before the hostname is routed: Cloudflare's own page warns that a published application without an Access application "will be available to anyone on the Internet" ([Publish a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)). Even then T3 Med would still ask for its own pairing link, but one lock is not two.

### 1. Tell T3 Med its address

On the laptop, in T3 Med: **Settings > Sharing & access > Remote access**. Type the hostname in **Public address** and choose **Save**.

- The dialog then says `The tunnel on this computer sends that address to http://127.0.0.1:<port>`. **Write that port down**: it is the tunnel's target. It is 3900 unless something else held 3900 when T3 Med started.
- Saving also makes the desktop app keep that port at every start, for as long as the address is set. Before, it took the first free port from 3900 upward. The port saved the first time stays: a new address, or turning remote access off and on, does not change it, so the tunnel's configuration never has to follow.
- The setting is `remote` in `~/.t3med/userdata/t3med-desktop.json`, beside `workspace`: `"remote": { "address": "https://med.example.com", "port": 3900 }`. Change it through the dialog. To move the tunnel to another port on purpose, close T3 Med, change `port` in that file and in `config.yml`, and start it again.
- If the dialog answers that the file is not valid JSON, it saved nothing. Correct the file (in JSON a Windows path needs doubled backslashes) and save again.

### 2. Install `cloudflared`

From Cloudflare's [Downloads](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) page, take the Windows 64-bit executable (`cloudflared-windows-amd64.exe`) from the latest GitHub release. Following Cloudflare's [Windows service](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/windows/) page, make the folder `C:\Cloudflared\bin`, copy the file there and rename it `cloudflared.exe`. Then, in PowerShell:

```powershell
cd C:\Cloudflared\bin
.\cloudflared.exe --version
```

Cloudflare notes that `cloudflared` does not update itself on Windows and that it supports versions up to a year old: replace the file with a newer release a few times a year.

### 3. Sign `cloudflared` in (the doctor does this)

```powershell
.\cloudflared.exe tunnel login
```

A browser window opens. The doctor signs in to Cloudflare and selects the domain. This writes `cert.pem` to `%USERPROFILE%\.cloudflared`. An agent cannot do this step: hand it to the doctor and wait.

### 4. Create the tunnel

```powershell
.\cloudflared.exe tunnel create t3med
.\cloudflared.exe tunnel list
```

`create` prints the tunnel's UUID and the path of its credentials file (`%USERPROFILE%\.cloudflared\<Tunnel-UUID>.json`). Keep both. The credentials file is a secret: it never goes into a repository, a chat or a screenshot.

### 5. Put Cloudflare Access in front (dashboard; the doctor signs in)

First the sign-in method, from [One-time PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/): in the Cloudflare dashboard, **Zero Trust > Integrations > Identity providers > Add new identity provider > One-time PIN**.

Then the application, from [Publish a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/):

1. **Zero Trust > Access controls > Applications > Create new application > Self-hosted and private > Add public hostname**.
2. Choose the domain and enter the subdomain, so the application covers `med.example.com` whole, with no path.
3. Under **Access policies**, create one policy: action **Allow**, rule **Include**, selector **Emails**, value the doctor's one address ([Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)). Access denies everyone a policy does not allow. Add no second address, no "Emails ending in" and no Bypass policy.
4. As the identity provider, enable **One-time PIN** only.
5. **Session Duration**: the shortest that the doctor accepts. It decides how often the second computer asks for a new code.
6. **Create**. Then open the application again (**Edit > Additional settings**) and copy the **Application Audience (AUD) Tag** ([Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)).

Leave the application's CORS and cookie settings as they are. T3 Med's pages, its API and its WebSocket are all on the one hostname, so the browser sends Access's cookie with each of them.

### 6. Write the tunnel's configuration

Create `%USERPROFILE%\.cloudflared\config.yml` ([Configuration file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/)), with the UUID from step 4, the port from step 1, and the team name and AUD tag from step 5:

```yml
tunnel: <Tunnel-UUID>
credentials-file: C:\Users\<user>\.cloudflared\<Tunnel-UUID>.json

ingress:
  - hostname: med.example.com
    path: ^/(mcp(/|$)|oauth/mcp/|\.well-known/oauth-)
    service: http_status:404
  - hostname: med.example.com
    service: http://127.0.0.1:3900
    originRequest:
      access:
        required: true
        teamName: <team>
        audTag:
          - <Application Audience (AUD) Tag>
  - service: http_status:404
```

- **`access.required`** makes `cloudflared` itself check Access's token before it passes a request to T3 Med ([Origin parameters, Access settings](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/#access)). If the Access application is ever deleted or misconfigured, the tunnel then refuses instead of serving T3 Med's pairing page to the Internet. T3 Med does not check that token itself.
- **Do not set `httpHostHeader`.** T3 Med must be handed the public hostname as `Host`: it accepts a browser's cookie only from a page whose origin is the host it was asked for.
- **`service` is plain `http://127.0.0.1:<port>`**, the port from step 1. Not `https`, not `localhost` (which can resolve to IPv6, where T3 Med does not listen), not a LAN address.
- **The first rule** answers 404 for the paths agents sign in and connect by (`/mcp`, `/oauth/mcp/…`, `/.well-known/oauth-…`). A browser never needs them, and "Use in another app (MCP)" stays closed. Rules are tried in order, so it must stay above the rule that reaches T3 Med. Two protections, of which one is proven: T3 Med itself refuses to let a remote link approve an agent, and that is tested; this rule was written and not run, and the commands below check it. No other path is refused here: which of T3 Med's remaining paths a browser can do without was not established.
- **The last rule** answers 404 for any other hostname. Cloudflare requires a catch-all rule at the end.

Check it:

```powershell
.\cloudflared.exe tunnel ingress validate
.\cloudflared.exe tunnel ingress rule https://med.example.com
.\cloudflared.exe tunnel ingress rule https://med.example.com/mcp
.\cloudflared.exe tunnel ingress rule https://med.example.com/oauth/mcp/register
```

The second command must name the rule whose service is `http://127.0.0.1:<port>`; the third and the fourth must name the first rule, `http_status:404`. If they name the T3 Med rule instead, the `path` is not matching: stop and correct it before step 7.

### 7. Point the hostname at the tunnel, and run it

```powershell
.\cloudflared.exe tunnel route dns t3med med.example.com
.\cloudflared.exe tunnel run t3med
```

`route dns` creates a `CNAME` record for the hostname that points to `<Tunnel-UUID>.cfargotunnel.com`. `run` keeps running in that window; Ctrl+C stops it, and the address stops answering.

In the Cloudflare dashboard, on the domain: under **SSL/TLS > Edge Certificates**, turn **Always Use HTTPS** on, so a link typed without `https://` is redirected before anything is sent in clear. Then check the domain's **Network** page: **WebSockets** must be **On** ([WebSockets](https://developers.cloudflare.com/network/websockets/)). Cloudflare says WebSockets are proxied "without additional configuration" on every plan; the switch is where to look if step 8 fails.

### 8. Check it, with T3 Med running

From the laptop itself, in a private browser window, or from a phone on mobile data:

1. Open `https://med.example.com`. **Cloudflare's** page must ask for an email address. A code arrives at the doctor's address and nowhere else. If T3 Med's own page appears without that question, stop: Access is not in front. Stop the tunnel (Ctrl+C) and go back to step 5.
2. After the code: a page headed **Pair this browser with T3 Med**, with the wordmark `T3 Med` and no patient's name anywhere. That page is all an unpaired browser can get.
3. On the laptop: **Remote access > Create link**. In the checking browser, open the link **in a new tab**. It shows T3 Med with Inbox, Patients, Needs you and Upcoming in the sidebar.
4. The live connection: open a chat. The thread list and the chat must fill in, with no "reconnecting" banner that stays. That is the WebSocket at `wss://med.example.com/ws`.
5. The cookie: in the browser's developer tools, the cookie `t3_session_<port>` must be marked `Secure` and `HttpOnly`, and expire 12 hours after pairing. `Secure` shows that T3 Med was told the request came over HTTPS. If it is not `Secure`, pairing still works, but report it.
6. The closed paths: `https://med.example.com/mcp` must answer 404 from Cloudflare's connector, not from T3 Med.
7. On the laptop, **Settings > Sharing & access** lists the browser as `Remote browser`, with `2 scopes`. Choose **Revoke** on it. The checking browser must fall back to the pairing page at its next click.

### 9. Run the tunnel without a window (optional)

Two ways. Decide with the doctor.

- **By hand, when needed** (the default to suggest): a shortcut that runs `C:\Cloudflared\bin\cloudflared.exe tunnel run t3med`. The address answers only while that window is open.
- **As a Windows service**, which starts with Windows and runs whether or not anyone is signed in. Follow Cloudflare's [Windows service](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/windows/) page exactly; it needs an administrator. In short, from that page: in an administrator CMD in `C:\Cloudflared\bin` run `cloudflared.exe service install`; create `C:\Windows\System32\config\systemprofile\.cloudflared`; copy `cert.pem`, the credentials file and `config.yml` there, and change `credentials-file` in that copy to the new path; set `ImagePath` of `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\Cloudflared` to `C:\Cloudflared\bin\cloudflared.exe --config=C:\Windows\System32\config\systemprofile\.cloudflared\config.yml tunnel run`; then `sc start cloudflared`. After any change to the configuration: `sc stop cloudflared`, then `sc start cloudflared`.

A service keeps the address pointed at the laptop even while T3 Med is closed. Nothing answers then, but whatever else listens on that port would be offered to whoever passes Access. That is one reason T3 Med keeps its port.

## Using it

- **On the second computer**, open `https://med.example.com`, enter the code Cloudflare emails, then pair once.
- **Pairing without sending a link anywhere.** A link is `https://med.example.com/pair#token=` and twelve characters. The doctor can read those twelve characters off the laptop's screen and type them into **Pairing token** on the second computer. Nothing then travels by email or chat.
- **A link works once and for five minutes.** Opened a second time, or late, it is refused: make a new one.
- **Open a link in a new tab.** Pasted into a tab that already shows the pairing page, only the part after `#` changes and the page does not read it. Press reload, or type the token into the field.
- **A paired browser stays signed in for 12 hours**, or until the laptop revokes it. After that it shows the pairing page again and needs a new link. Cloudflare's own session ends by the duration set in step 5.
- **What that browser can do:** read and work in chats, answer an agent's approval question, open patient pages, verify, correct and remove results and plans. Its session holds `orchestration:read` and `orchestration:operate`, and nothing else.
- **What it cannot do directly:** make a pairing link, see or revoke clients, change the public address, open a terminal, browse or read the laptop's files (a file link in a reply does not open there), change settings or providers, or sign an agent in through MCP. The server refuses each of these, whatever the page shows: a Settings page may still draw a control that then fails.
- **What that does not mean.** "Directly" is the whole of it. Whoever can send a chat message can ask an agent to do things on the laptop, and can switch a chat to Full access, where the agent no longer asks first and runs commands as the laptop's user. So a paired browser is as trusted as the doctor. The scopes keep access management on the laptop and keep the terminal and the files out of the browser; they are not a wall against a hostile person holding the link. Access and the one-time link are that wall.

### On a shared computer, when you are done

A browser on a computer other people use stays paired for up to 12 hours unless it is ended. Do all three, in this order:

1. In that browser, close every T3 Med tab.
2. **On the laptop, revoke it:** **Settings > Sharing & access**, the row `Remote browser`, **Revoke**. This is the step that ends the session; closing a tab does not. When the laptop is not at hand, the session ends by itself 12 hours after pairing, and not sooner.
3. Close the browser itself, so Cloudflare's own sign-in is not left open in it for the next person. Its session ends by the duration set in step 5 of Setting it up.

## Turning it off

Each of these stands alone. Do the first two to stop it today; the rest remove it for good.

1. **Turn remote access off in T3 Med.** On the laptop: **Remote access > Turn off**. It does three things at once: it signs out every browser that was paired through a remote link and closes its open connection, it cancels every link not yet opened, and it removes the address, so no link can be made and the app goes back to finding its port by itself. The laptop's own window stays signed in. The port a tunnel was pointed at is remembered, so turning it on again later needs no change to `config.yml`.
2. **Stop the tunnel.** Ctrl+C in its window, or `sc stop cloudflared` for the service. The address stops answering at once.
3. **Only if anything else was ever paired:** **Settings > Sharing & access > Revoke others** ends every session but the laptop's own, whatever made it. Turn off already ended the remote ones.
4. **Keep the service from starting again:** `sc config cloudflared start= disabled`, or remove it with `sc delete cloudflared`. These are Windows' own commands. Cloudflare's pages read for this file describe installing the service and not removing it; `cloudflared.exe service --help` lists what the installed version offers.
5. **Delete the tunnel:** `.\cloudflared.exe tunnel delete t3med`. Cloudflare's [Useful commands](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-useful-commands/) page says a tunnel with active connections is not deleted without `-f`, and that `cloudflared tunnel cleanup t3med` clears connections left by a `cloudflared` that was killed.
6. **In the dashboard:** delete the Access application, and the `CNAME` record of the hostname under the domain's DNS. Whether deleting the tunnel removes that record was not read anywhere: look.
7. **On the laptop:** delete `%USERPROFILE%\.cloudflared` (and the service's copy under `C:\Windows\System32\config\systemprofile\.cloudflared`) and `C:\Cloudflared`.

## When something is wrong

| What is seen                                                           | Cause, and what to do                                                                                                                                                        |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An error page from Cloudflare instead of T3 Med                        | T3 Med is closed, the laptop sleeps, or the tunnel is not running. Start them                                                                                                |
| The dialog on the laptop warns that the tunnel points at another port  | Another program held the kept port when T3 Med started, so T3 Med took the next one. Close that program and start T3 Med again. Do not change `config.yml` to chase the port |
| T3 Med's pairing page appears without Cloudflare asking for a code     | Access is not in front of the hostname. Stop the tunnel and redo step 5. With `access.required` set, `cloudflared` should have refused: check `config.yml`                   |
| Paired, but pages stay empty and reconnecting                          | The WebSocket does not get through. Check the Network page's WebSockets switch, and that `config.yml` sets no `httpHostHeader`                                               |
| Pairing answers that the credential is invalid                         | The link was used, is older than five minutes, was revoked, or remote access was turned off since. Make a new one                                                            |
| Signed out on every request, though just paired                        | The browser blocks cookies for the site, or `httpHostHeader` rewrites the host                                                                                               |
| Signed out after half a day                                            | A paired browser lasts 12 hours. Make a new link                                                                                                                             |
| Every request answers 400, `X-Forwarded-Host does not match Host`      | Something in front of T3 Med rewrites `Host` and passes the public name in `X-Forwarded-Host`. T3 Med refuses that. Remove `httpHostHeader` from `config.yml`                |
| Saving the address answers that `t3med-desktop.json` is not valid JSON | A hand edit broke the file. Nothing was saved. Correct it and save again                                                                                                     |
| "This T3 home is unavailable" when starting T3 Med                     | The browser version (`start-t3-med.cmd`) is running on the same data. Only one runs at a time                                                                                |

The browser version (`start-t3-med.cmd`) always listens on port 3899 and serves the same Settings page, so it could be published the same way. That was not tried: this file was written for, and checked against, the mode the desktop app runs its server in.
