# Web Creator 360 · manual para Claude

Esta app busca negocios nuevos en EE. UU., le hace a cada uno una web de demo con Claude, la publica en Vercel y les
escribe por email con Instantly. Cuando alguien pide una llamada, avisa por Telegram.

La usa gente que **no programa**. Tu trabajo es instalársela tú, paso a paso, con Playwright, sin que tenga que usar la
terminal.

## Reglas que no se rompen

- **Las claves nunca pasan por el chat.** El alumno las pega en la **caja de claves** (`http://localhost:3001/claves.html`),
  en su navegador normal. Si pega una clave en el chat:
  - no la uses ni la repitas;
  - dile que la borre en esa plataforma y cree otra.
- **No mires una clave en pantalla.** Cuando el alumno pulse "Create", "Reveal" o "Copy" en una página de claves, esa
  página ya tiene la clave. Desde ese momento no hagas `snapshot`, `click` ni nada en esa página. Tu siguiente acción de
  Playwright es `navigate` a **otra** dirección, y solo cuando el alumno te diga que ya la pegó en la caja.
- **Nunca abras la caja de claves con Playwright.** Ábrela en el navegador normal del alumno:
  - Windows: `start http://localhost:3001/claves.html`
  - Mac: `open http://localhost:3001/claves.html`
- **No leas el `.env`.**
  - Para saber qué falta, usa `Invoke-RestMethod http://localhost:3001/api/setup/status` en PowerShell, o
    `curl -s http://localhost:3001/api/setup/status` en Bash o Mac. Devuelve solo sí/no de cada clave. En PowerShell 5.1,
    `curl` es otro comando y no vale.
  - Para comprobarlo todo, usa `npm run doctor`. Nunca muestra una clave.
- **No subas nada a git** sin que el alumno te lo pida.
- **Español sencillo.** Pregunta su nombre al empezar y úsalo. Un paso cada vez: dile qué hacer, espera a que te diga
  "hecho" y comprueba antes de seguir.

## "Instálame esta app"

### 0. Lo básico (lo haces tú)

1. **Node 18 o más:** `node -v`.
   - Si no hay, en **Windows** ejecuta `winget install --id OpenJS.NodeJS.LTS --exact`.
   - Si no funciona, o en **Mac**, abre https://nodejs.org con Playwright y dile que descargue e instale la versión LTS.
   - Luego pídele que cierre y abra Claude Code.
2. **Dependencias:** `npm ci`. En PowerShell de Windows, `npm` puede fallar con *"la ejecución de scripts está
   deshabilitada"*: usa `npm.cmd` (`npm.cmd ci`, `npm.cmd start`, `npm.cmd run doctor`).
3. **Playwright:** si no tienes las herramientas `mcp__playwright__*`:
   - Si el comando `claude` no existe (pasa cuando solo tiene la extensión de VS Code, que no lo instala), instálalo tú
     con el instalador oficial:
     - Windows (PowerShell): `irm https://claude.ai/install.ps1 | iex`. Luego úsalo con su ruta completa:
       `& "$env:USERPROFILE\.local\bin\claude.exe"`.
     - Mac: `curl -fsSL https://claude.ai/install.sh | bash`. Luego úsalo con su ruta completa: `~/.local/bin/claude`.
   - Ejecuta `claude mcp add --scope user playwright npx @playwright/mcp@latest`.
   - Comprueba con `claude mcp get playwright`.
   - Pídele que abra una conversación nueva y vuelva a escribir *"instálame esta app"*.
4. **El panel:** arráncalo en segundo plano con `npm start` y abre la caja de claves en su navegador normal (ver arriba).

### 1. Por cada servicio, en el orden de la caja

Siempre igual:
1. Abre la plataforma con Playwright. El alumno entra o crea la cuenta **en esa ventana**: los captchas y los emails de
   verificación son cosa suya.
2. Llévale hasta la página de la clave y dile exactamente qué pulsar.
3. Él la copia, la pega en su sección de la caja y pulsa **"Comprobar y guardar"**.
4. Comprueba con `/api/setup/status` que se guardó y pasa al siguiente.

| # | Servicio | Dónde está la clave | Qué más |
|---|---|---|---|
| 1 | **Tus datos** | No hay clave: marca, su nombre y pie legal (empresa y dirección postal, lo exige la ley de EE. UU.) | Sin esto no se crean las campañas |
| 2 | **Supabase** | https://supabase.com/dashboard → crear proyecto (espera a que termine) → Project Settings → API Keys: la URL y la clave secreta `service_role` | Las tablas las creas tú (abajo). Luego pulsa "Comprobar tablas" y "Crear mi usuario" con su email |
| 3 | **Anthropic** | https://console.anthropic.com → API Keys → Create Key | Necesita saldo: Settings → Billing. Cada web cuesta ≈ 0,02–0,14 $ |
| 4 | **Vercel** | https://vercel.com → Account Settings → Tokens → Create. **Scope:** su equipo (`<usuario>'s projects`). **Expiration: No Expiration** | Con caducidad corta deja de publicar webs sin avisar. El equipo se pone solo |
| 5 | **Instantly** | https://app.instantly.ai → Settings → Integrations → API Keys: API v2, con permiso para leads, campañas y accounts (lectura) | Pregúntale si tiene buzones conectados (Email Accounts). Si sí: "Crear mis campañas". Si no: mira "Sin buzones en Instantly" abajo |
| 6 | **Telegram** (opcional) | **Desde el móvil**: @BotFather → `/newbot` → token. No uses Telegram Web con Playwright: deja ver sus chats privados | Luego escribe "hola" a su bot y pulsa "Ya le he escrito" |
| 7 | **Apify** (opcional, solo campaña de Maps) | https://console.apify.com → Settings → API & Integrations | El plan gratis (5 $/mes) se gasta en un par de días con Maps |
| 8 | **Render** (al final) | https://dashboard.render.com → Account Settings → API Keys | Plan Starter, de pago: antes tiene que poner una tarjeta en Billing. Antes de "Crear mi servidor", que conecte su GitHub: Account Settings → Account Security → **Git Deployment Credentials → Add credential** (si no tiene GitHub, que cree una cuenta gratis en https://github.com). Luego "Crear mi servidor" |

Si una dirección no lleva a la página, navega por los menús que se ven: las webs cambian.

### Las tablas de Supabase (las creas tú, no llevan claves)

1. Saca el id del proyecto de `SUPABASE_URL` (`https://<id>.supabase.co`), que viene en `/api/setup/status`.
2. Abre con Playwright `https://supabase.com/dashboard/project/<id>/sql/new`.
3. Pon el texto de `src/db/schema.sql` en el editor:
   `window.monaco.editor.getModels()[0].setValue(<texto>)` con `browser_evaluate`.
4. Pulsa `[data-testid="sql-run-button"]`. Si sale un aviso, confirma con "Run query".
5. Espera "Success" y dile que pulse "Comprobar tablas" en la caja.

Si algo de esto falla, que use "Copiar el SQL" de la caja, lo pegue y pulse Run.

### Sin buzones en Instantly

Sin buzones activos, "Crear mis campañas" falla y no se envía nada. No le pares la instalación por esto:
1. Guarda su clave de Instantly, **sáltate "Crear mis campañas"** y sigue con el resto de pasos.
2. Al terminar, abre con Playwright https://app.instantly.ai/app/accounts/connect/google (Email Accounts → "Add or
   Buy Accounts" → **DFY Google Accounts**) y explícale, paso a paso:
   1. **Your domain:** que escriba un nombre parecido a su marca y elija uno de los dominios sugeridos (15 $ al año
      cada uno). Luego **Next**.
   2. **Forwarding Domain:** la dirección de su web, si tiene.
   3. Instantly le propone solo 5 buzones a su nombre (5 $ al mes cada uno). Puede quitar los que no quiera con la
      papelera.
   4. Que revise el total (1 dominio + 5 buzones = 25 $ al mes + 15 $ al año) y pulse **Place Order**. **Lo pulsa él:
      es un pago. Tú no lo pulses nunca.** Se renueva cada mes solo.
   5. Instantly tarda **24–72 horas** en dejar los buzones listos. Después, en **Email Accounts**, que active el
      **warm-up** (calentamiento) de cada buzón y espere **al menos 2 semanas** antes de enviar: lo dice la ayuda de
      Instantly.
3. Las 2 líneas rojas de "Comprobar todo" (sin buzones y sin campaña) son normales hasta entonces. Díselo para que no
   se asuste.
4. Cuando tenga los buzones, que te escriba *"ya tengo buzones"*: comprueba con `npm run doctor` que salen activos y que
   pulse "Crear mis campañas".

### 2. Final

1. Ejecuta `npm run doctor` (o que pulse "Comprobar todo" en la caja) y explícale cada línea roja o amarilla. Si
   no tiene buzones, las líneas rojas de Instantly son normales (ver "Sin buzones en Instantly").
2. Si cambiaste algo del `.env` después de crear el servidor de Render, que pulse "Mandar mis claves de nuevo al servidor".
3. Cuéntale que empieza en **modo prueba** (`OUTREACH_DRY_RUN=true`): no se envía nada a Instantly.
4. Cuando lo haya probado con su propio email y quiera enviar de verdad:
   - cambia esa línea a `false` en el `.env` (no es una clave);
   - pídele que pulse "Mandar mis claves de nuevo al servidor".

## Usar la app

- **Panel:** `npm start` → http://localhost:3001: fuentes de leads, lista y envío.
- **Comprobar todo:** `npm run doctor`.
- **El servidor de la campaña** (Render) hace solo lo automático: descargar leads, crear demos, enviar a Instantly y
  mirar respuestas. Con el autopilot apagado, nada se envía solo.
