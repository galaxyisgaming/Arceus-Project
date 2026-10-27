# TitanBot - Ultimate Discord Bot

**TitanBot** is a powerful, feature-rich Discord bot designed to enhance your server experience with comprehensive moderation tools, engaging economy systems, utility features, and much more. Built with modern Discord.js v14 and PostgreSQL for optimal performance and data persistence.

[![Support Server](https://img.shields.io/badge/-Support%20Server-%235865F2?logo=discord&logoColor=white&style=flat-square&logoWidth=20)](https://discord.gg/8kJBYhTGW9)
[![Discord.js](https://img.shields.io/npm/v/discord.js?style=flat-square&labelColor=%23202225&color=%23202225&logo=npm&logoColor=white&logoWidth=20)](https://www.npmjs.com/package/discord.js)
![PostgreSQL](https://img.shields.io/badge/-PostgreSQL-%23336791?logo=postgresql&logoColor=white&style=flat-square&logoWidth=20)

## Table of Contents

- [Features Overview](#features-overview)
- [Quick Setup](#quick-setup)
- [Manual Installation Steps](#manual-installation-steps)
- [Support Server](https://discord.gg/QnWNz2dKCE)
- [Required Bot Intents](#bot-intents)
- [Contributing](CONTRIBUTING.md)

<a name="features-overview"></a>
## Features Overview

TitanBot offers a complete suite of tools for Discord server management and community engagement:

<table>
<tr>
<td width="50%" valign="top">

### Moderation & Administration
- **Mass Actions** - Bulk ban/kick capabilities
- **User Notes** - Keep detailed moderation records
- **Case Management** - View and track all mod actions

### Economy System
- **Shop & Inventory** - Buy and manage items
- **Gambling** - Risk it for rewards
- **Pay System** - Transfer money between users

### Fun & Entertainment
- **Random Facts** - Learn something new
- **Wanted Poster** - Create fun wanted images
- **Text Reversal** - Reverse any text

### Advanced Ticket System
- **Claim & Priority** - Staff ticket management
- **Ticket Limits** - Prevent spam
- **Transcript System** - Save ticket history

### Server Stats
- **Member Counter** - Live member count channels
- **Voice Counters** - Track voice stats
- **Dynamic Updates** - Real-time channel updates

### Reaction Roles
- **Role Assignment** - Self-assignable roles
- **Emoji Selection** - Reaction-based system
- **Multi-role Support** - Multiple role options

Administrators create panels with `/reactroles setup` and manage them with
`/reactroles dashboard`. Members click the numbered/letter emoji reaction beside
a role to receive it, and remove their own reaction to remove that role. The
dashboard itself remains slash-command based.

Existing dropdown panels convert automatically on startup without removing any
member's existing roles. Emoji mappings persist across restarts and dashboard
edits. Opening the dashboard retries panel synchronization after a permission
issue. Old dropdown interactions on converted panels direct members to reactions.

The bot needs **Manage Roles**, **View Channel**, **Read Message History** and
**Add Reactions**, and its highest role must be above the roles being assigned.
**Manage Messages** is also needed when removing an option that members have
already reacted to; those reactions are cleared without removing their roles.
Managed, everyone and high-privilege roles cannot be self-assigned.

Discord permits **20 distinct reactions per message**. Create additional panels
for more roles. Older panels with more than 20 roles are left unconverted with an
explicit startup error; split their roles into smaller panels before restarting.
Role changes while the bot is offline are not replayed.

Run the focused checks with `node --test scripts/reaction-roles.test.js`.

### PokeGalaxy onboarding

Onboarding is **disabled by default**. It does not create/change Discord channels,
permissions, roles, webhooks or AutoMod rules, and does not remove existing members'
roles. Configure permissions deliberately before enabling it.

The flow is rules agreement -> private five-field screening form -> automatic
approval or private staff review -> optional roles -> a link to the **existing**
PokeGalaxy welcome summary. The form asks invitation yes/no, optional inviter,
18+/under-18 category, interest and conduct agreement. Discord account age is read
automatically. No exact age or birthday is requested.

Accounts at least seven days old with recognized answers and accepted agreements
are automatically approved. Newer accounts and unclear answers require staff
review. Invitation status and adult/minor category alone do not reject anyone.
Conduct disagreement leaves access restricted. Staff can approve, decline, or
request corrected answers, with a required decision reason. Declining never kicks
or bans the member. Age category is self-reported, **not identity/age verification**.
All shared public channels must remain appropriate for minors; content filtering
and Discord age-restricted channels must be configured separately.

For the PokeGalaxy server, the supplied channel/verified-role/reviewer-role IDs
are built into disabled defaults. Restricted gameplay uses the supplied Bot Lounge
channel `1564736135899517099` inside category `1564732192129679480` and access role
`1564736300269965432`. Saved dashboard settings take precedence over defaults.
Use a neutral role name rather than a public age label; Discord
roles are not confidential. The dedicated role is granted before the verified
role when an approved applicant reports under 18.

Administrator commands:

- `/onboarding dashboard`: inspect settings.
- `/onboarding configure`: save channel, access-role, game-bot, reviewer-role,
  welcome-message or rules-version settings while disabled.
  If the gameplay channel is missing from Discord's picker, use
  `gameplay-channel-id:1564736135899517099`. Arceus fetches and validates the
  server text channel before saving; the usual permission checks still apply.
- `/onboarding check`: validate setup without enabling it.
- `/onboarding panel`: post/update the member-facing screening panel.
- `/onboarding enable`: validate setup and the panel, then enable.
- `/onboarding disable`: stop onboarding without removing any member's roles.
  Legacy verification becomes available again if it is separately enabled.

Before enabling:

1. Let newcomers (`@everyone`) view rules and onboarding. Hide normal member areas
   until approval. Do not assign access-granting roles automatically on arrival.
2. Hide review, optional roles, welcome and restricted gameplay from `@everyone`.
   Only reviewer roles, administrators and Arceus should see the staff queue;
   member access roles must not expose it.
3. Give the verified role access to optional roles and welcome, but not restricted
   gameplay. Give the gameplay-access role View Channel, Send Messages and Read
   Message History in restricted gameplay. Give the three reviewer roles access.
4. Give Arceus Manage Roles, place its role above both access roles, and allow it
   to view/read all six configured channels and send/embed in onboarding/review.
5. Give PokeGalaxy View Channel, Send Messages, Read Message History, Embed Links
   and Attach Files in restricted gameplay. The main bot is the default;
   `game-bot` can select another PokeGalaxy test bot.
6. Confirm the saved welcome message contains the intended summary embed. No
   webhook credentials are needed and the message is not reposted per applicant.
7. Audit **other** server roles/overwrites too: the checks validate the configured
   access paths, not every possible combined role a member might receive.

When enabled, join welcome/auto-role/auto-verification is replaced for human new
members. Legacy verify buttons and `/verify` direct them to screening. Access and
reviewer roles are reserved against grants through reaction panels, the legacy
application flow, shop, birthdays and leveling. Optional self-role assignment
requires approval. These checks do not override deliberate Discord staff actions.

Progress and decisions use persistent PostgreSQL storage, versioned rules
agreement, join-specific sessions, retryable role grants and serialized decisions
within one bot process. Run **one active Arceus replica**; multiple concurrent
instances require distributed coordination before use. Database degradation/read
errors block approval rather than using temporary memory. Pending/unfinished
records expire after 30 days and reviewed records after 14 days; granted roles
remain. Discord staff-review messages are separate and must be retained/deleted
according to the server's staff policy.

Review cards are restored after restart, and member status is available through
the onboarding panel even when DMs are closed. Native Discord membership screening
must also be completed. Role selection is optional: the welcome button does not
require choosing any notification role. No PokeGalaxy economy/game data is edited.

Run local policy, UI, failure-path and regression checks:

```sh
node --test scripts/onboarding.test.js scripts/reaction-roles.test.js
```

These are mocked Discord/database integration tests, not a live-server acceptance
test. Before rollout, use a test member to exercise both approval routes, optional
roles, the welcome link and an actual PokeGalaxy command in restricted gameplay.

</td>
<td width="50%" valign="top">

### Leveling & XP System
- **XP Tracking** - Automatic message-based XP
- **Level Roles** - Auto-assign roles by level
- **Custom Configuration** - Personalize leveling

### Giveaways & Events
- **Multiple Winners** - Support multi-winner giveaways
- **Auto Picking** - Automatic winner selection
- **Reroll System** - Pick new winners if needed

### Birthday System
- **Birthday Tracking** - Never miss a birthday
- **Auto Announcements** - Celebrate automatically
- **Timezone Support** - Accurate worldwide tracking

### Utility Tools
- **Report System** - Report issues to staff
- **Todo Lists** - Personal task management
- **First Message** - Jump to channel's first message

### Welcome System
- **Welcome Messages** - Greet new members
- **Auto Roles** - Assign roles on join
- **Custom Embeds** - Personalized messages
  
### Music
- **24/7 Mode** - Play music 24/7
- **Interative Button System** - Manage music through buttons
- **Supports EVERY platform** - Supports spotify, deezer, youtube, apple music
  
</td>
</tr>
</table>

<a name="quick-setup"></a>
## Quick Setup (Recommended for non-coders)

### Video Tutorial
For a detailed step-by-step setup guide, watch our comprehensive video tutorial:
[**TitanBot Setup Tutorial**](https://www.youtube.com/@TouchDisc)

## Docker Deployment (Recommended)

TitanBot is fully containerized for easy deployment.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/codebymitch/TitanBot.git
   cd TitanBot
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Set at minimum `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID`. Docker Compose also reads `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` from `.env` (defaults: `titanbot` / `password` / `titanbot`).

3. **Build and start the containers:**
   ```bash
   docker compose up -d --build
   ```

4. **Check status:**
   ```bash
   docker compose ps
   curl http://localhost:3000/health
   ```

This starts the bot and PostgreSQL. The compose file sets `POSTGRES_SSL=false` and `AUTO_MIGRATE=true` for the bundled database. Music uses public Lavalink v4 nodes from `lavalink/nodes.json` by default.

### Music

Music uses [Lavalink v4](https://github.com/lavalink-devs/Lavalink) via [Riffy](https://github.com/riffy-rb/riffy), similar to [Musicify](https://github.com/codebymitch/Musicify).

1. By default, the bot loads multiple public v4 SSL nodes from [`lavalink/nodes.json`](lavalink/nodes.json) (sourced from [lavalink.darrennathanael.com](https://lavalink.darrennathanael.com/SSL/Lavalink-SSL/)). Edit that file to add or remove nodes.
2. To self-host Lavalink instead, run `docker compose --profile local-lavalink up -d` and set single-node env vars in `.env`:
   ```env
   LAVALINK_HOST=lavalink
   LAVALINK_PORT=2333
   LAVALINK_PASSWORD=youshallnotpass
   LAVALINK_SECURE=false
   ```
   Remove or rename `lavalink/nodes.json` so the bot falls back to those env vars.
3. Override nodes inline with `LAVALINK_NODES` (JSON array) or point at another file with `LAVALINK_NODES_FILE`.
4. Use `/play <song>` from a voice channel, or `/join` to connect without playing. Prefix shortcuts: `join`, `np`, `leave`, `pause`, `resume`, `skip`, `stop`, `volume <0-100>`, or `music <subcommand>`. Use `/nowplaying` and `/queue` for status; `/music` for loop, shuffle, seek, and other controls.

### Using GitHub Container Registry

The bot is automatically published to GitHub Container Registry on every push to main.

```bash
docker pull ghcr.io/codebymitch/titanbot:main
```

<a name="manual-installation-steps"></a>
## Manual Installation Steps

### Prerequisites
- Node.js 20.10.0 or higher
- PostgreSQL server (recommended) or memory storage fallback
- Discord bot application with proper intents

1. **Clone the Repository**
   ```bash
   git clone https://github.com/codebymitch/TitanBot.git
   cd TitanBot
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your configuration (only the following variables require configuration, leave remaining variables as default):
   ```env
   # Discord Bot Configuration
   DISCORD_TOKEN=your_discord_bot_token_here
   CLIENT_ID=your_discord_client_id_here
   GUILD_ID=your_discord_guild_id_here

   # PostgreSQL Configuration (Primary Database)
   POSTGRES_URL=postgresql://postgres:yourpassword@localhost:5432/titanbot
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_DB=titanbot
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=yourpassword
   ```

   Production note:
   - `NODE_ENV=production`
   - `LOG_LEVEL=warn` for a clean production console (critical issues + startup status)
   - `LOG_LEVEL=info` if you want more detailed operational logs
   - If your chosen `PORT` is already used, TitanBot automatically tries the next port(s)

   Environment options reference:
   - `NODE_ENV`: `development`, `production`, `test` (any non-`production` value is treated as non-production)
   - `LOG_LEVEL`: `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`
   - Accepted aliases for `LOG_LEVEL` in this bot: `warns`, `warning`, `warnings` → `warn`

   Recommended production `.env` (easy mode + default mode):
   ```env
   NODE_ENV=production
   LOG_LEVEL=warn
   WEB_HOST=0.0.0.0
   PORT=3000
   PORT_RETRY_ATTEMPTS=5
   ```
   This gives clear startup/online status messages while keeping logs simple for non-technical operators.
   If port `3000` is busy, the bot tries the next available ports automatically (up to `PORT_RETRY_ATTEMPTS`).

### Multiple servers

Slash commands are registered **globally** on startup (via `CLIENT_ID`), so the bot works in every server it is invited to. `GUILD_ID` stays in the tutorial `.env` for setup steps but is not used for command registration.

Notes:
- Global slash commands may take up to about an hour to propagate on first deploy
- Each server has **isolated** data: config, economy, tickets, leveling, dashboards, warnings, etc. (all keys are scoped as `guild:{guildId}:...`)
- In the [Discord Developer Portal](https://discord.com/developers/applications), ensure your bot is not restricted to a single guild if you plan to invite it elsewhere
- Generate an OAuth2 invite URL from the [Discord Developer Portal](https://discord.com/developers/applications) (OAuth2 → URL Generator, scopes: `bot` and `applications.commands`)

4. **Setup PostgreSQL Database** (Optional but recommended)
   ```bash
   # Create database and user
   createdb titanbot
   createuser titanbot
   psql -c "ALTER USER titanbot PASSWORD 'yourpassword';"
   psql -c "GRANT ALL PRIVILEGES ON DATABASE titanbot TO titanbot;"
   ```

5. **Verify Database Setup**
   ```bash
   npm run migrate:check
   ```

6. **Start the Bot**
   ```bash
   npm start
   ```

> **Note on database migrations:** Schema tables and legacy key migrations run
> **automatically on startup**, so` managed hosts like **Railway** need no manual
> migration step — just deploy/restart. To disable auto-migration set
> `AUTO_MIGRATE=false`. You can still run a manual key migration locally with
> `node scripts/migrate-keys.js --dry-run` (preview) or `node scripts/migrate-keys.js`.
<a name="bot-intents"></a>

## Required Bot Intents
TitanBot requires the following Discord intents:
- **Guilds**
- **Guild Messages**
- **Message Content**
- **Guild Members**
- **Guild Message Reactions**
- **Guild Voice States**
- **Direct Messages**
- **Bot**
- **Applications.commands**

### Required Permissions
- **View Channels**
- **Send Messages**
- **Embed Links**
- **Attach Files**
- **Read Message History**
- **Manage Messages**
- **Manage Channels**
- **Manage Roles**
- **Kick Members**
- **Manage Messages**
- **Ban Members**
- **Moderate Members**
- **Connect**

## License

TitanBot is released under the MIT License. See [LICENSE](LICENSE) for details.

## Thank You

Thank you for choosing TitanBot for your Discord server! We're constantly working to improve and add new features based on community feedback.

*Last updated: May 2026*
